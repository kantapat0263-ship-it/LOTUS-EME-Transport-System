/**
 * อธิบาย "จังหวะการส่งคำขอ" ของงานหนึ่งจุด — ส่งเมื่อไหร่ ล่วงหน้ากี่วัน ส่งนอกเวลาไหม
 * ใช้โชว์ให้คนจัดคิว/แอดมินเห็นหลังจัดรถแล้ว (เวลาส่งถูก snapshot ติดมากับ stop ตอนจัดรถ)
 * เวลาทั้งหมดคิดเป็นเวลาไทย (UTC+7)
 */

const TH_OFFSET_MS = 7 * 60 * 60 * 1000

export interface RequestTiming {
  /** "22/8 16:02" */
  submittedLabel: string
  /** จำนวนวันที่ส่งล่วงหน้าก่อนวันใช้รถ (วันเดียวกัน = 0, ส่งหลังวันใช้รถ = ติดลบ) */
  leadDays: number
  /** "ล่วงหน้า 2 วัน" / "วันเดียวกัน" / "ส่งย้อนหลัง" */
  leadLabel: string
  /** ส่งนอกช่วงรับคำขอ (≥ closeHour หรือ < openHour เวลาไทย) */
  outsideHours: boolean
}

/** ส่วนประกอบวันเวลาไทยของ unix ms */
function thaiParts(ms: number) {
  const d = new Date(ms + TH_OFFSET_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() }
}

/** วันที่ (yyyy-MM-dd) → จำนวนวันนับจาก epoch (UTC) ใช้หาผลต่างเป็น "วันปฏิทิน" */
function dayNumber(y: number, m: number, d: number) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function describeRequestTiming(
  requestedAtMs: number | null | undefined,
  requestDate: string | null | undefined,
  opts: { openHour?: number; closeHour?: number } = {}
): RequestTiming | null {
  if (requestedAtMs == null || !Number.isFinite(requestedAtMs) || !requestDate) return null
  const openHour = opts.openHour ?? 8
  const closeHour = opts.closeHour ?? 16
  const p = thaiParts(requestedAtMs)
  const submittedLabel = `${p.d}/${p.m} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`

  const [ry, rm, rd] = requestDate.split('-').map(Number)
  const leadDays = dayNumber(ry, rm, rd) - dayNumber(p.y, p.m, p.d)
  const leadLabel = leadDays > 0 ? `ล่วงหน้า ${leadDays} วัน` : leadDays === 0 ? 'วันเดียวกัน' : 'ส่งย้อนหลัง'

  const outsideHours = p.hh >= closeHour || p.hh < openHour
  return { submittedLabel, leadDays, leadLabel, outsideHours }
}

/** แปลงค่า createdAt ที่มาได้หลายรูปแบบ (Firestore Timestamp / ms / ISO) → unix ms */
export function toMillis(v: any): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v?.toMillis === 'function') return v.toMillis()
  if (typeof v?.seconds === 'number') return v.seconds * 1000
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null }
  return null
}
