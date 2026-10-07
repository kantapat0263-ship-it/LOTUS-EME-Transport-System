import { z } from 'zod'
export function parseWeekStart(value: unknown): string {
  const text = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).parse(value)
  const date = new Date(`${text}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text || date.getUTCDay() !== 1) throw new Error('เลือกวันจันทร์ของสัปดาห์')
  return text
}
export function weekDates(weekStart: string): string[] {
  const start = Date.parse(`${parseWeekStart(weekStart)}T00:00:00Z`)
  return Array.from({ length: 7 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10))
}
export const stopReviewSchema = z.object({
  operationId: z.string().uuid(), weekStart: z.string(), dayKey: z.string().min(1).max(200), eventId: z.string().regex(/^\d{13}-\d{13}$/),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), expectedVersion: z.number().int().min(0).max(1_000_000_000), excluded: z.boolean(), reason: z.string().trim().min(1).max(500),
}).strict()
export type StopReviewCommand = z.infer<typeof stopReviewSchema>
export function parseStopReviewCommand(value: unknown): StopReviewCommand {
  const command = stopReviewSchema.parse(value)
  if (!weekDates(command.weekStart).includes(command.dayKey.slice(0, 10)) || !command.dayKey.startsWith(`${command.dayKey.slice(0, 10)}__`)) throw new Error('วันที่อยู่นอกสัปดาห์')
  return command
}
