"use client"

import * as React from "react"
import { doc, runTransaction, serverTimestamp } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useFirestore } from "@/firebase"
import type { Vehicle, VehicleDetails } from "@/types/models"
import { FIELD_LABEL, parseVehicleTable, planImport, type DetailField, type ImportPlan } from "@/lib/vehicle-import"
import { formatThaiDate } from "@/lib/vehicle-compliance"

function show(field: DetailField, v: string | number): string {
  if (field === "registrationDate" && typeof v === "string") return formatThaiDate(v)
  if (typeof v === "number" && field !== "modelYear") return v.toLocaleString()
  return String(v)
}

/**
 * นำเข้าข้อมูลประจำรถ: วางตารางจาก Excel → ดูผลจับคู่ก่อน → ยืนยันถึงบันทึก
 * บันทึกใน transaction ที่อ่านค่าล่าสุดอีกรอบ → เติมเฉพาะช่องที่ยังว่างจริง (กันเขียนทับค่าที่มีคนเพิ่งกรอก)
 */
export function VehicleImportDialog({
  open,
  onOpenChange,
  vehicles,
  detailsById,
  userLabel,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  vehicles: Vehicle[]
  detailsById: Record<string, VehicleDetails>
  userLabel: string
}) {
  const db = useFirestore()
  const { toast } = useToast()
  const [text, setText] = React.useState("")
  const [plan, setPlan] = React.useState<ImportPlan | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setText("")
      setPlan(null)
      setError(null)
    }
  }, [open])

  const analyse = () => {
    const parsed = parseVehicleTable(text)
    if (parsed.error) {
      setError(parsed.error)
      setPlan(null)
      return
    }
    setError(null)
    setPlan(planImport(parsed.rows, vehicles, detailsById))
  }

  const apply = async () => {
    if (!plan || plan.fills.length === 0) return
    setSaving(true)
    try {
      let written = 0
      await runTransaction(db, async (tx) => {
        const refs = plan.fills.map((f) => doc(db, "vehicleDetails", f.vehicleId))
        const snaps = await Promise.all(refs.map((r) => tx.get(r)))
        plan.fills.forEach((f, i) => {
          const cur = (snaps[i].data() ?? {}) as Record<string, unknown>
          const data: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(f.fields)) {
            if (cur[k] == null || cur[k] === "") data[k] = v
          }
          if (Object.keys(data).length === 0) return
          written++
          tx.set(refs[i], { ...data, id: f.vehicleId, updatedAt: serverTimestamp(), updatedBy: `${userLabel} (นำเข้า)` }, { merge: true })
        })
      })
      toast({ title: "นำเข้าข้อมูลแล้ว", description: `เติมข้อมูล ${written} คัน (เฉพาะช่องที่ยังว่าง)` })
      onOpenChange(false)
    } catch (e) {
      console.error(e)
      toast({ title: "นำเข้าไม่สำเร็จ", description: "อาจไม่มีสิทธิ์แก้ไข", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95%] max-w-3xl rounded-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>นำเข้าข้อมูลรถจากตาราง</DialogTitle>
          <DialogDescription>
            คัดลอกตารางจาก Excel <b>รวมแถวหัวตาราง</b> แล้ววางด้านล่าง → กด "ตรวจสอบ" เพื่อดูผลจับคู่ก่อน ยังไม่บันทึกจนกว่าจะกดยืนยัน ·
            ไม่สร้างรถใหม่ · ไม่เขียนทับข้อมูลเดิม · ไม่นำเข้าราคา
          </DialogDescription>
        </DialogHeader>

        <Textarea
          className="min-h-[120px] font-mono text-xs"
          placeholder={"ที่\tทะเบียนรถ\tจังหวัด\tยี่ห้อ\t...\n28\t1ฒษ-4407\tกรุงเทพมหานคร\tTOYOTA\t..."}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setPlan(null)
          }}
        />
        <Button variant="outline" onClick={analyse} disabled={!text.trim()}>
          ตรวจสอบ
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {plan && (
          <div className="space-y-4 text-sm">
            <Section title={`✅ จะเติมข้อมูล ${plan.fills.length} คัน (เฉพาะช่องที่ยังว่าง)`}>
              {plan.fills.map((f) => (
                <div key={f.vehicleId} className="rounded border p-2">
                  <div className="font-semibold">
                    {f.licensePlate} <span className="text-xs font-normal text-muted-foreground">← ตาราง{f.rowLabel}</span>
                  </div>
                  <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                    {(Object.entries(f.fields) as [DetailField, string | number][]).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-muted-foreground">{FIELD_LABEL[k]}:</span> {show(k, v)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Section>

            {plan.conflicts.length > 0 && (
              <Section title={`⚠️ รอตรวจสอบ — ข้อมูลขัดแย้งกับที่มีอยู่ ${plan.conflicts.length} รายการ (ไม่เขียนทับ)`}>
                {plan.conflicts.map((c, i) => (
                  <div key={i} className="text-xs">
                    <b>{c.licensePlate}</b> · {FIELD_LABEL[c.field]}: ในระบบ “{show(c.field, c.existing)}” ↔ ตาราง “{show(c.field, c.incoming)}”
                  </div>
                ))}
              </Section>
            )}

            {plan.skippedRows.length > 0 && (
              <Section title={`⏭️ ข้ามทั้งแถว ${plan.skippedRows.length} แถว`}>
                {plan.skippedRows.map((s, i) => (
                  <div key={i} className="text-xs">
                    <b>{s.plate}</b> ({s.rowLabel}) — {s.reason}
                  </div>
                ))}
              </Section>
            )}

            {plan.skippedFields.length > 0 && (
              <Section title={`✂️ ข้ามบางช่อง (อ่านไม่ชัด / ไม่สมเหตุสมผล) ${plan.skippedFields.length} ช่อง`}>
                {plan.skippedFields.map((s, i) => (
                  <div key={i} className="text-xs">
                    <b>{s.plate}</b> · {FIELD_LABEL[s.field]} “{s.value}” — {s.reason}
                  </div>
                ))}
              </Section>
            )}

            {plan.untouchedVehicles.length > 0 && (
              <Section title={`▫️ รถในระบบที่ไม่มีในตาราง ${plan.untouchedVehicles.length} คัน (เว้นว่างไว้ กรอกทีหลังได้)`}>
                <div className="text-xs text-muted-foreground">{plan.untouchedVehicles.join(", ")}</div>
              </Section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button className="w-full bg-accent" onClick={apply} disabled={!plan || plan.fills.length === 0 || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {plan ? `ยืนยันบันทึก ${plan.fills.length} คัน` : "ตรวจสอบก่อนบันทึก"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="font-semibold">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}
