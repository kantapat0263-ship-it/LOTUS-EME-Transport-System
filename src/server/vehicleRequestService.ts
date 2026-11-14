import { randomUUID } from 'node:crypto'
import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import { officeLocationFrom, officeStopProblem, parseThaiCoordinates } from '@/lib/requestCoordinates'
import type { ActiveTokenUser } from '@/firebase/admin'
import { findFreeRequestId, requestIdPrefix } from '@/lib/requestId'
import { planCustomSites, type SavedPlace } from '@/lib/customSite'
import { thaiToday } from '@/lib/driverLeave'
import { viewerRequestDateProblem } from '@/lib/requestWindow'
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


/** ผลที่บันทึกไว้ของคำสั่งนี้ (ส่งซ้ำหลังบันทึกสำเร็จแล้ว = คืนผลเดิม ไม่สร้างใบใหม่) */
function storedResult(data: DocumentData | undefined, uid: string): VehicleRequestResult | null {
  if (!data) return null
  if (data.userId !== uid) throw new VehicleRequestError('ข้อมูลใบขอรถไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วส่งอีกครั้ง', 409)
  return { requestId: data.requestId, createdNames: data.createdNames ?? [], reusedNames: data.reusedNames ?? [], unsavedNames: data.unsavedNames ?? [] }
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
  const settings = (await db.doc('companySettings/default').get()).data() ?? {}
  // จุดหมายเป็นออฟฟิศ = ไม่รับ ทุกคน (ข้อความเดียวกับฟอร์ม) — ตรวจเฉพาะใบที่ส่งใหม่ ใบเก่าไม่ถูกตรวจซ้ำ
  const office = officeLocationFrom(settings)
  for (const [i, d] of command.destinations.entries()) {
    const name = (d.category === 'custom' ? d.customName : d.siteName).trim()
    const problem = officeStopProblem(d.coordinates, office, `จุดที่ ${i + 1}${name && name.length <= 80 ? ` (${name})` : ''}`)
    if (problem) throw new VehicleRequestError(problem, 400)
  }
  // ตรงกับฟอร์ม: staff เร็วสุด "วันนี้" ไม่ติดเวลารับคำขอ · ผู้ขอทั่วไปตามกติกาเวลารับคำขอ (เวลาไทย, lib/requestWindow)
  if (isStaff) {
    if (requestDate < thaiToday(now)) throw new VehicleRequestError('เลือกวันย้อนหลังไม่ได้', 400)
  } else {
    const problem = viewerRequestDateProblem(requestDate, now, settings)
    if (problem) throw new VehicleRequestError(problem, 400)
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

  // ใบรับของไปส่งต่อ (ตัวตรวจรับรองรูปใบแล้ว: จุดรับ ≥ 1 + จุดส่งท้ายใบ) — ผูกทุกจุดด้วยรหัสกลุ่มเดียว
  // จุดรับเก็บชื่อจุดส่งไว้ทำป้าย "ไปส่งต่อที่ ..." เมื่อจุดส่งไปอยู่คันอื่น
  const placeName = (d: { category: string; customName: string; siteName: string }) => d.category === 'custom' ? d.customName : d.siteName
  const dropDraft = sitePlan.destinations.find(d => d.transferRole === 'drop')
  const transferId = dropDraft ? `tf_${randomUUID()}` : ''
  // ใบไปหลายจุดตามลำดับ (ตัวตรวจรับรองแล้ว: ทุกจุดมีลำดับตรงตำแหน่ง) — ผูกทุกจุดด้วยรหัสชุดเดียว + จำนวนจุดไว้ทำป้าย "จุดที่ 2/3"
  // ออกรหัสก่อน transaction — transaction ลองใหม่ใช้รหัสเดิม
  const sequenceId = sitePlan.destinations.some(d => d.sequenceIndex !== undefined) ? `sq_${randomUUID()}` : ''
  const sequenceSize = sitePlan.destinations.length
  const destinations = sitePlan.destinations.map(d => {
    // ตัวแปลงเดียวกับตัวตรวจ (ผ่านตัวตรวจแล้วทุกจุด) — ไม่แปลงซ้ำด้วยวิธีอื่นจนได้ค่าคนละตัว
    const { lat, lng } = parseThaiCoordinates(d.coordinates) ?? { lat: NaN, lng: NaN }
    const transfer = transferId && d.transferRole
      ? { transferRole: d.transferRole, transferId, ...(d.transferRole === 'pickup' ? { transferDropName: placeName(dropDraft!) } : {}) }
      : {}
    const sequence = sequenceId && d.sequenceIndex !== undefined ? { sequenceId, sequenceIndex: d.sequenceIndex, sequenceSize } : {}
    return {
      type: d.category === 'custom' ? 'other' : 'site',
      siteId: d.siteId || null,
      siteName: d.category === 'custom' ? d.customName : d.siteName,
      customName: d.category === 'custom' ? d.customName : null,
      lat: isNaN(lat) ? 0 : lat,
      lng: isNaN(lng) ? 0 : lng,
      jobDescription: d.jobDescription,
      requestTime: d.requestTime || '08:30',
      ...transfer,
      ...sequence,
    }
  })

  const requestData = {
    requestDate,
    requestTime: command.requestTime || '08:30',
    requestedBy: command.requestedBy || profileName || user.email || 'Unknown',
    requestedByEmail: user.email,
    // คนจัดรถกรอกใบแทนผู้ขอ = เบอร์ผู้ขอ (คนขับโทรหาคนนี้) · ผู้ขอทั่วไปส่งมาก็ไม่ใช้ — ใช้เบอร์ในโปรไฟล์ตัวเองเสมอ
    requestedByPhone: isStaff && command.requestedByPhone?.trim()
      ? command.requestedByPhone.trim()
      : typeof profile.phone === 'string' ? profile.phone : '',
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
