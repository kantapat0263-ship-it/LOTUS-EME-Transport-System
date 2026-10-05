"use client"

import {
  CREDIT_TEXT,
  FLOOD_FOOTNOTE,
  floodStatusText,
  POPNIX_URL,
  type FloodPhase,
  type FloodSummary,
  type RoadFloodSnapshot,
} from "@/lib/roadFlood"
import { cn } from "@/lib/utils"

const TONE_CLASS = {
  info: "border-border text-foreground",
  warn: "border-orange-400/70 text-orange-300",
  sample: "border-red-500/70 text-red-300",
} as const

/**
 * แถบสถานะของชั้นน้ำท่วม (แสดงเฉพาะตอนเปิดชั้น) — จอแคบวางใต้แถวปุ่ม เต็มความกว้าง · จอกว้างมุมซ้ายบน
 * บรรทัด 2 มีข้อความ "ไม่มีหมุด ≠ ถนนปลอดภัย" + เครดิต POPNIX เป็นลิงก์เสมอ (เงื่อนไขการใช้ข้อมูล)
 */
export function FloodStatusBar(p: {
  phase: FloodPhase
  lastFailed: boolean
  snapshot: RoadFloodSnapshot | null
  summary: FloodSummary | null
  now: number
}) {
  const { tone, text } = floodStatusText(p)
  return (
    <div
      role="status"
      className={cn(
        "absolute left-2 right-2 top-11 z-10 rounded-md border bg-background/90 px-2 py-1 text-[11px] leading-snug shadow-md backdrop-blur",
        "sm:right-auto sm:top-2 sm:max-w-[calc(100%-13rem)]",
        TONE_CLASS[tone]
      )}
    >
      <div className="font-medium">{text}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        {FLOOD_FOOTNOTE} ·{" "}
        <a href={POPNIX_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          {CREDIT_TEXT}
        </a>
      </div>
    </div>
  )
}
