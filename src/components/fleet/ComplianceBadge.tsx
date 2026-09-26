"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ComplianceItem, ComplianceKind } from "@/types/models"
import { KIND_LABEL, complianceStatus, statusShortText, type ComplianceState } from "@/lib/vehicle-compliance"

const STYLE: Record<ComplianceState, string> = {
  "no-data": "bg-muted text-muted-foreground",
  unconfirmed: "bg-amber-500/15 text-amber-500",
  ok: "bg-emerald-500/15 text-emerald-500",
  "due-soon": "bg-orange-500/20 text-orange-500",
  "due-today": "bg-red-500/20 text-red-500",
  overdue: "bg-red-600/25 text-red-500",
}

const ICON: Record<ComplianceState, string> = {
  "no-data": "▫️",
  unconfirmed: "❔",
  ok: "✅",
  "due-soon": "⏰",
  "due-today": "🔴",
  overdue: "🔴",
}

/** ป้ายสถานะย่อ เช่น "ภาษี ⏰ อีก 5 วัน" / "พ.ร.บ. ▫️ ยังไม่มีข้อมูล" */
export function ComplianceBadge({
  kind,
  item,
  today,
  className,
}: {
  kind: ComplianceKind
  item?: ComplianceItem
  today: string
  className?: string
}) {
  const s = complianceStatus(item, today)
  return (
    <Badge className={cn("border-none text-[10px] font-medium", STYLE[s.state], className)}>
      {KIND_LABEL[kind]} {ICON[s.state]} {statusShortText(s)}
    </Badge>
  )
}
