/**
 * เที่ยวไหนเป็นของผู้ขอคนนี้ — หน้า "ประวัติการส่ง" และ Dashboard ของผู้ขอ (viewer) ใช้คัดเที่ยว
 *
 * เห็นเมื่อจุดงานมีรหัสบัญชีของเรา (`requestedByUserId` — หน้าจัดกลุ่มเขียนให้ทุกจุดตั้งแต่ 2026-09-21) **หรือ** ชื่อ/อีเมลผู้ขอตรงกับเรา (แบบเดิม)
 * - รหัส: พิมพ์ช่อง "ชื่อผู้ขอใช้รถ" ไม่ตรงชื่อบัญชี หรือเปลี่ยนชื่อโปรไฟล์ เที่ยวก็ไม่หาย (เดิมหาย)
 * - ชื่อ: คงไว้ เพราะคนจัดรถ/เพื่อนกรอกใบแทน (รหัสเป็นของคนกรอก) และงานแทรกที่เลื่อนวัน ผู้ขอที่ระบุชื่อต้องยังเห็น
 *   (ผลข้างเคียงเดิมที่ยังอยู่: คนชื่อตรงกันพอดีเห็นเที่ยวของกัน — เลือกแบบนี้เพื่อไม่ให้เที่ยวที่เคยเห็นหายไป, ตัดสิน 2026-11-07)
 * ช่องระดับทริปเป็นข้อมูลรุ่นเก่า คงไว้เหมือนเดิม · ค่าว่างไม่นับเป็นของใคร
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

  return (trip.stops || []).some(stop => (uid !== null && stop?.requestedByUserId === uid) || isMe(stop?.requestedBy))
}
