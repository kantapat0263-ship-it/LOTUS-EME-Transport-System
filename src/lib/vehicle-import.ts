/**
 * นำเข้าข้อมูลประจำรถจากตาราง (วางจาก Excel = แท็บคั่น) — pure, มี unit test
 *
 * กติกา (ห้ามเดา):
 *  - จับคู่เฉพาะรถที่มีในระบบ + ทะเบียนตรงแน่นอน · ไม่สร้างรถใหม่
 *  - ทะเบียนซ้ำ (ในตารางหรือในระบบ) / ไม่มีทะเบียน / ไม่เจอในระบบ → ข้ามทั้งแถว
 *  - จังหวัด/เลขตัวรถ ที่มีอยู่แล้วในระบบไม่ตรงกับตาราง → ไม่มั่นใจว่าคันเดียวกัน → ข้ามทั้งแถว
 *  - ค่าอ่านไม่ออก / ผิดรูป / เลขตัวรถ-เลขเครื่องซ้ำกันหลายแถว → ข้ามเฉพาะช่องนั้น
 *  - เติมเฉพาะช่องที่ยังว่าง · ช่องที่มีค่าอยู่แล้วแต่ไม่ตรง → รายการรอตรวจสอบ (ไม่เขียนทับ)
 *  - คอลัมน์ "ราคา" ไม่นำเข้า
 */
import type { Vehicle, VehicleDetails } from '@/types/models'

export type DetailField = Exclude<keyof VehicleDetails, 'id' | 'updatedAt' | 'updatedBy'>

export const FIELD_LABEL: Record<DetailField, string> = {
  province: 'จังหวัด',
  brand: 'ยี่ห้อ',
  model: 'รุ่น',
  color: 'สี',
  chassisNo: 'เลขตัวรถ',
  engineNo: 'เลขเครื่องยนต์',
  registrationDate: 'วันที่จดทะเบียน',
  modelYear: 'ปีรุ่น (ค.ศ.)',
  curbWeightKg: 'น้ำหนักรถ (กก.)',
  payloadKg: 'น้ำหนักบรรทุก (กก.)',
  grossWeightKg: 'น้ำหนักรวม (กก.)',
  seats: 'จำนวนที่นั่ง (คน)',
  fuelType: 'เชื้อเพลิง',
  bodyType: 'ลักษณะรถ',
  note: 'หมายเหตุ',
}

export const PROVINCES = [
  'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท',
  'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา',
  'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์',
  'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์',
  'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี',
  'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร',
  'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู',
  'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี',
]

// ─── ทะเบียน ────────────────────────────────────────────────────────────────

const PROVINCE_ALIASES: Record<string, string> = { กรุงเทพฯ: 'กรุงเทพมหานคร', กรุงเทพ: 'กรุงเทพมหานคร', กทม: 'กรุงเทพมหานคร' }

/** ชื่อจังหวัดมาตรฐาน (กทม / กรุงเทพฯ → กรุงเทพมหานคร) */
export function normalizeProvince(raw: string): string {
  const s = raw.replace(/[\s.]/g, '')
  return PROVINCE_ALIASES[s] ?? s
}

/** แยก "ทะเบียน" กับ "จังหวัด" (ถ้าพิมพ์ต่อท้ายมา) และ normalize เป็น key: ตัดช่องว่าง/ขีด/จุด */
export function splitPlate(raw: string | undefined): { key: string; province?: string } {
  const s = (raw || '').replace(/[\s\-.]/g, '')
  const suffix = [...PROVINCES, ...Object.keys(PROVINCE_ALIASES)].find((p) => s.endsWith(p) && s.length > p.length)
  if (!suffix) return { key: s.toLowerCase() }
  return { key: s.slice(0, -suffix.length).toLowerCase(), province: normalizeProvince(suffix) }
}

/** รูปทะเบียนไทยที่รับ (หลัง normalize): 1กข1234 · กข1234 · 401953 (รถบรรทุก/โดยสาร) */
export function looksLikePlate(key: string): boolean {
  return /^(\d{0,2}[ก-ฮ]{1,3}\d{1,4}|\d{2}\d{4})$/.test(key)
}

// ─── แปลงค่า ────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
}

function isoFrom(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** ปี: 2 หลัก = พ.ศ. ย่อ (59 → 2559) · ≥2400 = พ.ศ. · อื่น ๆ = ค.ศ. → คืน ค.ศ. */
function toCE(yearRaw: number, twoDigit: boolean): number {
  const y = twoDigit ? 2500 + yearRaw : yearRaw
  return y >= 2400 ? y - 543 : y
}

/** "23 ส.ค. 59" / "23 สิงหาคม 2559" / "23/8/2559" / "23/08/2016" → ค.ศ. `YYYY-MM-DD` (อ่านไม่ออก → null) */
export function parseThaiDate(raw: string | undefined): string | null {
  const s = (raw || '').trim().replace(/\s+/g, ' ')
  if (!s) return null
  let m = s.match(/^(\d{1,2}) ?([ก-๙.]+) ?(\d{2}|\d{4})$/)
  if (m) {
    const month = MONTHS[m[2]] ?? MONTHS[m[2].endsWith('.') ? m[2] : `${m[2]}.`]
    if (!month) return null
    return isoFrom(toCE(Number(m[3]), m[3].length === 2), month, Number(m[1]))
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (m) return isoFrom(toCE(Number(m[3]), m[3].length === 2), Number(m[2]), Number(m[1]))
  return null
}

/** "1,850 กก." → 1850 · มีคำว่า "คน" = ไม่ใช่น้ำหนัก → null */
export function parseKg(raw: string | undefined): number | null {
  const s = (raw || '').trim()
  if (!s || /คน/.test(s)) return null
  const m = s.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(กก\.?|kg)?$/i)
  return m ? Number(m[1]) : null
}

/** "(10 คน)" / "10 คน" / "10" → 10 */
export function parseSeats(raw: string | undefined): number | null {
  const m = (raw || '').trim().match(/^\(?\s*(\d{1,3})\s*(คน|ที่นั่ง)?\s*\)?$/)
  return m ? Number(m[1]) : null
}

/** เลขตัวรถแบบ VIN 17 หลักห้ามมี I/O/Q — เจอ = น่าจะพิมพ์ O แทน 0 (ไม่แก้ให้ ให้คนตรวจ) */
export function chassisIssue(v: string): string | null {
  const s = v.replace(/\s/g, '')
  if (s.length === 17 && /[IOQ]/i.test(s)) return 'เลขตัวรถ 17 หลักมีตัว O/I/Q (VIN ไม่มีตัวนี้ — อาจพิมพ์ O แทน 0)'
  return null
}

// ─── อ่านตาราง ──────────────────────────────────────────────────────────────

type Col = DetailField | 'plate' | 'rowNo' | 'ignore'

function headerToCol(h: string): Col | null {
  const s = h.replace(/\s+/g, '')
  if (s === 'ที่' || s === 'ลำดับ') return 'rowNo'
  if (s.includes('ทะเบียน') && !s.includes('วันที่')) return 'plate'
  if (s.includes('จังหวัด')) return 'province'
  if (s.includes('ยี่ห้อ')) return 'brand'
  if (s.includes('รุ่นปี') || s.includes('ปีรุ่น')) return 'modelYear'
  if (s.includes('แบบ') || s.includes('ชื่อรถ') || s === 'รุ่น') return 'model'
  if (s === 'สี' || s.startsWith('สีรถ')) return 'color'
  if (s.includes('เลขตัวรถ') || s.includes('เลขตัวถัง') || s.includes('เลขคัสซี')) return 'chassisNo'
  if (s.includes('เลขเครื่อง')) return 'engineNo'
  if (s.includes('วันที่จด') || s.includes('วันจดทะเบียน')) return 'registrationDate'
  if (s.includes('น้ำหนักบรรทุก')) return 'payloadKg'
  if (s.includes('น้ำหนักรวม')) return 'grossWeightKg'
  if (s.includes('น้ำหนักรถ')) return 'curbWeightKg'
  if (s.includes('ที่นั่ง')) return 'seats'
  if (s.includes('เชื้อเพลิง')) return 'fuelType'
  if (s.includes('ลักษณะ')) return 'bodyType'
  if (s.includes('หมายเหตุ')) return 'note'
  if (s.includes('ราคา')) return 'ignore'
  return null
}

export interface FieldIssue {
  field: DetailField
  value: string
  reason: string
}

export interface ParsedRow {
  line: number // บรรทัดที่วาง (นับจาก 1)
  rowNo: string // เลข "ที่" ในตาราง (ถ้ามี)
  plateRaw: string
  plateKey: string
  plateProvince?: string
  values: Partial<Record<DetailField, string | number>>
  issues: FieldIssue[]
}

export interface ParseResult {
  rows: ParsedRow[]
  error?: string
}

/** วางจาก Excel (แท็บคั่น) — ต้องมีแถวหัวตารางที่มีคำว่า "ทะเบียน" */
export function parseVehicleTable(text: string): ParseResult {
  const lines = text.replace(/\r/g, '').split('\n')
  const headerIdx = lines.findIndex((l) => l.split('\t').some((c) => headerToCol(c) === 'plate'))
  if (headerIdx < 0) return { rows: [], error: 'ไม่พบแถวหัวตาราง (ต้องมีคอลัมน์ "ทะเบียนรถ") — กรุณาคัดลอกหัวตารางมาด้วย' }
  const cols = lines[headerIdx].split('\t').map(headerToCol)

  const rows: ParsedRow[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = lines[i].split('\t').map((c) => c.trim())
    if (cells.every((c) => !c)) continue
    const row: ParsedRow = { line: i + 1, rowNo: '', plateRaw: '', plateKey: '', values: {}, issues: [] }
    let seatsFromPayload: number | null = null
    cols.forEach((col, ci) => {
      const raw = cells[ci] ?? ''
      // "-" ในตาราง = ไม่มีค่า (เช่น รถเก๋ง/รถตู้ไม่มีน้ำหนักบรรทุก) → เว้นว่าง ไม่ใช่ค่าที่อ่านไม่ออก
      if (!col || col === 'ignore' || !raw || /^[-–—]+$/.test(raw)) return
      if (col === 'rowNo') row.rowNo = raw
      else if (col === 'plate') row.plateRaw = raw
      else if (col === 'province') row.values.province = normalizeProvince(raw)
      else if (col === 'registrationDate') {
        const iso = parseThaiDate(raw)
        if (iso) row.values.registrationDate = iso
        else row.issues.push({ field: col, value: raw, reason: 'อ่านวันที่ไม่ออก' })
      } else if (col === 'modelYear') {
        const y = /^\d{4}$/.test(raw) ? Number(raw) : NaN
        if (Number.isFinite(y)) row.values.modelYear = y >= 2400 ? y - 543 : y
        else row.issues.push({ field: col, value: raw, reason: 'ปีรุ่นไม่ใช่ตัวเลข 4 หลัก' })
      } else if (col === 'curbWeightKg' || col === 'grossWeightKg' || col === 'payloadKg') {
        const kg = parseKg(raw)
        if (kg != null) row.values[col] = kg
        else if (col === 'payloadKg' && parseSeats(raw) != null) seatsFromPayload = parseSeats(raw)
        else row.issues.push({ field: col, value: raw, reason: 'อ่านน้ำหนักไม่ออก' })
      } else if (col === 'seats') {
        const n = parseSeats(raw)
        if (n != null) row.values.seats = n
        else row.issues.push({ field: col, value: raw, reason: 'อ่านจำนวนที่นั่งไม่ออก' })
      } else {
        row.values[col] = raw
      }
    })
    // รถโดยสาร: ช่องน้ำหนักบรรทุกเขียน "(10 คน)" = จำนวนที่นั่ง ไม่ใช่น้ำหนัก → แยกออก
    if (seatsFromPayload != null && row.values.seats == null) row.values.seats = seatsFromPayload

    const sp = splitPlate(row.plateRaw)
    row.plateKey = sp.key
    row.plateProvince = sp.province

    // ตรวจความสมเหตุสมผล (ไม่แก้ให้ — ตัดช่องนั้นทิ้งแล้วแจ้ง)
    const regYear = typeof row.values.registrationDate === 'string' ? Number(row.values.registrationDate.slice(0, 4)) : null
    const my = row.values.modelYear as number | undefined
    if (my != null) {
      const thisYear = new Date().getFullYear()
      if (my < 1950 || my > thisYear + 1 || (regYear != null && my > regYear + 1)) {
        row.issues.push({ field: 'modelYear', value: String(my), reason: `ปีรุ่นไม่สมเหตุสมผล${regYear ? ` (จดทะเบียนปี ค.ศ. ${regYear})` : ''}` })
        delete row.values.modelYear
      }
    }
    if (typeof row.values.chassisNo === 'string') {
      const why = chassisIssue(row.values.chassisNo)
      if (why) {
        row.issues.push({ field: 'chassisNo', value: row.values.chassisNo, reason: why })
        delete row.values.chassisNo
      }
    }
    rows.push(row)
  }

  // เลขตัวรถ / เลขเครื่อง ซ้ำกันหลายแถว = อย่างน้อยหนึ่งแถวผิด ไม่รู้แถวไหน → ตัดทุกแถวที่ซ้ำ
  for (const field of ['chassisNo', 'engineNo'] as const) {
    const seen = new Map<string, ParsedRow[]>()
    for (const r of rows) {
      const v = r.values[field]
      if (typeof v !== 'string') continue
      const k = v.replace(/[\s-]/g, '').toUpperCase()
      seen.set(k, [...(seen.get(k) ?? []), r])
    }
    for (const group of seen.values()) {
      if (group.length < 2) continue
      const who = group.map((r) => r.plateRaw || `แถว ${r.rowNo || r.line}`).join(', ')
      for (const r of group) {
        r.issues.push({ field, value: String(r.values[field]), reason: `${FIELD_LABEL[field]}ซ้ำกันหลายแถว (${who})` })
        delete r.values[field]
      }
    }
  }
  return { rows }
}

// ─── จับคู่กับรถในระบบ ─────────────────────────────────────────────────────

export interface ImportFill {
  vehicleId: string
  licensePlate: string
  rowLabel: string
  fields: Partial<Record<DetailField, string | number>>
}

export interface ImportConflict {
  vehicleId: string
  licensePlate: string
  rowLabel: string
  field: DetailField
  existing: string | number
  incoming: string | number
}

export interface ImportSkip {
  rowLabel: string
  plate: string
  reason: string
}

export interface ImportFieldSkip extends FieldIssue {
  rowLabel: string
  plate: string
}

export interface ImportPlan {
  fills: ImportFill[]
  conflicts: ImportConflict[]
  skippedRows: ImportSkip[]
  skippedFields: ImportFieldSkip[]
  /** รถในระบบที่ไม่มีในตาราง (ช่องว่างไว้ กรอกทีหลังได้) */
  untouchedVehicles: string[]
}

function same(a: string | number, b: string | number): boolean {
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase()
}

export function planImport(
  rows: ParsedRow[],
  vehicles: Pick<Vehicle, 'id' | 'licensePlate'>[],
  detailsById: Record<string, VehicleDetails | undefined>
): ImportPlan {
  const plan: ImportPlan = { fills: [], conflicts: [], skippedRows: [], skippedFields: [], untouchedVehicles: [] }

  const vehiclesByKey = new Map<string, Pick<Vehicle, 'id' | 'licensePlate'>[]>()
  for (const v of vehicles) {
    const k = splitPlate(v.licensePlate).key
    vehiclesByKey.set(k, [...(vehiclesByKey.get(k) ?? []), v])
  }
  const rowsByKey = new Map<string, number>()
  for (const r of rows) if (r.plateKey) rowsByKey.set(r.plateKey, (rowsByKey.get(r.plateKey) ?? 0) + 1)

  const matched = new Set<string>()
  for (const r of rows) {
    const rowLabel = r.rowNo ? `ที่ ${r.rowNo}` : `บรรทัด ${r.line}`
    const plate = r.plateRaw || '(ไม่มีทะเบียน)'
    const skip = (reason: string) => plan.skippedRows.push({ rowLabel, plate, reason })

    if (!r.plateKey || !looksLikePlate(r.plateKey)) {
      skip('ไม่มีเลขทะเบียน หรือรูปแบบทะเบียนไม่ถูกต้อง')
      continue
    }
    if ((rowsByKey.get(r.plateKey) ?? 0) > 1) {
      skip('ทะเบียนซ้ำในตาราง')
      continue
    }
    const cands = vehiclesByKey.get(r.plateKey) ?? []
    if (cands.length === 0) {
      skip('ไม่พบทะเบียนนี้ในระบบ (ไม่สร้างรถใหม่)')
      continue
    }
    if (cands.length > 1) {
      skip('ทะเบียนนี้ซ้ำกันในระบบ (มีมากกว่า 1 คัน)')
      continue
    }
    const v = cands[0]
    const existing = detailsById[v.id] ?? ({} as Partial<VehicleDetails>)
    const tableProvince = (r.values.province as string | undefined) ?? r.plateProvince
    const sysProvince = splitPlate(v.licensePlate).province ?? existing.province
    if (tableProvince && sysProvince && normalizeProvince(tableProvince) !== normalizeProvince(sysProvince)) {
      skip(`จังหวัดไม่ตรงกับในระบบ (ระบบ: ${sysProvince}, ตาราง: ${tableProvince})`)
      continue
    }
    const tableChassis = r.values.chassisNo as string | undefined
    if (tableChassis && existing.chassisNo && !same(tableChassis, existing.chassisNo)) {
      skip(`เลขตัวรถไม่ตรงกับในระบบ (ระบบ: ${existing.chassisNo}, ตาราง: ${tableChassis})`)
      continue
    }
    matched.add(v.id)

    for (const iss of r.issues) plan.skippedFields.push({ ...iss, rowLabel, plate })

    const fields: ImportFill['fields'] = {}
    for (const [f, val] of Object.entries(r.values) as [DetailField, string | number][]) {
      const cur = existing[f as keyof VehicleDetails] as string | number | undefined
      if (cur == null || cur === '') fields[f] = val
      else if (!same(cur, val)) {
        plan.conflicts.push({ vehicleId: v.id, licensePlate: v.licensePlate, rowLabel, field: f, existing: cur, incoming: val })
      }
    }
    if (Object.keys(fields).length > 0) plan.fills.push({ vehicleId: v.id, licensePlate: v.licensePlate, rowLabel, fields })
  }
  plan.untouchedVehicles = vehicles.filter((v) => !matched.has(v.id)).map((v) => v.licensePlate)
  return plan
}
