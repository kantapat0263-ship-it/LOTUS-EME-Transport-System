/**
 * ยามกัน "ผลของคำขอเก่าที่ตอบกลับช้า มาเขียนทับผลของคำขอใหม่"
 * เช่นเปลี่ยนวัน 5 → 6 ต.ค. แล้ว query ของ 5 ต.ค. ตอบกลับทีหลัง → หน้าโชว์ทริป 5 ต.ค. ทั้งที่เลือก 6 ต.ค.
 *
 * ใช้: `const isLatest = beginRequest()` ตอนเริ่มคำขอ แล้วเช็ก `isLatest()` ก่อน set state ทุกครั้ง
 */
export function createLatestRequestGuard() {
  let seq = 0
  return () => {
    const mine = ++seq
    return () => mine === seq
  }
}
