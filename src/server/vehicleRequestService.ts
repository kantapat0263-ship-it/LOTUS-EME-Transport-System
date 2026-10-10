import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { ActiveTokenUser } from '@/firebase/admin'
import { createRequestWithUniqueId, requestIdPrefix } from '@/lib/requestId'
import { planCustomSites, type SavedPlace } from '@/lib/customSite'
import { thaiToday } from '@/lib/driverLeave'
import type { VehicleRequestCommand } from './vehicleRequestValidation'

export class VehicleRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * สร้างใบขอรถ + สถานที่ใหม่ที่ผู้ขอเลือก "บันทึกไว้ใช้ครั้งต่อไป" ในธุรกรรมเดียว (เดิมทำฝั่ง client)
 * ย้ายมา server เพราะการออกเลข VR ต้องนับ/อ่านใบของทุกคนในวันนั้น — client ของ viewer จะอ่านใบคนอื่นไม่ได้แล้ว
 * รูปแบบเลข + กันชนใช้ lib/requestId เดิม · status ตัดสินจาก role ที่ตรวจจาก token (ไม่เชื่อ client)
 */
export async function createVehicleRequest(db: Firestore, user: ActiveTokenUser, command: VehicleRequestCommand, now = new Date()) {
  const isStaff = user.role !== 'viewer'
  const { requestDate } = command
  if (new Date(`${requestDate}T00:00:00Z`).getUTCDay() === 0) {
    throw new VehicleRequestError('วันอาทิตย์ปิดรับคำขอ กรุณาเลือกวันจันทร์–เสาร์', 400)
  }
  // ตรงกับฟอร์ม: staff เร็วสุด "วันนี้", ผู้ขอทั่วไปเร็วสุด "พรุ่งนี้" (เวลาไทย)
  if (requestDate < addDays(thaiToday(now), isStaff ? 0 : 1)) {
    throw new VehicleRequestError(isStaff ? 'เลือกวันย้อนหลังไม่ได้' : 'ต้องขอล่วงหน้าอย่างน้อย 1 วัน', 400)
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

  const destinations = sitePlan.destinations.map(d => {
    const [lat, lng] = d.coordinates.split(',').map(s => parseFloat(s.trim()))
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

  const requestId = await createRequestWithUniqueId(
    fn => db.runTransaction(t => fn({
      // อ่านผ่านธุรกรรม เพื่อให้ Firestore จดไว้ว่าเราพึ่งพา "รหัสนี้ยังว่าง"
      exists: async id => (await t.get(db.doc(`vehicleRequests/${id}`))).exists,
      create: (id, data) => {
        for (const site of sitePlan.newSites) {
          t.create(db.doc(`sites/${site.id}`), {
            ...site, address: '', status: 'Active', isUserAdded: true,
            addedBy: user.email, addedByName: profileName || user.email,
            createdAt: FieldValue.serverTimestamp(),
          })
        }
        t.create(db.doc(`vehicleRequests/${id}`), data as Record<string, unknown>)
      },
    })),
    { prefix: requestIdPrefix(requestDate), startSeq, buildData: id => ({ ...requestData, id, requestId: id }) },
  )

  return {
    requestId,
    createdNames: [...new Set(sitePlan.createdNames)],
    reusedNames: [...new Set(sitePlan.reusedNames)],
    unsavedNames: [...new Set(sitePlan.unsavedNames)],
  }
}
