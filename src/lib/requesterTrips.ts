/**
 * เที่ยวไหนเป็นของผู้ขอคนนี้ — หน้า "ประวัติการส่ง" และ Dashboard ของผู้ขอ (viewer) ใช้คัดเที่ยว
 *
 * จุดงานที่มีรหัสบัญชีผู้ขอ (`requestedByUserId` — หน้าจัดกลุ่มเขียนให้ทุกจุดตั้งแต่ 2026-09-21) เทียบด้วยรหัสอย่างเดียว
 * เดิมเทียบชื่อ: คนชื่อซ้ำเห็นเที่ยวของกัน · พิมพ์ช่อง "ชื่อผู้ขอใช้รถ" ไม่ตรงชื่อบัญชี หรือเปลี่ยนชื่อโปรไฟล์ เที่ยวหายจากประวัติ
 * จุดเก่าที่ไม่มีรหัส (หรืองานที่คนจัดรถแทรกเอง) ยังเทียบชื่อ/อีเมลแบบเดิม · ช่องระดับทริปเป็นข้อมูลรุ่นเก่า คงไว้เหมือนเดิม
 */
export interface RequesterIdentity {
  uid?: string | null
  email?: string | null
  name?: string | null
}

interface RequesterStopLike {
  requestedBy?: unknown
  requestedByUserId?: unknown
}

interface RequesterTripLike {
  userId?: unknown
  requestedBy?: unknown
  requestedByEmail?: unknown
  requesterEmail?: unknown
  stops?: RequesterStopLike[] | null
}

const filled = (value: unknown): value is string => typeof value === 'string' && value !== ''

export function isRequesterTrip(trip: RequesterTripLike, me: RequesterIdentity): boolean {
  const uid = filled(me.uid) ? me.uid : null
  const email = filled(me.email) ? me.email : null
  const name = filled(me.name) ? me.name : null
  const isMe = (value: unknown) => filled(value) && (value === email || value === name)

  if (uid && trip.userId === uid) return true
  if (email && (trip.requestedByEmail === email || trip.requesterEmail === email)) return true
  if (isMe(trip.requestedBy)) return true

  return (trip.stops || []).some(stop =>
    filled(stop?.requestedByUserId) ? stop.requestedByUserId === uid : isMe(stop?.requestedBy)
  )
}
