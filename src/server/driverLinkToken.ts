import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

/**
 * token ของลิงก์ใบงานคนขับ (/driver/{tripId}?t=...) — server-only
 *
 * token = HMAC-SHA256(key, tripId + รุ่นลิงก์ + เวลาสร้างเอกสารทริป) → คาดเดาไม่ได้ และผูกกับทริปเดียว (ใช้ข้ามไปเปิดทริปอื่นไม่ได้)
 * เวลาสร้างเอกสาร (createTime) กันกรณีลบทริปแล้วออก Trip ID เดิมซ้ำ (T-DDMM-NNNd ไล่จากจำนวนทริป) — token ของทริปเก่าใช้กับทริปใหม่ไม่ได้
 * ฐานข้อมูลเก็บแค่ "รุ่น" ต่อทริป (driverLinks/{tripId}.version) ไม่เก็บ token → ข้อมูลรั่วก็ประกอบลิงก์ไม่ได้
 * - ส่งลิงก์ซ้ำ (อัปเดตใบสรุปแล้วส่งใหม่) = รุ่นเดิม → ลิงก์เดิม คนขับไม่งง และเห็นข้อมูลล่าสุดเสมอ
 * - "สร้างลิงก์ใหม่ (ยกเลิกลิงก์เดิม)" = เลื่อนรุ่น → ลิงก์เก่าใช้ไม่ได้ทันที
 * key ได้จาก private key ของ service account ที่ server มีอยู่แล้ว (FIREBASE_SERVICE_ACCOUNT_BASE64) ผ่าน HKDF
 * ไม่ต้องตั้ง secret ใหม่ · ถ้าเปลี่ยน service account key ลิงก์เดิมทั้งหมดจะใช้ไม่ได้ (คัดลอก/ส่งลิงก์ใหม่ได้ตามปกติ)
 */
function linkKey(): Buffer {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is not set')
  const privateKey: unknown = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))?.private_key
  if (typeof privateKey !== 'string' || privateKey.length < 32) throw new Error('service account private_key is missing')
  return Buffer.from(hkdfSync('sha256', privateKey, 'lotus-eme', 'driver-link-token-v1', 32))
}

export const DRIVER_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** เวลาสร้างเอกสารทริปแบบละเอียดถึงนาโนวินาที (DocumentSnapshot.createTime ของ firebase-admin) */
export function tripCreatedKey(createTime: { seconds: number; nanoseconds: number } | undefined): string | null {
  return createTime ? `${createTime.seconds}.${String(createTime.nanoseconds).padStart(9, '0')}` : null
}

export function driverLinkToken(tripId: string, version: number, createdKey: string): string {
  return createHmac('sha256', linkKey()).update(`${tripId}\n${version}\n${createdKey}`).digest('base64url')
}

export function isValidDriverLinkToken(tripId: string, version: number, createdKey: string, token: string): boolean {
  if (!DRIVER_LINK_TOKEN_PATTERN.test(token)) return false
  const expected = Buffer.from(driverLinkToken(tripId, version, createdKey))
  const actual = Buffer.from(token)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** ลิงก์ใช้ได้ถึงสิ้นวันที่ (วันทริป + 7 วัน) ตามเวลาไทย · ไม่มีวันทริป = ถือว่าหมดอายุ */
export const DRIVER_LINK_VALID_DAYS = 7

export function isDriverLinkExpired(tripDate: unknown, today: string): boolean {
  if (typeof tripDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) return true
  const last = new Date(`${tripDate}T00:00:00Z`)
  if (Number.isNaN(last.getTime())) return true
  last.setUTCDate(last.getUTCDate() + DRIVER_LINK_VALID_DAYS)
  return today > last.toISOString().slice(0, 10)
}

/** id เอกสารทริปที่รับจาก URL/ข้อมูลภายนอก — กัน path แปลก ๆ ก่อนนำไปอ่าน Firestore */
export function isSafeTripId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/') && value !== '.' && value !== '..'
}
