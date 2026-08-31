"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { MapPin, User, FileText, Calendar, Phone, Clock, StickyNote } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { RequestTimingBadge } from "@/components/requests/RequestTimingBadge"

// แปลง YYYY-MM-DD → DD/MM/YYYY (กันพังถ้าไม่มีค่า)
const fmtDate = (s?: string) => {
  if (!s) return "-"
  const [y, m, d] = s.split("-")
  return d && m && y ? `${d}/${m}/${y}` : s
}

interface DestinationCardProps {
  dest: any;
  isSelected: boolean;
  onToggle: () => void;
  manualIndex?: number;
  onHover?: (id: string | null) => void;
  /** เพิ่ม "คันคู่" — สำเนาจุดนี้อีกใบในกอง สำหรับงานที่ต้องใช้รถมากกว่า 1 คัน */
  onDuplicate?: () => void;
  /** ถอนสำเนาคันคู่ (เฉพาะการ์ดที่เป็นสำเนา และยังไม่ถูกจัด) */
  onRemoveDup?: () => void;
  /** ย้ายวันใช้รถของใบขอนี้ (เช่น เลื่อนงานพรุ่งนี้มาวิ่งวันนี้ เพราะคนขับว่าง) */
  onMoveDate?: () => void;
  /** ยกเลิกใบขอนี้ (ปฏิเสธ) — เอาออกจากกอง ผู้ขอเห็นสถานะพร้อมเหตุผล */
  onCancel?: () => void;
}

export function DestinationCard({ dest, isSelected, onToggle, manualIndex, onHover, onDuplicate, onRemoveDup, onMoveDate, onCancel }: DestinationCardProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
    <Card
      className={cn(
        "cursor-pointer transition-all border-l-4 group overflow-hidden",
        isSelected
          ? "border-accent bg-accent/5 shadow-md scale-[1.01]"
          : "border-secondary bg-secondary/20 hover:border-accent/40"
      )}
      onClick={onToggle}
      onMouseEnter={() => onHover?.(dest.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <CardContent className="p-0 flex items-stretch">
        {/* Checkbox or Order Area */}
        <div className="bg-secondary/10 flex items-center justify-center px-4 border-r border-border/30">
          {manualIndex ? (
            <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center font-bold text-xs shadow-sm">
              {manualIndex}
            </div>
          ) : (
            <Checkbox 
              checked={isSelected} 
              onCheckedChange={onToggle}
              onClick={(e) => e.stopPropagation()}
              className="w-4 h-4 rounded-sm border-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
            />
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 p-3 space-y-3">
          <div className="flex justify-between items-start gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-accent">{dest.vrId}</span>
                {dest.pairedCopy && (
                  <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">
                    🚛 คันคู่ (คนจัดเพิ่ม)
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-accent shrink-0" /> {dest.siteName}
              </p>
            </div>
            <div className="text-right shrink-0 bg-background/40 px-2 py-1 rounded border border-border/50">
              <p className="text-[10px] font-bold text-muted-foreground uppercase flex items-center justify-end gap-1">
                วันที่ขอใช้รถ
              </p>
              <p className="text-xs font-bold text-white">
                {dest.requestDate ? (() => {
                  const [y, m, d] = dest.requestDate.split('-')
                  return `${d}/${m}/${y}`
                })() : "-"}
              </p>
              {dest.requestTime && (
                <p className="text-[11px] font-bold text-accent mt-0.5">
                  🕗 {dest.requestTime} น.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="bg-secondary/40 p-2 rounded-lg border border-border/50">
              <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 mb-0.5">
                <User className="h-3 w-3" /> ผู้ขอใช้งาน
              </p>
              <p className="text-xs font-medium text-white truncate">{dest.requestedBy}</p>
            </div>
            <div className="bg-secondary/40 p-2 rounded-lg border border-border/50">
              <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 mb-0.5">
                <FileText className="h-3 w-3 text-accent" /> ลักษณะงาน
              </p>
              <p className="text-xs text-foreground/80 line-clamp-1">
                {dest.jobDescription || "ไม่ได้ระบุ"}
              </p>
            </div>
          </div>

          {/* งานที่ต้องใช้รถหลายคัน: ต้นฉบับกด "เพิ่มคันคู่" / สำเนาถอนได้ถ้ายังไม่ถูกจัด */}
          {(onDuplicate || (dest.pairedCopy && onRemoveDup) || onMoveDate || onCancel) && (
            <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {onMoveDate && (
                <button
                  type="button"
                  onClick={onMoveDate}
                  title="เลื่อนวันใช้รถของใบขอนี้ (เช่น คนขับว่าง เลื่อนงานพรุ่งนี้มาวันนี้)"
                  className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/15"
                >
                  📅 ย้ายวัน
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  title="ยกเลิกใบขอนี้ (ปฏิเสธ) — เอาออกจากกองจัดคิว"
                  className="rounded-md border border-red-500/40 px-2 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/15"
                >
                  ✕ ยกเลิก
                </button>
              )}
              {dest.pairedCopy && onRemoveDup ? (
                <button
                  type="button"
                  onClick={onRemoveDup}
                  className="rounded-md border border-red-500/40 px-2 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/15"
                >
                  ✕ ถอนคันคู่
                </button>
              ) : onDuplicate ? (
                <button
                  type="button"
                  onClick={onDuplicate}
                  title="งานนี้ต้องใช้รถมากกว่า 1 คัน — เพิ่มสำเนาจุดนี้ให้อีกคันหยิบไปจัด"
                  className="rounded-md border border-blue-500/40 px-2 py-0.5 text-[10px] font-medium text-blue-400 hover:bg-blue-500/15"
                >
                  🚛+ เพิ่มคันคู่
                </button>
              ) : null}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
        </TooltipTrigger>
        <TooltipContent side="right" align="start" className="max-w-sm space-y-2 p-3">
          <div>
            <span className="text-xs font-bold text-accent">{dest.vrId}</span>
            <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-accent shrink-0" /> {dest.siteName}
            </p>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {dest.requestTime || "-"} น. · {fmtDate(dest.requestDate)}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" /> {dest.requestedBy || "-"}
            </span>
            {dest.requestedByPhone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" /> {dest.requestedByPhone}
              </span>
            )}
            {/* ส่งคำขอมากี่โมง / ล่วงหน้ากี่วัน / นอกเวลาไหม — ให้คนจัดคิวเห็นตอนตัดสินใจ */}
            <RequestTimingBadge requestedAt={dest.requestedAt} requestDate={dest.requestDate} className="basis-full" />
          </div>

          <div className="border-t border-border/50 pt-2">
            <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 mb-0.5">
              <FileText className="h-3 w-3 text-accent" /> ลักษณะงาน
            </p>
            <p className="text-xs text-foreground whitespace-pre-wrap break-words">
              {dest.jobDescription || "ไม่ได้ระบุ"}
            </p>
          </div>

          {dest.note && (
            <div className="border-t border-border/50 pt-2">
              <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 mb-0.5">
                <StickyNote className="h-3 w-3" /> หมายเหตุจากผู้ขอ
              </p>
              <p className="text-xs text-foreground/90 whitespace-pre-wrap break-words">{dest.note}</p>
            </div>
          )}

          {dest.dispatcherNote && (
            <div className="border-t border-border/50 pt-2">
              <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 mb-0.5">
                <StickyNote className="h-3 w-3 text-accent" /> โน้ตคนจัดรถ{dest.dispatcherName ? ` (${dest.dispatcherName})` : ""}
              </p>
              <p className="text-xs text-foreground/90 whitespace-pre-wrap break-words">{dest.dispatcherNote}</p>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
