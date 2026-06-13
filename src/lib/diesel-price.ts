/**
 * ดึง/แกะราคาน้ำมัน "ดีเซล B7" จากแหล่งราคาน้ำมันออนไลน์
 *
 * หลักคิด: shape ของ JSON แต่ละแหล่งไม่เหมือนกัน + อาจเปลี่ยนเมื่อไหร่ก็ได้
 * → แกะแบบ "เดินทุก node หา key/label ที่สื่อถึง B7/ดีเซล แล้วเก็บค่าที่อยู่ในช่วงราคาสมเหตุผล"
 *   ถ้าแกะไม่ได้ → คืน null (ฝั่ง cron จะ "ไม่เขียนทับ" ราคาเดิม กันค่าเพี้ยน)
 *
 * ช่วงราคาดีเซลไทยอยู่ ~25-45 บาท → กันค่าหลุด (เช่น เลขทะเบียน, ปี, %).
 */
export const DIESEL_SANE_MIN = 20
export const DIESEL_SANE_MAX = 60

function toSanePrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n)) return null
  if (n < DIESEL_SANE_MIN || n > DIESEL_SANE_MAX) return null
  return n
}

/** key/label ที่บ่งบอกว่าเป็น "ดีเซล B7" (ไม่เอา B20 / พรีเมียม ที่ราคาต่างกัน) */
function looksLikeB7(label: string): boolean {
  const s = label.toLowerCase()
  if (/b20|premium|พรีเมียม|พลัส|plus/.test(s)) return false
  // ตรงตัว b7 หรือ "ดีเซล/diesel" (ทั่วไป default คือ B7)
  return /b7/.test(s) || /ดีเซล/.test(s) || /diesel/.test(s)
}

/**
 * เดินโครงสร้าง JSON หาราคา B7 ทั้งหมดที่เจอ แล้วคืน "ค่ามัธยฐาน" (กันค่าหลุดของบางปั๊ม)
 * คืน null เมื่อไม่เจอค่าที่สมเหตุผลเลย
 */
export function extractB7Price(data: unknown): number | null {
  const candidates: number[] = []

  const walk = (node: unknown, keyHint: string) => {
    if (node == null) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, keyHint)
      return
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if ((typeof v === 'number' || typeof v === 'string') && looksLikeB7(k)) {
          const p = toSanePrice(v)
          if (p != null) candidates.push(p)
        }
        walk(v, k)
      }
      return
    }
    // leaf string/number ที่ key ระดับบนสื่อถึง B7 (เช่น { "ดีเซล B7": "32.94" } จับที่ object ด้านบนแล้ว)
    if ((typeof node === 'number' || typeof node === 'string') && looksLikeB7(keyHint)) {
      const p = toSanePrice(node)
      if (p != null) candidates.push(p)
    }
  }

  walk(data, '')

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a - b)
  const mid = Math.floor(candidates.length / 2)
  // มัธยฐาน (กรณีคู่ เอาตัวล่างของกลางก็พอ — ราคามักเท่ากันอยู่แล้ว)
  return candidates[mid]
}

/**
 * แกะราคา B7 จาก "หน้าเว็บ HTML" (แหล่งที่ไม่ใช่ JSON API เช่น kapook)
 *
 * วิธี: ถอด tag/script/style ออกเหลือข้อความล้วน → หา label ที่สื่อถึงดีเซล
 *   แล้วตามด้วยราคารูปแบบ \d{1,2}\.\d{2} ในระยะใกล้ ๆ (กันไปคว้าเลขคนละคอลัมน์)
 *   - กรอง B20/พรีเมียม ด้วย looksLikeB7, กันค่าหลุดช่วงด้วย toSanePrice
 *   - คืน "มัธยฐาน" ของทุกค่าที่เจอ (กัน outlier บางปั๊ม) — ไม่เจอเลยคืน null
 *
 * reuse logic เดียวกับ extractB7Price (JSON) เพื่อให้พฤติกรรมการกรอง/sanity สอดคล้องกัน
 */
export function extractB7PriceFromHtml(html: string): number | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')

  const candidates: number[] = []
  // หา "ราคา" ทุกตัวก่อน (รูปแบบ \d{1,2}\.\d{2}) แล้วค่อยดูบริบทย้อนหลัง
  // เหตุผล: anchor ที่ label โดยตรงไม่ได้ เพราะเลข "7" ใน "B7" ไปตัด gap ก่อนถึงราคา
  const re = /\d{1,2}\.\d{2}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 30), m.index)
    // เอาข้อความตั้งแต่ "ตัวบ่งชี้ดีเซลตัวแรก" ในบริบทถึงหน้าราคา มาเช็ค
    // (ครอบทั้ง prefix อย่าง "ดีเซลพรีเมียม" → looksLikeB7 จะตัดทิ้งได้)
    const label = before.match(/(?:ดีเซล|diesel|b7)[\s\S]*$/i)?.[0]
    if (!label || !looksLikeB7(label)) continue // ไม่ใช่ดีเซล หรือเป็น B20/พรีเมียม → ข้าม
    const p = toSanePrice(m[0])
    if (p != null) candidates.push(p)
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a - b)
  return candidates[Math.floor(candidates.length / 2)]
}
