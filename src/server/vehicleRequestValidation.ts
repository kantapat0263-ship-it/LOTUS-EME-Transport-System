import { z } from 'zod'

/** ตรวจข้อมูลใบขอรถที่ส่งมาจากฟอร์ม — ฝั่ง server ไม่เชื่อ client (ความยาว/รูปแบบ/ประเภท) */
const text = (max: number) => z.string().max(max)
const time = z.string().regex(/^(\d{1,2}:\d{2})?$/)
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
}).strict().refine(d => d.category === 'custom' ? d.customName.trim() !== '' : d.siteId !== '')

const command = z.object({
  /** รหัสการกดส่งครั้งนี้ (ฟอร์มใช้รหัสเดิมตอนกดซ้ำ) — กันใบซ้ำเมื่อบันทึกสำเร็จแต่คำตอบหาย */
  operationId: z.string().uuid(),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate),
  requestTime: time,
  requestedBy: text(120),
  note: text(2000),
  destinations: z.array(destination).min(1).max(30),
}).strict()

export type VehicleRequestCommand = z.infer<typeof command>
export const parseVehicleRequestCommand = (input: unknown): VehicleRequestCommand => command.parse(input)
