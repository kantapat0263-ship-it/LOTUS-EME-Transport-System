/**
 * นาทีของวันจากเวลาเปิด/ปิดรับคำขอในตั้งค่าบริษัท ("HH:MM") — ใช้ตัวเดียวกันทั้งฟอร์มขอรถและ server
 * เดิมฟอร์มมีสองแบบ: `Number(x) || 16` ทำให้ "00:00" กลายเป็นค่าเริ่มต้น ขณะที่อีกที่อ่านเป็น 0 → ปุ่มกับการส่งตัดสินไม่ตรงกัน
 * นับนาทีด้วย (2026-11-07): เดิมอ่านแค่ชั่วโมง — ตั้ง "17:30" แล้วระบบปิดรับจริงตั้งแต่ 17:00
 * ใช้ค่าเริ่มต้นเฉพาะเมื่อไม่มีค่า/อ่านไม่ได้
 */
export function settingMinutes(value: unknown, fallbackHour: number): number {
  const m = typeof value === "string" ? /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?$/.exec(value.trim()) : null
  if (!m) return fallbackHour * 60
  const hour = Number(m[1])
  const minute = m[2] === undefined ? 0 : Number(m[2])
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : fallbackHour * 60
}

/** เวลารับคำขอของผู้ขอทั่วไป (นาทีของวัน) — ค่าเริ่มต้นเดิมของฟอร์ม เปิด 08:00 ปิด 16:00 */
function requestWindowMinutes(settings: { requestOpenTime?: unknown; requestCloseTime?: unknown } | null | undefined) {
  return { openMin: settingMinutes(settings?.requestOpenTime, 8), closeMin: settingMinutes(settings?.requestCloseTime, 16) }
}

/** นอกเวลารับคำขอ ณ เวลา now — ตัดสินด้วยเวลาไทยเสมอ ไม่ขึ้นกับเขตเวลาเครื่อง */
export function isOutsideRequestHours(now: Date, settings: Parameters<typeof requestWindowMinutes>[0]): boolean {
  const { openMin, closeMin } = requestWindowMinutes(settings)
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const minuteOfDay = bangkok.getUTCHours() * 60 + bangkok.getUTCMinutes()
  return minuteOfDay >= closeMin || minuteOfDay < openMin
}
