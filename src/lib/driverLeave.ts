/**
 * ตรรกะล้วน (pure) ของป้ายวันลาคนขับ — ตรวจ response จากระบบใบลา, ตัดสินสถานะคนขับต่อ 1 วัน,
 * และสร้างข้อความป้าย/ข้อความในกล่องยืนยัน
 *
 * ไม่มี I/O ไม่แตะ React/Firebase · วันที่ทุกตัวเป็นสตริง `YYYY-MM-DD` ตามเวลาไทย เทียบด้วยสตริงตรง ๆ
 * (ห้ามได้วันที่จาก `toISOString()` — ช่วง 00:00–07:00 ไทยจะได้วันเมื่อวาน)
 *
 * หลักสูงสุด: "ตรวจไม่ได้ / ยังไม่รู้" = `unknown` ห้ามกลายเป็น `free`
 */

// ---------- ชนิดข้อมูล ----------

/** ใบลา 1 ใบตามที่ endpoint `/api/integration/driver-leaves` ส่งมา */
export interface ApiLeave {
  code: string
  type: string
  typeLabel: string
  start: string
  end: string
  days: number
  status: 'pending' | 'awaiting_doc' | 'approved'
  timing: { mode: 'am' | 'pm' | 'hours'; start: string; end: string } | null
  edges: { start: { start: string; end: string } | null; end: { start: string; end: string } | null } | null
}

export interface LeaveApiResponse {
  /** `null` = ตรวจแล้วไม่พบรหัส · ไม่มี key = ไม่ได้ตรวจ (ฝั่งจัดคิวถือเป็น unknown) */
  employees: Record<string, { name: string; active: boolean } | null>
  leaves: ApiLeave[]
}

/** ช่วงวันที่ที่ response ครอบคลุม (รวมหัวท้าย) */
export interface Coverage {
  from: string
  to: string
}

/** ใบลา 1 ใบ มองจาก "วันที่ถาม" — `part` คือส่วนของวันนั้น (null = เต็มวัน) */
export type LeaveItem = {
  approved: boolean
  typeLabel: string
  start: string
  end: string
  days: number
  part: 'am' | 'pm' | 'hours' | null
  hours?: string
}

export type DriverLeaveStatus =
  | { kind: 'unknown' }
  | { kind: 'unmapped' }
  | { kind: 'driver_missing' }
  | { kind: 'not_found' }
  | { kind: 'inactive'; name: string }
  | { kind: 'free'; name: string }
  | { kind: 'leave'; name: string; items: LeaveItem[] }

// ---------- วันที่ ----------

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
] as const

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function parseIsoDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

/** พ.ศ. 2 หลักท้าย เช่น 2026 → "69" */
function buddhistYear2(y: number): string {
  return String((y + 543) % 100).padStart(2, '0')
}

/** วันนี้ตามเวลาไทย (`YYYY-MM-DD`) — เลื่อนเวลา +7 ชม. แล้วอ่านเป็น UTC เพื่อไม่ให้เพี้ยนตามเขตเวลาเครื่อง */
export function thaiToday(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(t.getUTCDate()).padStart(2, '0')
  return `${t.getUTCFullYear()}-${mm}-${dd}`
}

/** "5 ต.ค." | "3–7 ต.ค." | "30 ก.ย.–2 ต.ค." | ข้ามปีใส่ พ.ศ. 2 หลัก "30 ธ.ค. 69–2 ม.ค. 70" */
export function formatLeaveRange(start: string, end: string): string {
  const s = parseIsoDate(start)
  const e = parseIsoDate(end)
  const sMonth = THAI_MONTHS_SHORT[s.m - 1]
  const eMonth = THAI_MONTHS_SHORT[e.m - 1]
  if (start === end) return `${s.d} ${sMonth}`
  if (s.y !== e.y) return `${s.d} ${sMonth} ${buddhistYear2(s.y)}–${e.d} ${eMonth} ${buddhistYear2(e.y)}`
  if (s.m !== e.m) return `${s.d} ${sMonth}–${e.d} ${eMonth}`
  return `${s.d}–${e.d} ${eMonth}`
}

// ---------- ตรวจ response ----------

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fail(path: string, why: string): never {
  throw new Error(`driver-leaves response invalid at ${path}: ${why}`)
}

function checkString(v: unknown, path: string): void {
  if (typeof v !== 'string') fail(path, 'expected a string')
}

function checkWindow(v: unknown, path: string): void {
  if (!isObj(v)) return fail(path, 'expected an object')
  checkString(v.start, `${path}.start`)
  checkString(v.end, `${path}.end`)
}

function checkLeave(l: unknown, path: string): void {
  if (!isObj(l)) return fail(path, 'expected an object')
  checkString(l.code, `${path}.code`)
  checkString(l.type, `${path}.type`)
  checkString(l.typeLabel, `${path}.typeLabel`)
  if (!isIsoDate(l.start)) fail(`${path}.start`, 'expected a real YYYY-MM-DD date')
  if (!isIsoDate(l.end)) fail(`${path}.end`, 'expected a real YYYY-MM-DD date')
  if (typeof l.days !== 'number' || !Number.isFinite(l.days)) fail(`${path}.days`, 'expected a finite number')
  if (l.status !== 'pending' && l.status !== 'awaiting_doc' && l.status !== 'approved') {
    fail(`${path}.status`, 'expected pending | awaiting_doc | approved')
  }
  // timing / edges ต้องมีฟิลด์เสมอ (null = ไม่มี) — ขาดฟิลด์ = สัญญาเพี้ยน
  if (l.timing !== null) {
    checkWindow(l.timing, `${path}.timing`)
    const mode = (l.timing as Obj).mode
    if (mode !== 'am' && mode !== 'pm' && mode !== 'hours') fail(`${path}.timing.mode`, 'expected am | pm | hours')
  }
  if (l.edges !== null) {
    if (!isObj(l.edges)) fail(`${path}.edges`, 'expected an object or null')
    for (const side of ['start', 'end'] as const) {
      if (l.edges[side] !== null) checkWindow(l.edges[side], `${path}.edges.${side}`)
    }
  }
}

/** ตรวจว่าเป็น `LeaveApiResponse` จริง — ผิดสัญญาข้อไหนก็ throw (ผู้เรียกต้องถือเป็น "ตรวจไม่ได้" ไม่ใช่ "ไม่ลา") */
export function validateLeaveResponse(x: unknown): LeaveApiResponse {
  if (!isObj(x)) return fail('response', `expected an object, got ${x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x}`)
  const { employees, leaves } = x
  if (!isObj(employees)) return fail('employees', 'expected an object')
  for (const [code, emp] of Object.entries(employees)) {
    if (emp === null) continue
    if (!isObj(emp)) fail(`employees.${code}`, 'expected an object or null')
    checkString(emp.name, `employees.${code}.name`)
    if (typeof emp.active !== 'boolean') fail(`employees.${code}.active`, 'expected a boolean')
  }
  if (!Array.isArray(leaves)) return fail('leaves', 'expected an array')
  leaves.forEach((l, i) => checkLeave(l, `leaves[${i}]`))
  return x as unknown as LeaveApiResponse
}

// ---------- ตัดสินสถานะ ----------

/** ส่วนของวัน (part) + ช่วงเวลา ของใบลานี้ ณ วัน `date` (ซึ่งอยู่ในช่วงใบลาแล้ว) */
function partOn(l: ApiLeave, date: string): { part: LeaveItem['part']; window: { start: string; end: string } | null } {
  if (l.start === l.end) {
    return l.timing ? { part: l.timing.mode, window: l.timing } : { part: null, window: null }
  }
  if (date === l.start && l.edges?.start) return { part: 'pm', window: l.edges.start }
  if (date === l.end && l.edges?.end) return { part: 'am', window: l.edges.end }
  return { part: null, window: null }
}

const PART_RANK = { am: 0, pm: 2 } as const

/**
 * สถานะของคนขับ (รหัสพนักงาน `code`) ในวัน `date`
 * ลำดับตัดสิน: unmapped → unknown → not_found → inactive → leave → free
 */
export function leaveStatusOn(
  code: string | undefined,
  date: string,
  res: LeaveApiResponse | null,
  coverage: Coverage | null,
): DriverLeaveStatus {
  const key = code?.trim()
  if (!key) return { kind: 'unmapped' }
  if (!res || !coverage || date < coverage.from || date > coverage.to) return { kind: 'unknown' }
  if (!Object.prototype.hasOwnProperty.call(res.employees, key)) return { kind: 'unknown' }

  const emp = res.employees[key]
  if (emp === null) return { kind: 'not_found' }
  if (!emp.active) return { kind: 'inactive', name: emp.name }

  const placed = res.leaves
    .filter((l) => l.code === key && l.start <= date && date <= l.end)
    .map((l) => {
      const { part, window } = partOn(l, date)
      const item: LeaveItem = {
        approved: l.status !== 'pending',
        typeLabel: l.typeLabel,
        start: l.start,
        end: l.end,
        days: l.days,
        part,
      }
      if (part === 'hours' && window) item.hours = `${window.start}–${window.end}`
      return {
        item,
        rank: part === 'am' || part === 'pm' ? PART_RANK[part] : 1,
        // เต็มวัน = '' จึงมาก่อนรายชั่วโมงทุกกรณี (รวมเริ่ม 00:00 เท่ากัน)
        startTime: window?.start ?? '',
      }
    })
  if (placed.length === 0) return { kind: 'free', name: emp.name }

  // am < (เต็มวัน/hours ตามเวลาเริ่ม) < pm · ค่าเท่ากันคงลำดับเดิม (sort เสถียร)
  placed.sort((a, b) => a.rank - b.rank || (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0))
  return { kind: 'leave', name: emp.name, items: placed.map((p) => p.item) }
}

// ---------- ข้อความ ----------

const HALF_DAY_LABEL = { am: 'ครึ่งวันเช้า', pm: 'ครึ่งวันบ่าย' } as const

/**
 * ส่วนท้ายหลังชื่อประเภทลา
 * - ป้าย: ครึ่งวันติดชื่อ ("ลากิจครึ่งวันบ่าย") · ชั่วโมง/ช่วงวันเว้นวรรค ("ลากิจ 13:00–15:00")
 * - กล่องยืนยัน: เว้นวรรคเสมอ + ใบหลายวันเต็มวันต่อท้ายจำนวนวัน "3–7 ต.ค. (5 วัน)"
 */
function itemDetail(i: LeaveItem, forConfirm: boolean): string {
  if (i.part === 'am' || i.part === 'pm') return `${forConfirm ? ' ' : ''}${HALF_DAY_LABEL[i.part]}`
  if (i.part === 'hours') return i.hours ? ` ${i.hours}` : ''
  if (i.start === i.end) return ''
  const range = ` ${formatLeaveRange(i.start, i.end)}`
  return forConfirm ? `${range} (${i.days} วัน)` : range
}

/** ป้ายสั้นบรรทัดเดียวต่อคนขับ — '' = ไม่มีป้าย (free / unknown) */
export function leaveBadgeText(s: DriverLeaveStatus): string {
  switch (s.kind) {
    case 'unmapped':
      return '❔ ยังไม่ผูกรหัสพนักงาน'
    case 'not_found':
      return '❔ ไม่พบรหัสในระบบใบลา'
    case 'driver_missing':
      return '❔ ไม่พบข้อมูลคนขับ'
    case 'inactive':
      return '⛔ พ้นสภาพในระบบใบลา'
    case 'leave': {
      const { items } = s
      if (items.length === 1) {
        const [i] = items
        const body = `${i.typeLabel}${itemDetail(i, false)}`
        return i.approved ? `🏖 ${body}` : `⏳ ยื่น${body} (รออนุมัติ)`
      }
      return items.some((i) => i.approved) ? `🏖 ลา ${items.length} ช่วง` : `⏳ ลา ${items.length} ช่วง (รออนุมัติ)`
    }
    default:
      return ''
  }
}

/** บรรทัดรายละเอียดสำหรับกล่อง confirm — [] เมื่อไม่ต้องถาม (ไม่ใช่ leave/inactive) */
export function leaveConfirmLines(driverName: string, date: string, s: DriverLeaveStatus): string[] {
  if (s.kind === 'inactive') return [`⛔ ${driverName} พ้นสภาพในระบบใบลาแล้ว`]
  if (s.kind !== 'leave') return []
  return [
    `⚠️ ${driverName} ลาวันที่ ${formatLeaveRange(date, date)}`,
    ...s.items.map(
      (i) => `• ${i.typeLabel}${itemDetail(i, true)} · ${i.approved ? 'อนุมัติแล้ว' : 'รออนุมัติ'}`,
    ),
  ]
}
