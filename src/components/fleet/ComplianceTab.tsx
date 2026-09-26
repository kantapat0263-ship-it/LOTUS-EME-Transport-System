"use client"

import * as React from "react"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { ComplianceKind, Vehicle, VehicleCompliance, VehicleDetails } from "@/types/models"
import { complianceStatus, type ComplianceState } from "@/lib/vehicle-compliance"
import { ComplianceBadge } from "./ComplianceBadge"
import { VehicleImportDialog } from "./VehicleImportDialog"

type Filter = "all" | "due" | "overdue" | "unconfirmed" | "no-data"

const FILTERS: { key: Filter; label: string; match: ComplianceState[] }[] = [
  { key: "all", label: "ทั้งหมด", match: [] },
  { key: "due", label: "ใกล้หมดอายุ (≤30 วัน)", match: ["due-soon", "due-today"] },
  { key: "overdue", label: "เกินกำหนด", match: ["overdue"] },
  { key: "unconfirmed", label: "รอยืนยันวัน", match: ["unconfirmed"] },
  { key: "no-data", label: "ยังไม่มีข้อมูล", match: ["no-data"] },
]

const WORK_TEXT = { acknowledged: "รับทราบแล้ว", in_progress: "กำลังดำเนินการ" } as const

/** เรียงเร่งด่วนก่อน: เกิน → วันนี้ → ใกล้ → รอยืนยัน → ไม่มีข้อมูล → ปกติ */
function urgency(v: VehicleCompliance | undefined, today: string): number {
  const rank: Record<ComplianceState, number> = { overdue: 0, "due-today": 1, "due-soon": 2, unconfirmed: 3, "no-data": 4, ok: 5 }
  return Math.min(...(["tax", "act"] as ComplianceKind[]).map((k) => {
    const s = complianceStatus(v?.[k], today)
    return rank[s.state] * 10_000 + (s.daysLeft ?? 0)
  }))
}

export function ComplianceTab({
  vehicles,
  detailsById,
  complianceById,
  today,
  readOnly,
  userLabel,
  onOpenDetails,
}: {
  vehicles: Vehicle[]
  detailsById: Record<string, VehicleDetails>
  complianceById: Record<string, VehicleCompliance>
  today: string
  readOnly: boolean
  userLabel: string
  onOpenDetails: (v: Vehicle) => void
}) {
  const [filter, setFilter] = React.useState<Filter>("all")
  const [importOpen, setImportOpen] = React.useState(false)

  const counts = React.useMemo(() => {
    const c: Record<Filter, number> = { all: vehicles.length, due: 0, overdue: 0, unconfirmed: 0, "no-data": 0 }
    for (const v of vehicles) {
      const states = (["tax", "act"] as ComplianceKind[]).map((k) => complianceStatus(complianceById[v.id]?.[k], today).state)
      for (const f of FILTERS) if (f.key !== "all" && states.some((s) => f.match.includes(s))) c[f.key]++
    }
    return c
  }, [vehicles, complianceById, today])

  const rows = React.useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!
    return vehicles
      .filter((v) => filter === "all" || (["tax", "act"] as ComplianceKind[]).some((k) => f.match.includes(complianceStatus(complianceById[v.id]?.[k], today).state)))
      .sort((a, b) => urgency(complianceById[a.id], today) - urgency(complianceById[b.id], today) || a.licensePlate.localeCompare(b.licensePlate, "th"))
  }, [vehicles, complianceById, filter, today])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} className="h-9" onClick={() => setFilter(f.key)}>
            {f.label} <span className="ml-1.5 rounded bg-background/30 px-1.5 text-xs">{counts[f.key]}</span>
          </Button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          {!readOnly && (
            <Button size="sm" variant="outline" className="h-9" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" /> นำเข้าข้อมูลรถจากตาราง
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        {rows.map((v) => {
          const c = complianceById[v.id]
          const d = detailsById[v.id]
          const work = (["tax", "act"] as ComplianceKind[])
            .map((k) => c?.[k]?.workStatus)
            .find((w): w is "acknowledged" | "in_progress" => w === "acknowledged" || w === "in_progress")
          return (
            <Card key={v.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-[9rem]">
                <div className="font-bold text-accent">{v.licensePlate}</div>
                <div className="text-xs text-muted-foreground">
                  {[d?.brand, d?.model].filter(Boolean).join(" ") || v.type}
                </div>
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                <ComplianceBadge kind="tax" item={c?.tax} today={today} />
                <ComplianceBadge kind="act" item={c?.act} today={today} />
                {work && <span className="text-xs text-sky-500">• {WORK_TEXT[work]}</span>}
              </div>
              <div className="text-xs text-muted-foreground sm:w-40">{c?.responsibleName ? `👤 ${c.responsibleName}` : ""}</div>
              <Button size="sm" variant="outline" className="h-9" onClick={() => onOpenDetails(v)}>
                รายละเอียดรถ
              </Button>
            </Card>
          )
        })}
        {rows.length === 0 && <div className="py-10 text-center text-muted-foreground">ไม่มีรถในกลุ่มนี้</div>}
      </div>

      {!readOnly && (
        <VehicleImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          vehicles={vehicles}
          detailsById={detailsById}
          userLabel={userLabel}
        />
      )}
    </div>
  )
}
