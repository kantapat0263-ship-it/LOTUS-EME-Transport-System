'use client'

import { cn } from '@/lib/utils'

/** HH:MM เวลาไทย 24 ชม. — เลื่อน +7 ชม. แล้วอ่านเป็น UTC (ไม่ขึ้นกับเขตเวลาเครื่อง ไม่พึ่ง locale) */
function thaiHHMM(d: Date): string {
  const t = new Date(d.getTime() + 7 * 60 * 60 * 1000)
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
}

/** แถบรวมสถานะการตรวจวันลา — ready = ไม่แสดงอะไร */
export function LeaveCheckBanner({
  status,
  lastOkAt,
}: {
  status: 'loading' | 'ready' | 'error'
  lastOkAt: Date | null
}) {
  if (status === 'ready') return null
  const isError = status === 'error'
  return (
    <div
      role="status"
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        isError
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
          : 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      {isError
        ? `⚠️ ตรวจวันลาจากระบบใบลาไม่ได้ตอนนี้ — ป้ายวันลาอาจไม่ครบ${
            lastOkAt ? ` (ข้อมูลล่าสุดเมื่อ ${thaiHHMM(lastOkAt)})` : ''
          }`
        : '⏳ กำลังตรวจวันลา…'}
    </div>
  )
}
