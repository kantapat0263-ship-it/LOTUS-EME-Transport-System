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

const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`

/**
 * ข้อความบอกผู้ขอทั่วไปตอนนอกเวลารับคำขอ (null = อยู่ในเวลา) — ใช้ทั้งกล่องแจ้งในฟอร์มและข้อความตอนส่งไม่ผ่าน
 * ก่อนเวลาเปิด = รอเปิดรับ · ตั้งแต่เวลาปิด = ให้แจ้งคนจัดรถ (คนจัดรถแทรกงานให้)
 */
export function closedTomorrowMessage(now: Date, settings: Parameters<typeof requestWindowMinutes>[0]): string | null {
  if (!isOutsideRequestHours(now, settings)) return null
  const { openMin, closeMin } = requestWindowMinutes(settings)
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const beforeOpen = bangkok.getUTCHours() * 60 + bangkok.getUTCMinutes() < openMin
  return beforeOpen
    ? `ยังไม่ถึงเวลาเปิดรับใบขอรถของพรุ่งนี้ (รับ ${clock(openMin)}–${clock(closeMin)} น.) — ส่งได้ตั้งแต่ ${clock(openMin)} น.`
    : `เลยเวลาปิดรับใบขอรถของพรุ่งนี้แล้ว (ปิด ${clock(closeMin)} น.) — ถ้าต้องใช้รถพรุ่งนี้ ให้แจ้งคนจัดรถโดยตรง คนจัดรถจะแทรกงานให้`
}

/**
 * ผู้ขอทั่วไปส่งใบของวันนี้ได้ไหม ณ เวลา now (null = ได้ / ข้อความ = เหตุผลที่ไม่ได้) — ฟอร์มกับ server ใช้ตัวเดียวกัน
 * - ต้องล่วงหน้าอย่างน้อย 1 วัน
 * - ใบของ "พรุ่งนี้" ส่งได้เฉพาะในเวลารับคำขอ — ผู้ใช้กำหนด 2026-11-14: เลยเวลาปิดแล้วปิดเด็ดขาด ไม่มีขออนุมัติพิเศษ
 *   (เดิมผ่านได้ถ้า Dispatcher อนุมัติ urgentRequests) ให้แจ้งคนจัดรถ คนจัดรถแทรกงานให้
 * - วันมะรืนเป็นต้นไปส่งได้ทุกเวลา · วันอาทิตย์ตรวจแยกที่จุดเรียก
 */
export function viewerRequestDateProblem(requestDate: string, now: Date, settings: Parameters<typeof requestWindowMinutes>[0]): string | null {
  const tomorrow = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)
  if (requestDate < tomorrowStr) return "ต้องขอล่วงหน้าอย่างน้อย 1 วัน"
  return requestDate === tomorrowStr ? closedTomorrowMessage(now, settings) : null
}
