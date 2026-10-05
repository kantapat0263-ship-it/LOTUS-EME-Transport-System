/**
 * ข้อมูลตัวอย่างของชั้นน้ำท่วม — ใช้เฉพาะ dev (`/api/road-events?sample=1`) และในเทสต์
 * ห้ามใช้เป็นตัวสำรองตอนต้นทางล้มเด็ดขาด · ทุกชื่อขึ้นต้น "[ตัวอย่าง]" · เวลาอิง now เพื่อไม่ให้เก่าเกินเกณฑ์ตามวันที่รัน
 */

const MIN_MS = 60_000

/** epoch ms → "YYYY-MM-DD HH:MM:SS" เวลาไทย (ผกผันกับ parseThaiTime) */
export function formatThaiTimestamp(ms: number): string {
  const d = new Date(ms + 7 * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/** payload รูปเดียวกับ POPNIX api_roads.php */
export function buildSampleRoadsPayload(now: number): { summary: Record<string, unknown>; roads: unknown[] } {
  const ago = (min: number) => formatThaiTimestamp(now - min * MIN_MS)
  const rec = (code: string, name: string, lat: number, lng: number, extra: Record<string, unknown>) => ({
    code, kind: 1, grp: 1, name: `[ตัวอย่าง] ${name}`, road: null, district: null, dir: null, lat, lng, since: null, ...extra,
  })
  return {
    summary: { latest: ago(3), stale: false, scrape_failing: false },
    roads: [
      rec('SAMPLE.01', 'ถ.วิภาวดีรังสิต (ห้าแยกลาดพร้าว)', 13.8167, 100.5605,
        { road: 'ถนนวิภาวดีรังสิต', district: 'จตุจักร', level: 'flood', depth: 25, measured_at: ago(8), since: ago(40) }),
      rec('SAMPLE.02', 'ถ.รามคำแหง (แยกลำสาลี)', 13.7735, 100.6420,
        { road: 'ถนนรามคำแหง', district: 'บางกะปิ', level: 'slight', depth: 7, measured_at: ago(20) }),
      rec('SAMPLE.03', 'ถ.สุขุมวิท 71', 13.7210, 100.5980,
        { road: 'ถนนสุขุมวิท', district: 'วัฒนา', grp: 2, level: 'flood', depth: 20, measured_at: ago(70) }),
      rec('SAMPLE.04', 'อุโมงค์ทดสอบ', 13.7460, 100.5340,
        { kind: 2, district: 'ปทุมวัน', level: 'flood', depth: null, measured_at: ago(5) }),
      rec('SAMPLE.05', 'จุดวัดขัดข้อง', 13.7000, 100.4800, { level: 'off', depth: null, measured_at: ago(50) }),
      rec('SAMPLE.06', 'ถ.แห้ง', 13.7600, 100.5000, { level: 'dry', depth: 0, measured_at: ago(6) }),
    ],
  }
}
