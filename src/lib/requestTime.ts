/**
 * เวลาในใบขอรถ (ช่องพิมพ์อิสระ) → "HH:MM" · ว่าง = "" · ไม่ใช่เวลาจริง = null
 * รับทั้ง "06:30" และ "06.30" (คนไทยพิมพ์จุดบ่อย — เคยส่งใบไม่ผ่าน 2026-10-17) ตัด "น." ท้ายได้
 * ใช้ทั้งฟอร์ม (แปลงก่อนส่ง) และ server (ฟอร์มรุ่นเก่าที่เปิดค้างยังส่งจุดมา)
 */
export function normalizeRequestTime(raw: string): string | null {
  if (raw.trim() === '') return ''
  // ตัด "น." หลังเช็กค่าว่าง — กรอกแค่ "น." = ผิด (ไม่ใช่ไม่ระบุเวลา ซึ่ง server จะใส่ 08:30 ให้)
  const s = raw.trim().replace(/\s*น\.?$/, '')
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}
