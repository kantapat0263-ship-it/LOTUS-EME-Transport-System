/** แคชที่ service worker รุ่นเก่าอาจเก็บคำตอบส่วนตัวไว้: /api/* ("apis") และ Firestore/Firebase Auth ("cross-origin") — ตรงกับ worker/index.js */
export const PRIVATE_CACHE_NAMES = ["apis", "cross-origin"] as const

/**
 * ล้างสำเนา API ส่วนตัวที่ service worker รุ่นเก่าเก็บไว้ — เรียกตอนออกจากระบบ
 * เครื่องร่วมกัน: staff ออก → อีกคนเข้า/ไม่ล็อกอิน → ห้ามได้ข้อมูล staff เดิมตอน offline (SEC-06)
 * ไม่มี Cache Storage (เบราว์เซอร์เก่า/โหมดส่วนตัว) หรือล้างไม่ได้ = ข้ามเงียบ ๆ ไม่ขวางการออกจากระบบ
 */
export async function clearPrivateApiCache(): Promise<void> {
  try {
    if (typeof caches !== "undefined") await Promise.all(PRIVATE_CACHE_NAMES.map((name) => caches.delete(name)))
  } catch {
    // ignore
  }
}
