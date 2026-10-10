/**
 * ล้างสำเนา API ส่วนตัวที่ service worker รุ่นเก่าเก็บไว้ (แคช "apis") — เรียกตอนออกจากระบบ
 * เครื่องร่วมกัน: staff ออก → อีกคนเข้า/ไม่ล็อกอิน → ห้ามได้ข้อมูล staff เดิมตอน offline (SEC-06)
 * ไม่มี Cache Storage (เบราว์เซอร์เก่า/โหมดส่วนตัว) หรือล้างไม่ได้ = ข้ามเงียบ ๆ ไม่ขวางการออกจากระบบ
 */
export async function clearPrivateApiCache(): Promise<void> {
  try {
    if (typeof caches !== "undefined") await caches.delete("apis")
  } catch {
    // ignore
  }
}
