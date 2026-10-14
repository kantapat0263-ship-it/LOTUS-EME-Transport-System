/**
 * ชั่วโมงจากเวลาเปิด/ปิดรับคำขอในตั้งค่าบริษัท ("HH:MM") — ใช้ตัวเดียวกันทั้งฟอร์มขอรถและ server
 * เดิมฟอร์มมีสองแบบ: `Number(x) || 16` ทำให้ "00:00" กลายเป็นค่าเริ่มต้น ขณะที่อีกที่อ่านเป็น 0 → ปุ่มกับการส่งตัดสินไม่ตรงกัน
 * ใช้ค่าเริ่มต้นเฉพาะเมื่อไม่มีค่า/อ่านไม่ได้
 */
export function settingHour(value: unknown, fallback: number): number {
  if (typeof value !== "string" || value.trim() === "") return fallback
  const hour = Number(value.split(":")[0])
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : fallback
}

/** เวลารับคำขอของผู้ขอทั่วไป — ค่าเริ่มต้นเดิมของฟอร์ม เปิด 08:00 ปิด 16:00 */
export function requestHours(settings: { requestOpenTime?: unknown; requestCloseTime?: unknown } | null | undefined) {
  return { openHour: settingHour(settings?.requestOpenTime, 8), closeHour: settingHour(settings?.requestCloseTime, 16) }
}

export function isOutsideRequestHours(bangkokHour: number, settings: Parameters<typeof requestHours>[0]): boolean {
  const { openHour, closeHour } = requestHours(settings)
  return bangkokHour >= closeHour || bangkokHour < openHour
}
