import { z } from 'zod'
import { normalizeRequestTime } from '@/lib/requestTime'
import { destinationCoordinateProblem, parseThaiCoordinates } from '@/lib/requestCoordinates'
import { transferShapeProblem } from '@/lib/transfer'
import { SEQUENCE_MAX_STOPS, sequenceShapeProblem } from '@/lib/sequence'

/** ตรวจข้อมูลใบขอรถที่ส่งมาจากฟอร์ม — ฝั่ง server ไม่เชื่อ client (ความยาว/รูปแบบ/ประเภท) */
const text = (max: number) => z.string().max(max)
/** เวลา → "HH:MM" (รับ "06.30" ด้วย — ฟอร์มรุ่นเก่าที่เปิดค้างส่งจุดมา) · ว่าง = ไม่ระบุ */
const time = z.string().max(20).transform(v => normalizeRequestTime(v)).pipe(z.string())
const isRealDate = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day
}

const destination = z.object({
  category: z.enum(['all', 'site', 'store', 'bank', 'company', 'custom']),
  siteId: text(200).refine(value => !value.includes('/') && value !== '.' && value !== '..'),
  siteName: text(200),
  customName: text(200),
  coordinates: text(100),
  jobDescription: text(4000),
  saveAsSite: z.boolean(),
  allowSeparateSite: z.boolean().optional(),
  locationType: text(60),
  requestTime: time,
  /** งานรับของไปส่งต่อ (lib/transfer) — ไม่มี = ใบปกติ */
  transferRole: z.enum(['pickup', 'drop']).optional(),
  /** งานไปหลายจุดตามลำดับ (lib/sequence) — ลำดับที่ผู้ขอกรอก (เริ่ม 0) · รหัสชุด server ออกเอง · ไม่มี = ใบปกติ */
  sequenceIndex: z.number().int().min(0).max(SEQUENCE_MAX_STOPS - 1).optional(),
}).strict().refine(d => d.category === 'custom' ? d.customName.trim() !== '' : d.siteId !== '')
  // ทุกจุดต้องมีพิกัดในไทย (ผู้ใช้กำหนด 2026-10-19) — กันหน้าฟอร์มรุ่นเก่าที่เปิดค้างส่งจุดไม่มีพิกัดมา
  .refine(d => parseThaiCoordinates(d.coordinates) !== null, { path: ['coordinates'] })

const command = z.object({
  /** รหัสการกดส่งครั้งนี้ (ฟอร์มใช้รหัสเดิมตอนกดซ้ำ) — กันใบซ้ำเมื่อบันทึกสำเร็จแต่คำตอบหาย */
  operationId: z.string().uuid(),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate),
  requestTime: time,
  requestedBy: text(120),
  note: text(2000),
  destinations: z.array(destination).min(1).max(30).superRefine((list, ctx) => {
    // ใบรับของไปส่งต่อ: จุดรับ ≥ 1 + จุดส่ง 1 จุดท้ายใบ · จุดรับต้องบอกว่ารับอะไร (จุดส่งเขียนรายการให้จากตรงนี้)
    const problem = transferShapeProblem(list.map(d => d.transferRole))
    if (problem) { ctx.addIssue({ code: 'custom', message: problem }); return }
    list.forEach((d, i) => {
      if (d.transferRole === 'pickup' && !d.jobDescription.trim()) ctx.addIssue({ code: 'custom', path: [i, 'jobDescription'], message: 'pickup-items' })
    })
    // ใบไปหลายจุดตามลำดับ: ทุกจุดมีลำดับ · 2+ จุด · ไม่ปนงานรับ-ส่ง · จุดติดกันไม่ใช่ที่เดียวกัน · ทุกจุดต้องบอกว่าทำอะไร
    const places = list.map(d => ({ siteId: d.siteId || null, ...(parseThaiCoordinates(d.coordinates) ?? {}) }))
    const sequenceProblem = sequenceShapeProblem(list, places)
    if (sequenceProblem) { ctx.addIssue({ code: 'custom', message: sequenceProblem }); return }
    list.forEach((d, i) => {
      if (d.sequenceIndex !== undefined && !d.jobDescription.trim()) ctx.addIssue({ code: 'custom', path: [i, 'jobDescription'], message: 'sequence-task' })
    })
  }),
}).strict()

export type VehicleRequestCommand = z.infer<typeof command>

/** ข้อมูลใบขอรถไม่ผ่าน — message คือข้อความที่ผู้ขอเห็น (บอกว่าผิดช่องไหน แก้อย่างไร) */
export class VehicleRequestInputError extends Error {}

const RELOAD = 'ข้อมูลใบขอรถไม่ถูกต้อง — กรุณาโหลดหน้าใหม่ (F5) แล้วส่งอีกครั้ง'
const LABELS: Record<string, string> = {
  requestedBy: 'ชื่อผู้ขอใช้รถ', note: 'หมายเหตุเพิ่มเติม',
  siteName: 'ชื่อสถานที่', customName: 'ชื่อสถานที่', coordinates: 'พิกัด', jobDescription: 'ลักษณะงานที่ต้องทำ',
  locationType: 'ประเภทสถานที่',
}
const MAX_NAME_IN_MESSAGE = 80
const MAX_TIME_IN_MESSAGE = 20
/** ค่าเวลาที่กรอก ใส่กลับในข้อความแบบสั้น (วางข้อความยาวมาในช่องเวลา = ข้อความเตือนไม่ล้นจอ) */
const shownTime = (v: unknown) => {
  const s = String(v ?? '')
  return s.length > MAX_TIME_IN_MESSAGE ? `${s.slice(0, MAX_TIME_IN_MESSAGE)}…` : s
}

/** แปลงข้อผิดพลาดของ zod เป็นข้อความไทยที่ชี้ช่องที่ผิด — ช่องที่ผู้ขอแก้เองไม่ได้ = ให้โหลดหน้าใหม่ */
function issueMessage(issue: z.ZodIssue, input: any): string {
  const [head, index, field] = issue.path
  if (head === 'destinations' && typeof index === 'number') {
    const raw = input?.destinations?.[index]
    const rawName = String((raw?.category === 'custom' ? raw?.customName : raw?.siteName) ?? '').trim()
    const name = rawName && rawName.length <= MAX_NAME_IN_MESSAGE ? ` (${rawName})` : ''
    const where = `จุดที่ ${index + 1}`
    if (field === undefined) {
      // refine ทั้งจุด = ยังไม่มีสถานที่ · ฟิลด์ส่วนเกิน (unrecognized_keys) ก็ใช้ path นี้ = ฟอร์มผิดรุ่น ให้โหลดหน้าใหม่
      if (issue.code !== 'custom') return RELOAD
      return raw?.category === 'custom' ? `${where}: ยังไม่ได้ใส่ชื่อสถานที่` : `${where}: ยังไม่ได้เลือกสถานที่`
    }
    if (field === 'siteId' && issue.code === 'custom') return `${where}${name}: สถานที่ไม่ถูกต้อง — เลือกสถานที่ใหม่`
    if (field === 'coordinates' && issue.code === 'custom') {
      return destinationCoordinateProblem({ category: String(raw?.category ?? ''), coordinates: String(raw?.coordinates ?? '') }, `${where}${name}`) ?? RELOAD
    }
    if (field === 'jobDescription' && issue.code === 'custom') {
      return issue.message === 'sequence-task' ? `${where}${name}: ยังไม่ได้ระบุว่าทำอะไรที่จุดนี้` : `${where}${name}: ยังไม่ได้ระบุของที่จะรับ`
    }
    if (field === 'requestTime') return `${where}${name}: เวลา "${shownTime(raw?.requestTime)}" ไม่ถูกต้อง — ใช้รูปแบบ 08:30`
    if (issue.code === 'too_big' && typeof field === 'string' && LABELS[field]) {
      return `${where}${name}: ${LABELS[field]}ยาวเกิน ${Number(issue.maximum).toLocaleString('en-US')} ตัวอักษร`
    }
    return RELOAD
  }
  // ข้อความจากตัวตรวจรูปใบรับของไปส่งต่อ / ใบไปหลายจุดตามลำดับ (เขียนเป็นภาษาผู้ใช้แล้ว)
  if (head === 'destinations' && issue.code === 'custom') return issue.message
  if (head === 'destinations') return issue.code === 'too_small' ? 'ต้องมีจุดหมายอย่างน้อย 1 จุด' : issue.code === 'too_big' ? 'จุดหมายเกิน 30 จุด — แยกเป็นหลายใบ' : RELOAD
  if (head === 'requestDate') return 'วันที่ขอรถไม่ถูกต้อง — เลือกวันใหม่'
  if (head === 'requestTime') return `เวลา "${shownTime(input?.requestTime)}" ไม่ถูกต้อง — ใช้รูปแบบ 08:30`
  if (issue.code === 'too_big' && typeof head === 'string' && LABELS[head]) {
    return `${LABELS[head]}ยาวเกิน ${Number(issue.maximum).toLocaleString('en-US')} ตัวอักษร`
  }
  return RELOAD
}

export const parseVehicleRequestCommand = (input: unknown): VehicleRequestCommand => {
  const result = command.safeParse(input)
  if (result.success) return result.data
  const messages = [...new Set(result.error.issues.map(issue => issueMessage(issue, input)))]
  // มีช่องที่ผู้ขอแก้ได้ = บอกเฉพาะช่องพวกนั้น (สูงสุด 3) · ไม่มีเลย = ให้โหลดหน้าใหม่
  const fixable = messages.filter(m => m !== RELOAD)
  throw new VehicleRequestInputError(fixable.length ? fixable.slice(0, 3).join(' · ') : RELOAD)
}
