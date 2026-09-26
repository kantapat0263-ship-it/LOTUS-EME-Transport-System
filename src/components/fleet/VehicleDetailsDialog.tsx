"use client"

import * as React from "react"
import { collection, deleteField, doc, getDoc, query, where, writeBatch, serverTimestamp } from "firebase/firestore"
import { Loader2, FileText, RefreshCw } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type {
  ComplianceHistoryEntry,
  ComplianceItem,
  ComplianceKind,
  ComplianceWorkStatus,
  Vehicle,
  VehicleCompliance,
  VehicleDetails,
} from "@/types/models"
import {
  KIND_LABEL,
  formatThaiDate,
  isIsoDate,
  suggestRenewedExpiry,
  suggestTaxExpiryCandidates,
} from "@/lib/vehicle-compliance"
import { FIELD_LABEL, type DetailField } from "@/lib/vehicle-import"
import { ComplianceBadge } from "./ComplianceBadge"

const TEXT_FIELDS: DetailField[] = ["province", "brand", "model", "color", "chassisNo", "engineNo", "fuelType", "bodyType"]
const NUMBER_FIELDS: DetailField[] = ["curbWeightKg", "payloadKg", "grossWeightKg", "seats"]
const KINDS: ComplianceKind[] = ["tax", "act"]
const WORK_LABEL: Record<ComplianceWorkStatus, string> = {
  none: "—",
  acknowledged: "รับทราบแล้ว",
  in_progress: "กำลังดำเนินการ",
}

type DetailFormState = Record<DetailField, string>

function toForm(d?: VehicleDetails): DetailFormState {
  const f = {} as DetailFormState
  for (const k of Object.keys(FIELD_LABEL) as DetailField[]) {
    const v = d?.[k]
    f[k] = v == null ? "" : String(v)
  }
  return f
}

interface KindForm {
  expiry: string
  confirmed: boolean
  workStatus: ComplianceWorkStatus
}

function toKindForm(item?: ComplianceItem): KindForm {
  return { expiry: item?.expiry ?? "", confirmed: !!item?.confirmed, workStatus: item?.workStatus ?? "none" }
}

/** ย่อรูปหลักฐานให้พอเก็บใน Firestore (1 doc ≤ 1MB) — PDF รับตามจริงถ้าไม่ใหญ่เกิน */
async function readEvidence(file: File): Promise<string> {
  const MAX = 900_000
  if (file.type === "application/pdf") {
    if (file.size > 650_000) throw new Error("ไฟล์ PDF ใหญ่เกิน 650KB — กรุณาถ่ายรูปแทน")
    return await new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result as string)
      r.onerror = () => rej(new Error("อ่านไฟล์ไม่สำเร็จ"))
      r.readAsDataURL(file)
    })
  }
  if (!file.type.startsWith("image/")) throw new Error("รองรับเฉพาะรูปภาพหรือ PDF")
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  for (const q of [0.75, 0.6, 0.45, 0.3]) {
    const url = canvas.toDataURL("image/jpeg", q)
    if (url.length <= MAX) return url
  }
  throw new Error("รูปใหญ่เกินไป กรุณาครอปหรือลดขนาดก่อน")
}

async function openEvidence(db: ReturnType<typeof useFirestore>, evidenceId: string) {
  const snap = await getDoc(doc(db, "vehicleComplianceEvidence", evidenceId))
  const dataUrl = snap.data()?.dataUrl as string | undefined
  if (!dataUrl) return
  const blob = await (await fetch(dataUrl)).blob()
  window.open(URL.createObjectURL(blob), "_blank")
}

export function VehicleDetailsDialog({
  vehicle,
  details,
  compliance,
  open,
  onOpenChange,
  readOnly,
  userLabel,
  today,
}: {
  vehicle: Vehicle | null
  details?: VehicleDetails
  compliance?: VehicleCompliance
  open: boolean
  onOpenChange: (open: boolean) => void
  readOnly: boolean
  userLabel: string
  today: string
}) {
  const db = useFirestore()
  const { toast } = useToast()
  const [form, setForm] = React.useState<DetailFormState>(() => toForm(details))
  const [kindForm, setKindForm] = React.useState<Record<ComplianceKind, KindForm>>(() => ({
    tax: toKindForm(compliance?.tax),
    act: toKindForm(compliance?.act),
  }))
  const [actSameAsTax, setActSameAsTax] = React.useState(false)
  const [responsible, setResponsible] = React.useState(compliance?.responsibleName ?? "")
  const [saving, setSaving] = React.useState<"details" | "compliance" | null>(null)
  const [renewOpen, setRenewOpen] = React.useState(false)

  // เปิด dialog / เปลี่ยนคัน / ข้อมูลใน DB เปลี่ยน (เช่น เพิ่งต่ออายุ) → โหลดค่าล่าสุดลงฟอร์ม
  // กันกด "บันทึกสถานะ" แล้วเอาวันเก่าในฟอร์มไปเขียนทับรอบที่เพิ่งต่อ
  const detailsKey = JSON.stringify(details ? { ...details, updatedAt: null } : null)
  const complianceKey = JSON.stringify([compliance?.tax, compliance?.act, compliance?.responsibleName])
  React.useEffect(() => {
    if (!open) return
    setForm(toForm(details))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vehicle?.id, detailsKey])
  React.useEffect(() => {
    if (!open) return
    setKindForm({ tax: toKindForm(compliance?.tax), act: toKindForm(compliance?.act) })
    setActSameAsTax(!!compliance?.act?.expiry && compliance?.act?.expiry === compliance?.tax?.expiry)
    setResponsible(compliance?.responsibleName ?? "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vehicle?.id, complianceKey])

  const historyQuery = useMemoFirebase(
    () => (vehicle ? query(collection(db, "vehicleComplianceHistory"), where("vehicleId", "==", vehicle.id)) : null),
    [db, vehicle?.id]
  )
  const { data: historyRaw } = useCollection<ComplianceHistoryEntry>(historyQuery)
  const history = React.useMemo(
    () => (historyRaw ?? []).slice().sort((a, b) => (b.recordedAt || "").localeCompare(a.recordedAt || "")),
    [historyRaw]
  )

  if (!vehicle) return null

  const setField = (k: DetailField, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const setKind = (kind: ComplianceKind, patch: Partial<KindForm>) =>
    setKindForm((s) => {
      const next = { ...s, [kind]: { ...s[kind], ...patch } }
      // พ.ร.บ. ตรงกับภาษี → แก้วันภาษีแล้ววัน พ.ร.บ. ตาม (ต้องยืนยันใหม่ทั้งคู่)
      if (kind === "tax" && actSameAsTax && patch.expiry !== undefined) {
        next.act = { ...next.act, expiry: patch.expiry, confirmed: false }
      }
      if (kind === "tax" && actSameAsTax && patch.confirmed !== undefined) {
        next.act = { ...next.act, confirmed: patch.confirmed }
      }
      return next
    })

  const saveDetails = async () => {
    const payload: Record<string, unknown> = { id: vehicle.id, updatedAt: serverTimestamp(), updatedBy: userLabel }
    for (const k of Object.keys(FIELD_LABEL) as DetailField[]) {
      const raw = form[k].trim()
      if (!raw) {
        payload[k] = deleteField()
        continue
      }
      if (k === "registrationDate") {
        if (!isIsoDate(raw)) return toast({ title: "วันที่จดทะเบียนไม่ถูกต้อง", variant: "destructive" })
        payload[k] = raw
      } else if (k === "modelYear") {
        const y = Number(raw)
        const max = new Date().getFullYear() + 1
        if (!Number.isInteger(y) || y < 1950 || y > max)
          return toast({ title: "ปีรุ่นต้องเป็น ค.ศ. 4 หลัก", description: `เช่น 2016 (ไม่เกิน ${max})`, variant: "destructive" })
        payload[k] = y
      } else if (NUMBER_FIELDS.includes(k)) {
        const n = Number(raw.replace(/,/g, ""))
        if (!Number.isFinite(n) || n <= 0) return toast({ title: `${FIELD_LABEL[k]} ต้องเป็นตัวเลขมากกว่า 0`, variant: "destructive" })
        payload[k] = n
      } else payload[k] = raw
    }
    setSaving("details")
    try {
      const b = writeBatch(db)
      b.set(doc(db, "vehicleDetails", vehicle.id), payload, { merge: true })
      await b.commit()
      toast({ title: "บันทึกข้อมูลประจำรถแล้ว" })
    } catch (e) {
      console.error(e)
      toast({ title: "บันทึกไม่สำเร็จ", description: "อาจไม่มีสิทธิ์แก้ไข", variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  const saveCompliance = async () => {
    for (const kind of KINDS) {
      const f = kindForm[kind]
      if (f.expiry && !isIsoDate(f.expiry)) return toast({ title: `วันหมดอายุ${KIND_LABEL[kind]}ไม่ถูกต้อง`, variant: "destructive" })
      if (f.confirmed && !f.expiry) return toast({ title: `ยืนยัน${KIND_LABEL[kind]}ไม่ได้ — ยังไม่ได้กรอกวันหมดอายุ`, variant: "destructive" })
    }
    setSaving("compliance")
    try {
      const nowIso = new Date().toISOString()
      const b = writeBatch(db)
      const data: Record<string, unknown> = { id: vehicle.id, updatedAt: serverTimestamp(), responsibleName: responsible.trim() || deleteField() }
      for (const kind of KINDS) {
        const f = kindForm[kind]
        const prev = compliance?.[kind]
        const item: ComplianceItem = { expiry: f.expiry || null, confirmed: f.confirmed && !!f.expiry, workStatus: f.workStatus }
        const newlyConfirmed = item.confirmed && (!prev?.confirmed || prev?.expiry !== item.expiry)
        if (newlyConfirmed) {
          item.confirmedBy = userLabel
          item.confirmedAt = nowIso
          b.set(doc(collection(db, "vehicleComplianceHistory")), {
            vehicleId: vehicle.id,
            licensePlate: vehicle.licensePlate,
            kind,
            action: "confirm",
            prevExpiry: prev?.expiry ?? null,
            newExpiry: item.expiry,
            recordedBy: userLabel,
            recordedAt: nowIso,
          })
        } else if (item.confirmed) {
          item.confirmedBy = prev?.confirmedBy
          item.confirmedAt = prev?.confirmedAt
        }
        data[kind] = JSON.parse(JSON.stringify(item)) // ตัด undefined ออก (Firestore ไม่รับ)
      }
      b.set(doc(db, "vehicleCompliance", vehicle.id), data, { merge: true })
      await b.commit()
      toast({ title: "บันทึกสถานะ พ.ร.บ. / ภาษีแล้ว" })
    } catch (e) {
      console.error(e)
      toast({ title: "บันทึกไม่สำเร็จ", description: "อาจไม่มีสิทธิ์แก้ไข", variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  const regDate = isIsoDate(form.registrationDate) ? form.registrationDate : details?.registrationDate
  const taxCandidates = suggestTaxExpiryCandidates(regDate, today)
  const canRenew = KINDS.some((k) => compliance?.[k]?.expiry)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95%] max-w-2xl rounded-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>รายละเอียดรถ {vehicle.licensePlate}</DialogTitle>
            <DialogDescription>
              ทุกช่องไม่บังคับกรอก — กรอกไม่ครบก็ยังจัดรถได้ตามปกติ
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="compliance">
            <TabsList className="w-full">
              <TabsTrigger value="compliance" className="flex-1">พ.ร.บ. / ภาษี</TabsTrigger>
              <TabsTrigger value="details" className="flex-1">ข้อมูลประจำรถ</TabsTrigger>
              <TabsTrigger value="history" className="flex-1">ประวัติ ({history.length})</TabsTrigger>
            </TabsList>

            {/* ── พ.ร.บ. / ภาษี ── */}
            <TabsContent value="compliance" className="space-y-4 pt-2">
              {KINDS.map((kind) => {
                const f = kindForm[kind]
                const locked = readOnly || (kind === "act" && actSameAsTax)
                return (
                  <div key={kind} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{KIND_LABEL[kind]}</span>
                      <ComplianceBadge kind={kind} item={compliance?.[kind]} today={today} />
                    </div>
                    {kind === "act" && (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={actSameAsTax}
                          disabled={readOnly}
                          onCheckedChange={(c) => {
                            const on = c === true
                            setActSameAsTax(on)
                            if (on) setKind("act", { expiry: kindForm.tax.expiry, confirmed: kindForm.tax.confirmed })
                          }}
                        />
                        วันหมดอายุตรงกับภาษี
                      </label>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">วันหมดอายุรอบปัจจุบัน</Label>
                        <Input
                          type="date"
                          className="h-10"
                          value={f.expiry}
                          disabled={locked}
                          onChange={(e) => setKind(kind, { expiry: e.target.value, confirmed: false })}
                        />
                        <p className="text-xs text-muted-foreground">
                          {f.expiry ? `= ${formatThaiDate(f.expiry)} (พ.ศ.)` : "ยังไม่มีข้อมูล — ระบบจะไม่นับสถานะจนกว่าจะกรอกและยืนยัน"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">สถานะงาน (ยังขึ้นเตือนจนกว่าจะบันทึกต่ออายุ)</Label>
                        <Select
                          value={f.workStatus}
                          disabled={readOnly}
                          onValueChange={(v) => setKind(kind, { workStatus: v as ComplianceWorkStatus })}
                        >
                          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(WORK_LABEL) as ComplianceWorkStatus[]).map((w) => (
                              <SelectItem key={w} value={w}>{w === "none" ? "ยังไม่ดำเนินการ" : WORK_LABEL[w]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {kind === "tax" && !readOnly && (
                      <div className="text-xs text-muted-foreground">
                        {taxCandidates.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>เสนอจากวันจดทะเบียน ({formatThaiDate(regDate)}) — เลือกปีที่ถูก:</span>
                            {taxCandidates.map((c) => (
                              <Button key={c} type="button" size="sm" variant="outline" className="h-7 text-xs"
                                onClick={() => setKind("tax", { expiry: c, confirmed: false })}>
                                {formatThaiDate(c)}
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <span>กรอกวันที่จดทะเบียนในแท็บ "ข้อมูลประจำรถ" เพื่อให้ระบบเสนอวันครบกำหนดภาษี</span>
                        )}
                      </div>
                    )}
                    {!(kind === "act" && actSameAsTax) && (
                      <label className="flex items-start gap-2 text-sm">
                        <Checkbox
                          className="mt-0.5"
                          checked={f.confirmed}
                          disabled={readOnly || !f.expiry}
                          onCheckedChange={(c) => setKind(kind, { confirmed: c === true })}
                        />
                        <span>ยืนยันแล้วว่าเป็นวันหมดอายุรอบปัจจุบัน และตรวจปีที่ต่อถึงแล้ว <span className="text-muted-foreground">(ยืนยันแล้วถึงเริ่มนับวันและขึ้นเตือน)</span></span>
                      </label>
                    )}
                  </div>
                )
              })}
              <div className="space-y-1">
                <Label className="text-xs">ผู้รับผิดชอบ</Label>
                <Input className="h-10" value={responsible} disabled={readOnly} placeholder="เช่น ชื่อเจ้าหน้าที่ดูแลรถคันนี้"
                  onChange={(e) => setResponsible(e.target.value)} />
              </div>
              {!readOnly && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button className="flex-1 bg-accent" onClick={saveCompliance} disabled={saving !== null}>
                    {saving === "compliance" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} บันทึกสถานะ
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setRenewOpen(true)} disabled={!canRenew}
                    title={canRenew ? "" : "ต้องมีวันหมดอายุรอบเดิมก่อน"}>
                    <RefreshCw className="mr-2 h-4 w-4" /> บันทึกการต่ออายุ
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── ข้อมูลประจำรถ ── */}
            <TabsContent value="details" className="space-y-3 pt-2">
              <div className="grid gap-3 sm:grid-cols-2">
                {TEXT_FIELDS.map((k) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-xs">{FIELD_LABEL[k]}</Label>
                    <Input className="h-10" value={form[k]} disabled={readOnly} onChange={(e) => setField(k, e.target.value)} />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-xs">วันที่จดทะเบียน</Label>
                  <Input type="date" className="h-10" value={form.registrationDate} disabled={readOnly}
                    onChange={(e) => setField("registrationDate", e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    {isIsoDate(form.registrationDate) ? `= ${formatThaiDate(form.registrationDate)} (พ.ศ. ${Number(form.registrationDate.slice(0, 4)) + 543})` : " "}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">ปีรุ่น (ค.ศ.) — คนละค่ากับปีจดทะเบียน</Label>
                  <Input inputMode="numeric" className="h-10" placeholder="เช่น 2016" value={form.modelYear} disabled={readOnly}
                    onChange={(e) => setField("modelYear", e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    {/^\d{4}$/.test(form.modelYear) ? `= พ.ศ. ${Number(form.modelYear) + 543}` : " "}
                  </p>
                </div>
                {NUMBER_FIELDS.map((k) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-xs">{FIELD_LABEL[k]}</Label>
                    <Input inputMode="numeric" className="h-10" value={form[k]} disabled={readOnly} onChange={(e) => setField(k, e.target.value)} />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                น้ำหนักบรรทุกตามเล่มแยกจาก "น้ำหนักบรรทุกสูงสุด" บนการ์ดที่ใช้จัดรถ ({vehicle.maxLoadCapacityKg?.toLocaleString()} kg) — ไม่เปลี่ยนค่าที่ใช้จัดรถ
              </p>
              <div className="space-y-1">
                <Label className="text-xs">{FIELD_LABEL.note}</Label>
                <Textarea value={form.note} disabled={readOnly} onChange={(e) => setField("note", e.target.value)} />
              </div>
              {!readOnly && (
                <Button className="w-full bg-accent" onClick={saveDetails} disabled={saving !== null}>
                  {saving === "details" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} บันทึกข้อมูลประจำรถ
                </Button>
              )}
            </TabsContent>

            {/* ── ประวัติ ── */}
            <TabsContent value="history" className="space-y-2 pt-2">
              {history.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีประวัติ</p>}
              {history.map((h) => (
                <div key={h.id} className="rounded-md border p-2.5 text-sm space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {h.action === "renew" ? "🔄 ต่ออายุ" : "✅ ยืนยันวัน"} {KIND_LABEL[h.kind]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.recordedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </div>
                  <div>
                    {formatThaiDate(h.prevExpiry)} → <b>{formatThaiDate(h.newExpiry)}</b>
                  </div>
                  <div className="text-xs text-muted-foreground">โดย {h.recordedBy}{h.note ? ` · ${h.note}` : ""}</div>
                  {h.evidenceId && (
                    <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => openEvidence(db, h.evidenceId as string)}>
                      <FileText className="mr-1 h-3 w-3" /> ดูหลักฐาน{h.evidenceName ? ` (${h.evidenceName})` : ""}
                    </Button>
                  )}
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {!readOnly && (
        <RenewDialog
          open={renewOpen}
          onOpenChange={setRenewOpen}
          vehicle={vehicle}
          compliance={compliance}
          userLabel={userLabel}
        />
      )}
    </>
  )
}

function RenewDialog({
  open,
  onOpenChange,
  vehicle,
  compliance,
  userLabel,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  vehicle: Vehicle
  compliance?: VehicleCompliance
  userLabel: string
}) {
  const db = useFirestore()
  const { toast } = useToast()
  const [pick, setPick] = React.useState<Record<ComplianceKind, boolean>>({ tax: false, act: false })
  const [newExpiry, setNewExpiry] = React.useState<Record<ComplianceKind, string>>({ tax: "", act: "" })
  const [checked, setChecked] = React.useState(false)
  const [note, setNote] = React.useState("")
  const [file, setFile] = React.useState<File | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const prev = (k: ComplianceKind) => compliance?.[k]?.expiry ?? null
    // ไม่ติ๊กให้ล่วงหน้า — ให้เลือกเองว่าต่ออะไร (กันต่อผิดรายการโดยไม่ตั้งใจ)
    setPick({ tax: false, act: false })
    setNewExpiry({ tax: suggestRenewedExpiry(prev("tax")) ?? "", act: suggestRenewedExpiry(prev("act")) ?? "" })
    setChecked(false)
    setNote("")
    setFile(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    const kinds = KINDS.filter((k) => pick[k])
    if (kinds.length === 0) return toast({ title: "เลือกอย่างน้อย 1 รายการ", variant: "destructive" })
    for (const k of kinds) {
      const prev = compliance?.[k]?.expiry
      if (!prev) return toast({ title: `${KIND_LABEL[k]}ยังไม่มีวันหมดอายุรอบเดิม`, variant: "destructive" })
      if (!isIsoDate(newExpiry[k]) || newExpiry[k] <= prev)
        return toast({ title: `วันหมดอายุรอบใหม่ของ${KIND_LABEL[k]}ต้องหลังรอบเดิม (${formatThaiDate(prev)})`, variant: "destructive" })
    }
    if (!checked) return toast({ title: "กรุณาติ๊กยืนยันว่าตรวจวันหมดอายุรอบใหม่แล้ว", variant: "destructive" })

    setSaving(true)
    try {
      const nowIso = new Date().toISOString()
      const b = writeBatch(db)
      let evidenceId: string | undefined
      if (file) {
        const dataUrl = await readEvidence(file)
        const evRef = doc(collection(db, "vehicleComplianceEvidence"))
        evidenceId = evRef.id
        b.set(evRef, { vehicleId: vehicle.id, fileName: file.name, dataUrl, uploadedBy: userLabel, uploadedAt: nowIso })
      }
      const update: Record<string, unknown> = { id: vehicle.id, updatedAt: serverTimestamp() }
      for (const k of kinds) {
        b.set(doc(collection(db, "vehicleComplianceHistory")), {
          vehicleId: vehicle.id,
          licensePlate: vehicle.licensePlate,
          kind: k,
          action: "renew",
          prevExpiry: compliance?.[k]?.expiry ?? null,
          newExpiry: newExpiry[k],
          recordedBy: userLabel,
          recordedAt: nowIso,
          ...(evidenceId ? { evidenceId, evidenceName: file?.name } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        })
        // ต่อสำเร็จ = รอบใหม่ยืนยันแล้ว + สถานะงานกลับเป็นปกติ → เตือนของรอบเก่าหายเอง
        update[k] = { expiry: newExpiry[k], confirmed: true, confirmedBy: userLabel, confirmedAt: nowIso, workStatus: "none" }
      }
      b.set(doc(db, "vehicleCompliance", vehicle.id), update, { merge: true })
      await b.commit()
      toast({ title: "บันทึกการต่ออายุแล้ว", description: kinds.map((k) => `${KIND_LABEL[k]} → ${formatThaiDate(newExpiry[k])}`).join(" · ") })
      onOpenChange(false)
    } catch (e: any) {
      console.error(e)
      toast({ title: "บันทึกไม่สำเร็จ", description: e?.message || "อาจไม่มีสิทธิ์แก้ไข", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95%] max-w-lg rounded-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>บันทึกการต่ออายุ — {vehicle.licensePlate}</DialogTitle>
          <DialogDescription>ระบบเสนอวันรอบใหม่จากรอบเดิม + 1 ปี (ไม่ใช้วันที่จ่ายเงิน) — ตรวจและแก้ได้ก่อนยืนยัน</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {KINDS.map((k) => {
            const prev = compliance?.[k]?.expiry
            return (
              <div key={k} className="rounded-md border p-3 space-y-2">
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox checked={pick[k]} disabled={!prev} onCheckedChange={(c) => setPick((p) => ({ ...p, [k]: c === true }))} />
                  ต่อ{KIND_LABEL[k]}
                </label>
                {prev ? (
                  <div className="grid gap-2 sm:grid-cols-2 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">รอบเดิมหมดอายุ</div>
                      <div>{formatThaiDate(prev)}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">รอบใหม่หมดอายุ</div>
                      <Input type="date" className="h-9" value={newExpiry[k]} disabled={!pick[k]}
                        onChange={(e) => setNewExpiry((s) => ({ ...s, [k]: e.target.value }))} />
                      <div className="text-xs text-muted-foreground">{newExpiry[k] ? `= ${formatThaiDate(newExpiry[k])}` : ""}</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">ยังไม่มีวันหมดอายุรอบเดิม — กรอกและยืนยันในหน้ารายละเอียดก่อน</p>
                )}
              </div>
            )
          })}
          <div className="space-y-1">
            <Label className="text-xs">หลักฐาน (รูปใบเสร็จ / ป้ายภาษี / กรมธรรม์ — ไม่บังคับ)</Label>
            <Input type="file" accept="image/*,application/pdf" className="h-10" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">หมายเหตุ</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ต่อที่ขนส่ง / เลขใบเสร็จ" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(c) => setChecked(c === true)} />
            ตรวจวันหมดอายุรอบใหม่กับเอกสารจริงแล้ว
          </label>
        </div>
        <DialogFooter>
          <Button className="w-full bg-accent" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} ยืนยันการต่ออายุ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
