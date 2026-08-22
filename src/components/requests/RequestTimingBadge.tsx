"use client"

import { describeRequestTiming, toMillis } from "@/lib/requestTiming"
import { cn } from "@/lib/utils"

/**
 * "📨 ส่งคำขอ 22/8 16:02 · ล่วงหน้า 2 วัน" + ป้าย "⏰ ส่งนอกเวลา" ถ้าเข้าข่าย
 * สำหรับหน้าฝั่งคนจัดคิว/แอดมินเท่านั้น — ไม่ใส่ในใบพิมพ์/LINE (ผู้เรียกต้องดูแลเอง)
 * ไม่มีข้อมูล (stop เก่าก่อนฟีเจอร์นี้) → ไม่ render อะไรเลย
 */
export function RequestTimingBadge({
  requestedAt,
  requestDate,
  openHour,
  closeHour,
  className,
}: {
  requestedAt: any
  requestDate?: string | null
  openHour?: number
  closeHour?: number
  className?: string
}) {
  const t = describeRequestTiming(toMillis(requestedAt), requestDate, { openHour, closeHour })
  if (!t) return null
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground", className)}>
      <span>📨 ส่งคำขอ {t.submittedLabel} · {t.leadLabel}</span>
      {t.outsideHours && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-400">⏰ ส่งนอกเวลา</span>
      )}
    </span>
  )
}
