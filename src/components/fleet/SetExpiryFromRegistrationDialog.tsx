"use client"

import * as React from "react"
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useFirestore } from "@/firebase"
import type { Vehicle, VehicleCompliance, VehicleDetails } from "@/types/models"
import { daysBetween, formatThaiDate, nextRegistrationAnniversary } from "@/lib/vehicle-compliance"

/** คันที่ตั้งได้: มีวันจดทะเบียน + ยังไม่มีวันหมดอายุทั้งภาษีและ พ.ร.บ. (มีแล้ว = ไม่แตะ) */
export function vehiclesToSetFromRegistration(
  vehicles: Vehicle[],
  detailsById: Record<string, VehicleDetails>,
  complianceById: Record<string, VehicleCompliance>,
  today: string
) {
  const ready: { vehicle: Vehicle; expiry: string }[] = []
  const missingRegistration: Vehicle[] = []
  for (const v of vehicles) {
    const c = complianceById[v.id]
    if (c?.tax?.expiry || c?.act?.expiry) continue
    const expiry = nextRegistrationAnniversary(detailsById[v.id]?.registrationDate, today)
    if (expiry) ready.push({ vehicle: v, expiry })
    else missingRegistration.push(v)
  }
  ready.sort((a, b) => a.expiry.localeCompare(b.expiry))
  return { ready, missingRegistration }
}

/**
 * ตั้งวันหมดอายุภาษี + พ.ร.บ. (วันเดียวกัน) = วันครบรอบจดทะเบียนครั้งถัดไป ทีเดียวหลายคัน
 * ดูรายการก่อนยืนยัน · transaction อ่านซ้ำ → ข้ามคันที่มีคนเพิ่งกรอกวันไปแล้ว (ไม่เขียนทับ)
 */
export function SetExpiryFromRegistrationDialog({
  open,
  onOpenChange,
  vehicles,
  detailsById,
  complianceById,
  today,
  userLabel,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  vehicles: Vehicle[]
  detailsById: Record<string, VehicleDetails>
  complianceById: Record<string, VehicleCompliance>
  today: string
  userLabel: string
}) {
  const db = useFirestore()
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)
  const { ready, missingRegistration } = vehiclesToSetFromRegistration(vehicles, detailsById, complianceById, today)

  const apply = async () => {
    setSaving(true)
    try {
      const nowIso = new Date().toISOString()
      const by = `${userLabel} (ตั้งจากวันจดทะเบียน)`
      let written = 0
      await runTransaction(db, async (tx) => {
        const refs = ready.map((r) => doc(db, "vehicleCompliance", r.vehicle.id))
        const snaps = await Promise.all(refs.map((ref) => tx.get(ref)))
        ready.forEach((r, i) => {
          const cur = snaps[i].data() as VehicleCompliance | undefined
          if (cur?.tax?.expiry || cur?.act?.expiry) return
          const item = { expiry: r.expiry, confirmed: true, confirmedBy: by, confirmedAt: nowIso, workStatus: "none" }
          tx.set(refs[i], { id: r.vehicle.id, tax: item, act: item, updatedAt: serverTimestamp() }, { merge: true })
          for (const kind of ["tax", "act"] as const) {
            tx.set(doc(collection(db, "vehicleComplianceHistory")), {
              vehicleId: r.vehicle.id,
              licensePlate: r.vehicle.licensePlate,
              kind,
              action: "confirm",
              prevExpiry: null,
              newExpiry: r.expiry,
              recordedBy: by,
              recordedAt: nowIso,
            })
          }
          written++
        })
      })
      toast({ title: "ตั้งวันหมดอายุแล้ว", description: `${written} คัน (ภาษี + พ.ร.บ. วันเดียวกัน)` })
      onOpenChange(false)
    } catch (e) {
      console.error(e)
      toast({ title: "บันทึกไม่สำเร็จ", description: "อาจไม่มีสิทธิ์แก้ไข", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95%] max-w-lg rounded-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ตั้งวันหมดอายุจากวันจดทะเบียน</DialogTitle>
          <DialogDescription>
            ภาษีและ พ.ร.บ. = วันครบรอบจดทะเบียนครั้งถัดไป (วันเดียวกัน) · เฉพาะคันที่ยังไม่มีวันหมดอายุ ·
            คันไหนเลยวันครบรอบปีนี้แล้วแต่ยังไม่ได้ต่อ ให้แก้วันในรายละเอียดรถหลังตั้ง
          </DialogDescription>
        </DialogHeader>

        {ready.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">ไม่มีคันที่ต้องตั้งวัน</p>
        ) : (
          <div className="space-y-1 text-sm">
            {ready.map((r) => (
              <div key={r.vehicle.id} className="flex justify-between gap-2 rounded border px-2.5 py-1.5">
                <span className="font-semibold">{r.vehicle.licensePlate}</span>
                <span>
                  {formatThaiDate(r.expiry)} <span className="text-xs text-muted-foreground">(อีก {daysBetween(today, r.expiry)} วัน)</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {missingRegistration.length > 0 && (
          <p className="text-xs text-muted-foreground">
            ยังไม่มีวันจดทะเบียน (ข้าม — กรอกในรายละเอียดรถ): {missingRegistration.map((v) => v.licensePlate).join(", ")}
          </p>
        )}

        <DialogFooter>
          <Button className="w-full bg-accent" onClick={apply} disabled={saving || ready.length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} ยืนยันตั้งวัน {ready.length} คัน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
