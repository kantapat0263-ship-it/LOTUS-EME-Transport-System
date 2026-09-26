/**
 * พ.ร.บ. / ภาษีรถ — pure helpers (client + server ใช้ร่วมกัน, มี unit test)
 *
 * กติกาหลัก (ห้ามหลุด):
 *  - ไม่มีวันหมดอายุ = "ยังไม่มีข้อมูล" (ไม่ใช่ "ปกติ") และไม่เตือน — ห้ามเดาวัน
 *  - มีวันแต่เจ้าหน้าที่ยังไม่ยืนยัน = "รอยืนยัน" ไม่เตือน
 *  - ห้ามเลื่อนปีเอง: วันหมดอายุเปลี่ยนได้ทางเดียวคือคนบันทึก (ยืนยัน / ต่ออายุ)
 *  - รับทราบ / กำลังดำเนินการ ไม่หยุดเตือน
 *
 * วันที่ทั้งหมดเป็นสตริง ค.ศ. `YYYY-MM-DD` ตามปฏิทินไทย (Asia/Bangkok)
 */
import type { ComplianceItem, ComplianceKind, Vehicle, VehicleCompliance } from '@/types/models'

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
      return `ถึง ${formatThaiDate(s.expiry)}`
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

/** เสนอวันหมดอายุรอบใหม่ = รอบเดิม + 1 ปี (วัน-เดือนเดิม) — ไม่ใช้วันที่จ่ายเงิน */
export function suggestRenewedExpiry(prevExpiry: string | null | undefined): string | null {
  if (!prevExpiry || !isIsoDate(prevExpiry)) return null
  return sameDayMonthInYear(prevExpiry, Number(prevExpiry.slice(0, 4)) + 1)
}

// ─── รอบเตือน ───────────────────────────────────────────────────────────────

/**
 * รอบเตือนของวันนี้ (ใช้เป็น key กันส่งซ้ำ) — เลือก "รอบล่าสุดที่ข้ามมาแล้ว"
 * ถ้า cron พลาดไปวันนึงก็ยังตามส่งรอบนั้นได้ และแต่ละรอบส่งครั้งเดียว
 *   ≤30 → d30 · ≤15 → d15 · ≤7 → d7 · 1 → d1 · 0 → d0
 *   เกินกำหนด → o1 (วันแรกที่เกิน) แล้วทุก 7 วัน: o8, o15, ...
 */
export function alertStage(daysLeft: number): string | null {
  if (daysLeft > 30) return null
  if (daysLeft > 15) return 'd30'
  if (daysLeft > 7) return 'd15'
  if (daysLeft > 1) return 'd7'
  if (daysLeft === 1) return 'd1'
  if (daysLeft === 0) return 'd0'
  const over = -daysLeft
  return `o${Math.floor((over - 1) / 7) * 7 + 1}`
}

export function stageLabel(stage: string): string {
  switch (stage) {
    case 'd30':
      return 'ครบกำหนดภายใน 30 วัน'
    case 'd15':
      return 'ครบกำหนดภายใน 15 วัน'
    case 'd7':
      return 'ครบกำหนดภายใน 7 วัน'
    case 'd1':
      return 'ครบกำหนดพรุ่งนี้'
    case 'd0':
      return 'ครบกำหนดวันนี้'
    default:
      return 'เกินกำหนดแล้ว'
  }
}

/** ลำดับแสดงผล: เร่งด่วนก่อน */
function stageOrder(stage: string): number {
  if (stage.startsWith('o')) return 0
  return { d0: 1, d1: 2, d7: 3, d15: 4, d30: 5 }[stage] ?? 9
}

export interface DueAlert {
  key: string
  vehicleId: string
  licensePlate: string
  kind: ComplianceKind
  expiry: string
  daysLeft: number
  stage: string
  responsibleName: string
}

export const NO_RESPONSIBLE = 'ยังไม่ระบุผู้รับผิดชอบ'

/** key กันส่งซ้ำ: คัน + ประเภท + วันหมดอายุรอบนั้น + รอบเตือน → ต่ออายุแล้ว (วันเปลี่ยน) = key ใหม่อัตโนมัติ */
export function alertKey(vehicleId: string, kind: ComplianceKind, expiry: string, stage: string): string {
  return `${vehicleId}_${kind}_${expiry}_${stage}`
}

/** รายการที่ถึงรอบเตือนวันนี้ — เฉพาะที่มีวัน + ยืนยันแล้ว (workStatus ไม่มีผล) */
export function collectDueAlerts(
  vehicles: Pick<Vehicle, 'id' | 'licensePlate'>[],
  complianceById: Record<string, VehicleCompliance | undefined>,
  today: string
): DueAlert[] {
  const out: DueAlert[] = []
  for (const v of vehicles) {
    const c = complianceById[v.id]
    for (const kind of ['tax', 'act'] as ComplianceKind[]) {
      const st = complianceStatus(c?.[kind], today)
      if (st.state === 'no-data' || st.state === 'unconfirmed') continue
      const stage = alertStage(st.daysLeft as number)
      if (!stage) continue
      out.push({
        key: alertKey(v.id, kind, st.expiry as string, stage),
        vehicleId: v.id,
        licensePlate: v.licensePlate,
        kind,
        expiry: st.expiry as string,
        daysLeft: st.daysLeft as number,
        stage,
        responsibleName: c?.responsibleName?.trim() || NO_RESPONSIBLE,
      })
    }
  }
  return out
}

/** LINE text message ยาวได้ ≤5000 ตัวอักษร — ตัดตามบรรทัด */
export function splitForLine(text: string, max = 4900): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  let cur = ''
  for (const line of text.split('\n')) {
    if (cur && cur.length + 1 + line.length > max) {
      out.push(cur)
      cur = line
    } else cur = cur ? `${cur}\n${line}` : line
  }
  if (cur) out.push(cur)
  return out
}

function alertLine(a: DueAlert): string {
  const when =
    a.daysLeft < 0 ? `เกินมา ${-a.daysLeft} วัน` : a.daysLeft === 0 ? 'วันนี้' : `อีก ${a.daysLeft} วัน`
  return `• ${a.licensePlate} — ${KIND_LABEL[a.kind]} หมดอายุ ${formatThaiDate(a.expiry)} (${when})`
}

/**
 * รวมข้อความ LINE: 1 ข้อความต่อผู้รับผิดชอบ แยกหัวข้อตามรอบเตือน
 * (ส่งหลายข้อความใน push เดียวได้ ≤5 — LINE นับโควตาตามจำนวนผู้รับ ไม่ใช่จำนวนข้อความในครั้งนั้น)
 */
export function buildAlertMessages(alerts: DueAlert[], today: string): string[] {
  const byPerson = new Map<string, DueAlert[]>()
  for (const a of alerts) {
    const list = byPerson.get(a.responsibleName) ?? []
    list.push(a)
    byPerson.set(a.responsibleName, list)
  }
  const people = Array.from(byPerson.keys()).sort((a, b) =>
    a === NO_RESPONSIBLE ? 1 : b === NO_RESPONSIBLE ? -1 : a.localeCompare(b, 'th')
  )
  return people.map((person) => {
    const list = byPerson.get(person) as DueAlert[]
    const byStage = new Map<string, DueAlert[]>()
    for (const a of list) {
      const label = stageLabel(a.stage)
      const arr = byStage.get(label) ?? []
      arr.push(a)
      byStage.set(label, arr)
    }
    const sections = Array.from(byStage.entries())
      .sort((x, y) => stageOrder(x[1][0].stage) - stageOrder(y[1][0].stage))
      .map(([label, arr]) => {
        const lines = arr
          .slice()
          .sort((p, q) => p.daysLeft - q.daysLeft || p.licensePlate.localeCompare(q.licensePlate, 'th'))
          .map(alertLine)
        return `${label.startsWith('เกิน') ? '🔴' : '⏰'} ${label}\n${lines.join('\n')}`
      })
    return `🔔 แจ้งเตือน พ.ร.บ. / ภาษีรถ (${formatThaiDate(today)})\n👤 ผู้รับผิดชอบ: ${person}\n\n${sections.join('\n\n')}`
  })
}
