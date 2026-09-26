/**
 * พ.ร.บ. / ภาษีรถ — pure helpers (มี unit test) · แจ้งเตือนในแอปเท่านั้น (ไม่ส่ง LINE)
 *
 * กติกาหลัก (ห้ามหลุด):
 *  - ไม่มีวันหมดอายุ = "ยังไม่มีข้อมูล" (ไม่ใช่ "ปกติ") และไม่เตือน — ห้ามเดาวัน
 *  - มีวันแต่เจ้าหน้าที่ยังไม่ยืนยัน = "รอยืนยัน" ไม่เตือน
 *  - ห้ามเลื่อนปีเอง: วันหมดอายุเปลี่ยนได้ทางเดียวคือคนบันทึก (ยืนยัน / ต่ออายุ / กดตั้งจากวันจดทะเบียน)
 *  - ผู้ใช้ยืนยัน: ภาษี = ครบรอบวันจดทะเบียนทุกปี และ พ.ร.บ. ต่อวันเดียวกัน → ตั้งวันเริ่มต้นจากวันจดทะเบียนได้
 *    (ตั้งครั้งเดียวแล้วเก็บไว้ — เลยวันแล้วยังไม่บันทึกต่อ = เกินกำหนด ไม่ขยับไปปีหน้าเอง)
 *  - รับทราบ / กำลังดำเนินการ ไม่เปลี่ยนสถานะ (ยังขึ้นเตือนจนกว่าจะบันทึกต่ออายุ)
 *
 * วันที่ทั้งหมดเป็นสตริง ค.ศ. `YYYY-MM-DD` ตามปฏิทินไทย (Asia/Bangkok)
 */
import type { ComplianceItem, ComplianceKind, VehicleCompliance } from '@/types/models'

export const KIND_LABEL: Record<ComplianceKind, string> = { tax: 'ภาษี', act: 'พ.ร.บ.' }

const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** วันนี้ตามเวลาไทย → `YYYY-MM-DD` */
export function todayBangkok(now: Date = new Date()): string {
  // en-CA ให้รูปแบบ YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now)
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function toUtcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** จำนวนวันจาก `from` ถึง `to` (to - from) */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000)
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function isLeap(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** วัน-เดือนเดิมในปี `year` (29 ก.พ. ในปีไม่อธิกสุรทิน → 28 ก.พ.) */
export function sameDayMonthInYear(iso: string, year: number): string {
  const [, m, d] = iso.split('-').map(Number)
  const day = m === 2 && d === 29 && !isLeap(year) ? 28 : d
  return `${year}-${pad(m)}-${pad(day)}`
}

/** "23 ต.ค. 2569" (พ.ศ.) */
export function formatThaiDate(iso?: string | null): string {
  if (!iso || !isIsoDate(iso)) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${THAI_MONTHS_SHORT[m - 1]} ${y + 543}`
}

// ─── สถานะ ──────────────────────────────────────────────────────────────────

export const DUE_SOON_DAYS = 30

export type ComplianceState = 'no-data' | 'unconfirmed' | 'ok' | 'due-soon' | 'due-today' | 'overdue'

export interface ComplianceStatus {
  state: ComplianceState
  /** วันที่เหลือ (ติดลบ = เกินกำหนด) — มีเฉพาะเมื่อมีวันหมดอายุ */
  daysLeft?: number
  expiry?: string
}

export function complianceStatus(item: ComplianceItem | undefined, today: string): ComplianceStatus {
  const expiry = item?.expiry
  if (!expiry || !isIsoDate(expiry)) return { state: 'no-data' }
  const daysLeft = daysBetween(today, expiry)
  if (!item?.confirmed) return { state: 'unconfirmed', daysLeft, expiry }
  if (daysLeft < 0) return { state: 'overdue', daysLeft, expiry }
  if (daysLeft === 0) return { state: 'due-today', daysLeft, expiry }
  if (daysLeft <= DUE_SOON_DAYS) return { state: 'due-soon', daysLeft, expiry }
  return { state: 'ok', daysLeft, expiry }
}

/** ข้อความสั้นสำหรับ badge บนการ์ด */
export function statusShortText(s: ComplianceStatus): string {
  switch (s.state) {
    case 'no-data':
      return 'ยังไม่มีข้อมูล'
    case 'unconfirmed':
      return 'รอยืนยันวัน'
    case 'ok':
      return `อีก ${s.daysLeft} วัน (${formatThaiDate(s.expiry)})`
    case 'due-soon':
      return `อีก ${s.daysLeft} วัน`
    case 'due-today':
      return 'ครบกำหนดวันนี้'
    case 'overdue':
      return `เกิน ${-(s.daysLeft as number)} วัน`
  }
}

// ─── เสนอวันจากวันจดทะเบียน ────────────────────────────────────────────────

/**
 * เสนอวันครบกำหนดภาษีจากวัน-เดือนจดทะเบียน — คืน "ตัวเลือก" ปีนี้กับปีหน้า
 * ให้เจ้าหน้าที่เลือกปีที่ถูกเอง (ไม่เดาว่าต่อถึงปีไหนแล้ว)
 */
export function suggestTaxExpiryCandidates(registrationDate: string | undefined, today: string): string[] {
  if (!registrationDate || !isIsoDate(registrationDate)) return []
  const y = Number(today.slice(0, 4))
  return [sameDayMonthInYear(registrationDate, y), sameDayMonthInYear(registrationDate, y + 1)]
}

/** วันครบรอบจดทะเบียนครั้งถัดไป (นับวันนี้ด้วย) = วันหมดอายุภาษี/พ.ร.บ. รอบปัจจุบัน */
export function nextRegistrationAnniversary(registrationDate: string | undefined, today: string): string | null {
  if (!registrationDate || !isIsoDate(registrationDate)) return null
  const y = Number(today.slice(0, 4))
  const thisYear = sameDayMonthInYear(registrationDate, y)
  return thisYear >= today ? thisYear : sameDayMonthInYear(registrationDate, y + 1)
}

/** เสนอวันหมดอายุรอบใหม่ = รอบเดิม + 1 ปี (วัน-เดือนเดิม) — ไม่ใช้วันที่จ่ายเงิน */
export function suggestRenewedExpiry(prevExpiry: string | null | undefined): string | null {
  if (!prevExpiry || !isIsoDate(prevExpiry)) return null
  return sameDayMonthInYear(prevExpiry, Number(prevExpiry.slice(0, 4)) + 1)
}

// ─── แจ้งเตือนในแอป ─────────────────────────────────────────────────────────

/**
 * ระดับที่ต้องแจ้งในแอปของรถหนึ่งคัน (ดูทั้งภาษี + พ.ร.บ.)
 *  urgent = เกินกำหนด / ครบวันนี้ · soon = ภายใน 30 วัน · null = ไม่ต้องแจ้ง
 * (ยังไม่มีข้อมูล / รอยืนยัน ไม่นับ — เพราะไม่รู้วันจริง)
 */
export function attentionLevel(c: VehicleCompliance | undefined, today: string): 'urgent' | 'soon' | null {
  let level: 'urgent' | 'soon' | null = null
  for (const kind of ['tax', 'act'] as ComplianceKind[]) {
    const st = complianceStatus(c?.[kind], today).state
    if (st === 'overdue' || st === 'due-today') return 'urgent'
    if (st === 'due-soon') level = 'soon'
  }
  return level
}
