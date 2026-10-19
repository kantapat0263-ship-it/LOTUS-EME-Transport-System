import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import { parseThaiCoordinates } from '@/lib/requestCoordinates'
import type { ActiveTokenUser } from '@/firebase/admin'
import { findFreeRequestId, requestIdPrefix } from '@/lib/requestId'
import { planCustomSites, type SavedPlace } from '@/lib/customSite'
import { thaiToday } from '@/lib/driverLeave'
import { isOutsideRequestHours } from '@/lib/requestWindow'
import type { VehicleRequestCommand } from './vehicleRequestValidation'

export class VehicleRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export interface VehicleRequestResult {
  requestId: string
  createdNames: string[]
  reusedNames: string[]
  unsavedNames: string[]
}

const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}


/** ผลที่บันทึกไว้ของคำสั่งนี้ (ส่งซ้ำหลังบันทึกสำเร็จแล้ว = คืนผลเดิม ไม่สร้างใบใหม่) */
function storedResult(data: DocumentData | undefined, uid: string): VehicleRequestResult | null {
  if (!data) return null
  if (data.userId !== uid) throw new VehicleRequestError('ข้อมูลใบขอรถไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วส่งอีกครั้ง', 409)
  return { requestId: data.requestId, createdNames: data.createdNames ?? [], reusedNames: data.reusedNames ?? [], unsavedNames: data.unsavedNames ?? [] }
}

/**
 * กติกาวันที่ของผู้ขอทั่วไป (เดิมตรวจแค่ในฟอร์ม): นอกเวลารับคำขอต้องขอล่วงหน้า 2 วัน
 * เว้นแต่ขอ "พรุ่งนี้" ที่ Dispatcher อนุมัติเร่งด่วนแล้ว — staff ไม่ติดกติกานี้
 */
async function assertViewerBookingWindow(db: Firestore, uid: string, requestDate: string, now: Date) {
  const today = thaiToday(now)
  const tomorrow = addDays(today, 1)
  if (requestDate < tomorrow) throw new VehicleRequestError('ต้องขอล่วงหน้าอย่างน้อย 1 วัน', 400)
  const settings = (await db.doc('companySettings/default').get()).data() ?? {}
  const hour = new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCHours()
  const isOutsideHours = isOutsideRequestHours(hour, settings)
  if (requestDate >= addDays(today, isOutsideHours ? 2 : 1)) return
  if (requestDate !== tomorrow) throw new VehicleRequestError('วันที่เลือกไม่ถูกต้อง กรุณาเลือกวันใหม่', 400)
  // ใช้ผลของคำขออนุมัติ "ล่าสุด" เหมือนฟอร์ม (urgentStatus) — ใบเก่าที่เคยอนุมัติไม่ชนะใบใหม่ที่ถูกปฏิเสธ/รออยู่
  const urgent = await db.collection('urgentRequests').where('userId', '==', uid).where('requestedDate', '==', requestDate).get()
  const latest = urgent.docs.map(d => d.data())
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))[0]
  if (latest?.status !== 'approved') throw new VehicleRequestError('กรุณาขออนุมัติจาก Dispatcher ก่อนจึงจะขอรถพรุ่งนี้ได้', 400)
}

/**
 * สร้างใบขอรถ + สถานที่ใหม่ที่ผู้ขอเลือก "บันทึกไว้ใช้ครั้งต่อไป" ในธุรกรรมเดียว (เดิมทำฝั่ง client)
 * ย้ายมา server เพราะการออกเลข VR ต้องนับ/อ่านใบของทุกคนในวันนั้น — client ของ viewer จะอ่านใบคนอื่นไม่ได้แล้ว
 * รูปแบบเลข + กันชนใช้ lib/requestId เดิม · status ตัดสินจาก role ที่ตรวจจาก token (ไม่เชื่อ client)
 * operationId: ฟอร์มส่งรหัสเดิมตอนกดซ้ำ — ถ้าครั้งก่อนบันทึกสำเร็จแต่คำตอบหาย จะได้ผลเดิม ไม่เกิดใบซ้ำ
 */
export async function createVehicleRequest(db: Firestore, user: ActiveTokenUser, command: VehicleRequestCommand, now = new Date()): Promise<VehicleRequestResult> {
  const operationRef = db.doc(`vehicleRequestOperations/${command.operationId}`)
  const replay = storedResult((await operationRef.get()).data(), user.uid)
  if (replay) return replay

  const isStaff = user.role !== 'viewer'
  const { requestDate } = command
  if (new Date(`${requestDate}T00:00:00Z`).getUTCDay() === 0) {
    throw new VehicleRequestError('วันอาทิตย์ปิดรับคำขอ กรุณาเลือกวันจันทร์–เสาร์', 400)
  }
  // ตรงกับฟอร์ม: staff เร็วสุด "วันนี้", ผู้ขอทั่วไปตามกติกาเวลารับคำขอ/อนุมัติเร่งด่วน (เวลาไทย)
  if (isStaff) {
    if (requestDate < thaiToday(now)) throw new VehicleRequestError('เลือกวันย้อนหลังไม่ได้', 400)
  } else {
    await assertViewerBookingWindow(db, user.uid, requestDate, now)
  }

  const profile = (await db.doc(`users/${user.uid}`).get()).data() ?? {}
  const profileName = typeof profile.name === 'string' ? profile.name : ''
  // ลำดับเริ่มต้นเป็นแค่ "ตัวตั้ง" — ตัวจริงถูกจัดสรรในธุรกรรมอีกที กันสองคนส่งพร้อมกันแล้วทับกัน
  const startSeq = (await db.collection('vehicleRequests').where('requestDate', '==', requestDate).select().get()).size + 1

  const needsSiteLookup = command.destinations.some(d => d.category === 'custom' && d.saveAsSite && !d.siteId && d.coordinates.trim())
  const knownSites: SavedPlace[] = needsSiteLookup
    ? (await db.collection('sites').get()).docs.map(s => {
        const data = s.data()
        return { id: s.id, name: typeof data.name === 'string' ? data.name : '', latitude: data.latitude, longitude: data.longitude }
      })
    : []
  const sitePlan = planCustomSites(command.destinations, knownSites, () => db.collection('sites').doc().id)
  const names = {
    createdNames: [...new Set(sitePlan.createdNames)],
    reusedNames: [...new Set(sitePlan.reusedNames)],
    unsavedNames: [...new Set(sitePlan.unsavedNames)],
  }

  const destinations = sitePlan.destinations.map(d => {
    // ตัวแปลงเดียวกับตัวตรวจ (ผ่านตัวตรวจแล้วทุกจุด) — ไม่แปลงซ้ำด้วยวิธีอื่นจนได้ค่าคนละตัว
    const { lat, lng } = parseThaiCoordinates(d.coordinates) ?? { lat: NaN, lng: NaN }
    return {
      type: d.category === 'custom' ? 'other' : 'site',
      siteId: d.siteId || null,
      siteName: d.category === 'custom' ? d.customName : d.siteName,
      customName: d.category === 'custom' ? d.customName : null,
      lat: isNaN(lat) ? 0 : lat,
      lng: isNaN(lng) ? 0 : lng,
      jobDescription: d.jobDescription,
      requestTime: d.requestTime || '08:30',
    }
  })

  const requestData = {
    requestDate,
    requestTime: command.requestTime || '08:30',
    requestedBy: command.requestedBy || profileName || user.email || 'Unknown',
    requestedByEmail: user.email,
    requestedByPhone: typeof profile.phone === 'string' ? profile.phone : '',
    userId: user.uid,
    userEmail: user.email,
    destinations,
    note: command.note,
    // ผู้ขอทั่วไป → pending รอคนจัดรถกด "รับเรื่อง" · คนจัดรถ/แอดมินสร้างเอง → รับเรื่องแล้วในตัว เข้ากองจัดคิวทันที
    status: isStaff ? 'in_progress' : 'pending',
    ...(isStaff ? { acknowledgedBy: profileName || user.email || 'Dispatcher', acknowledgedAt: now.toISOString() } : {}),
    createdAt: FieldValue.serverTimestamp(),
  }

  return db.runTransaction(async t => {
    // อ่านให้ครบก่อนเขียน: คำสั่งนี้เคยสำเร็จหรือยัง → หาเลขว่าง (อ่านผ่านธุรกรรม = Firestore จดว่าเราพึ่งพา "รหัสนี้ยังว่าง")
    const replayInTx = storedResult((await t.get(operationRef)).data(), user.uid)
    if (replayInTx) return replayInTx
    const requestId = await findFreeRequestId(
      { exists: async id => (await t.get(db.doc(`vehicleRequests/${id}`))).exists },
      requestIdPrefix(requestDate), startSeq,
    )
    for (const site of sitePlan.newSites) {
      t.create(db.doc(`sites/${site.id}`), {
        ...site, address: '', status: 'Active', isUserAdded: true,
        addedBy: user.email, addedByName: profileName || user.email,
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    t.create(db.doc(`vehicleRequests/${requestId}`), { ...requestData, id: requestId, requestId })
    t.create(operationRef, { userId: user.uid, requestId, ...names, createdAt: FieldValue.serverTimestamp() })
    return { requestId, ...names }
  })
}
