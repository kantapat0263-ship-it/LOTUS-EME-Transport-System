"use client"

import * as React from "react"
import { collection, doc, getDocsFromServer, runTransaction, serverTimestamp } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useFirestore } from "@/firebase"
import type { Vehicle, VehicleCompliance, VehicleDetails } from "@/types/models"
import {
  FIELD_LABEL,
  parseVehicleTable,
  planImport,
  planShape,
  suggestVehicleType,
  type DetailField,
  type ImportCreate,
  type ImportPlan,
  type ParsedRow,
} from "@/lib/vehicle-import"
import { expiryToSetFromRegistration, formatThaiDate, isIsoDate } from "@/lib/vehicle-compliance"
import { writeExpiryFromRegistration } from "./expiryFromRegistration"

function show(field: DetailField, v: string | number): string {
  if (field === "registrationDate" && typeof v === "string") return formatThaiDate(v)
  if (typeof v === "number" && field !== "modelYear") return v.toLocaleString()
  return String(v)
}

/** ตัวเลือกของรถใหม่หนึ่งคัน (key = plateKey) */
interface CreatePick {
  include: boolean
  type: string
  maxLoad: string
}

function maxLoadOf(p: CreatePick | undefined): number | null {
  const n = Number((p?.maxLoad ?? "").replace(/,/g, "").trim())
  return Number.isFinite(n) && n >= 1 ? n : null
}

const regOf = (fields: ImportCreate["fields"]) => (typeof fields.registrationDate === "string" ? fields.registrationDate : undefined)

/** เขียนได้ไม่เกิน 500 รายการต่อ transaction — เผื่อไว้ */
const MAX_WRITES = 450

const STALE_MESSAGE = 'ข้อมูลรถในระบบเปลี่ยนระหว่างตรวจ — กด "ตรวจสอบ" อีกครั้ง'

/** หยุด transaction (ไม่บันทึกอะไรเลย) พร้อมข้อความให้ผู้ใช้ · replan = ต้องกด "ตรวจสอบ" ใหม่ */
class ImportAbort extends Error {
  constructor(message: string, readonly replan: boolean) {
    super(message)
  }
}

/**
 * นำเข้ารถจาก Excel: วางตาราง → ดูผลก่อน → ยืนยันครั้งเดียว
 *  - รถที่มีในระบบ: เติมข้อมูลเล่มเฉพาะช่องที่ยังว่าง (transaction อ่านค่าล่าสุดอีกรอบ กันเขียนทับค่าที่มีคนเพิ่งกรอก)
 *  - ทะเบียนที่ยังไม่มี: เพิ่มเป็นรถใหม่ (เลือกประเภท + น้ำหนักบรรทุกสูงสุดที่ใช้จัดรถ · GPS ผูกทีหลัง)
 *  - ตั้งวันหมดอายุภาษี + พ.ร.บ. จากวันจดทะเบียน ให้คันที่ยังไม่มีวันเลย (มีแล้วไม่แตะ)
 * ทั้งหมดอยู่ใน transaction เดียว — สำเร็จทั้งหมดหรือไม่บันทึกเลย
 */
export function VehicleImportDialog({
  open,
  onOpenChange,
  vehicles,
  detailsById,
  complianceById,
  typeOptions,
  today,
  userLabel,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  vehicles: Vehicle[]
  detailsById: Record<string, VehicleDetails>
  complianceById: Record<string, VehicleCompliance>
  typeOptions: string[]
  today: string
  userLabel: string
}) {
  const db = useFirestore()
  const { toast } = useToast()
  const [text, setText] = React.useState("")
  const [rows, setRows] = React.useState<ParsedRow[] | null>(null)
  const [plan, setPlan] = React.useState<ImportPlan | null>(null)
  const [picks, setPicks] = React.useState<Record<string, CreatePick>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setText("")
      setRows(null)
      setPlan(null)
      setPicks({})
      setError(null)
    }
  }, [open])

  const analyse = () => {
    const parsed = parseVehicleTable(text)
    if (parsed.error) {
      setError(parsed.error)
      setRows(null)
      setPlan(null)
      return
    }
    const p = planImport(parsed.rows, vehicles, detailsById)
    setError(null)
    setRows(parsed.rows)
    setPlan(p)
    setPicks(
      Object.fromEntries(
        p.creates.map((c) => [
          c.plateKey,
          {
            include: true,
            type: suggestVehicleType(c.fields, typeOptions, vehicles) ?? "",
            maxLoad: typeof c.fields.payloadKg === "number" ? String(c.fields.payloadKg) : "",
          },
        ])
      )
    )
  }

  const setPick = (key: string, patch: Partial<CreatePick>) =>
    setPicks((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const chosen = React.useMemo(() => (plan?.creates ?? []).filter((c) => picks[c.plateKey]?.include), [plan, picks])
  const incomplete = chosen.filter((c) => !picks[c.plateKey]?.type || maxLoadOf(picks[c.plateKey]) == null)

  // วันหมดอายุที่จะตั้งให้ (ดูตัวอย่าง) — ตอนบันทึกคิดใหม่จากค่าล่าสุดใน transaction ด้วยกติกาเดียวกัน
  const expiryPreview = React.useMemo(() => {
    if (!plan) return []
    const out: { plate: string; expiry: string }[] = []
    for (const m of plan.matched) {
      const cur = detailsById[m.vehicleId]?.registrationDate
      const fill = plan.fills.find((f) => f.vehicleId === m.vehicleId)
      const reg = isIsoDate(cur) ? cur : regOf(fill?.fields ?? {})
      const e = expiryToSetFromRegistration(complianceById[m.vehicleId], reg, today)
      if (e) out.push({ plate: m.licensePlate, expiry: e })
    }
    for (const c of chosen) {
      const e = expiryToSetFromRegistration(undefined, regOf(c.fields), today)
      if (e) out.push({ plate: c.licensePlate, expiry: e })
    }
    return out.sort((a, b) => a.expiry.localeCompare(b.expiry))
  }, [plan, chosen, detailsById, complianceById, today])

  const nothingToDo = !plan || (plan.fills.length === 0 && chosen.length === 0 && expiryPreview.length === 0)

  const apply = async () => {
    if (!plan || !rows || nothingToDo || incomplete.length > 0 || saving) return
    setSaving(true)
    try {
      const by = `${userLabel} (นำเข้า)`
      const expiryBy = `${userLabel} (ตั้งจากวันจดทะเบียน)`
      const nowIso = new Date().toISOString()
      // รถ + ข้อมูลเล่มล่าสุดจาก server (ไม่ใช้ snapshot ของหน้า) → วางแผนใหม่ โครงไม่ตรง = มีคนเพิ่ม/แก้รถระหว่างตรวจ
      // (กันทะเบียนซ้ำ/เลขตัวรถชนได้ถึงเสี้ยววินาทีก่อนบันทึก — ช่องที่เหลือ: นำเข้าทะเบียนเดียวกันพร้อมกันในเสี้ยววินาทีนั้น)
      const [vehicleDocs, detailDocs] = await Promise.all([
        getDocsFromServer(collection(db, "vehicles")),
        getDocsFromServer(collection(db, "vehicleDetails")),
      ])
      const serverVehicles = vehicleDocs.docs.map((d) => ({ ...(d.data() as Vehicle), id: d.id }))
      const serverDetails: Record<string, VehicleDetails> = Object.fromEntries(
        detailDocs.docs.map((d) => [d.id, { ...(d.data() as VehicleDetails), id: d.id }])
      )
      if (planShape(planImport(rows, serverVehicles, serverDetails)) !== planShape(plan)) throw new ImportAbort(STALE_MESSAGE, true)

      // id รถใหม่สุ่มครั้งเดียวต่อการกดยืนยัน (ไม่สุ่มใน callback) — SDK อาจรัน callback ซ้ำหลัง commit สำเร็จแต่คำตอบหาย
      // รอบซ้ำจะเห็นว่ารถ id เหล่านี้มีแล้ว = บันทึกไปแล้ว → ไม่เขียนอะไรเพิ่ม (กันรถซ้ำ/ประวัติซ้ำ)
      const newRefs = chosen.map(() => doc(collection(db, "vehicles")))
      let done = { filled: 0, expirySet: 0, replayed: false }
      let attempt = 0
      await runTransaction(db, async (tx) => {
        attempt++
        const ids = plan.matched.map((m) => m.vehicleId)
        const [newSnaps, vehicleSnaps, detailSnaps, compSnaps] = await Promise.all([
          Promise.all(newRefs.map((ref) => tx.get(ref))),
          Promise.all(ids.map((id) => tx.get(doc(db, "vehicles", id)))),
          Promise.all(ids.map((id) => tx.get(doc(db, "vehicleDetails", id)))),
          Promise.all(ids.map((id) => tx.get(doc(db, "vehicleCompliance", id)))),
        ])
        if (newSnaps.some((snap) => snap.exists())) {
          done = { filled: 0, expirySet: 0, replayed: true }
          return
        }
        // วางแผนใหม่อีกรอบด้วยรถ/ข้อมูลเล่มของคันที่จับคู่ที่อ่านใน transaction:
        // คันนั้นต้องยังอยู่ ทะเบียน/จังหวัด/เลขตัวรถยังตรง และเติมเฉพาะช่องที่ยังว่างจริง
        const liveVehicles = serverVehicles.flatMap((v) => {
          const i = ids.indexOf(v.id)
          if (i < 0) return [v]
          return vehicleSnaps[i].exists() ? [{ ...(vehicleSnaps[i].data() as Vehicle), id: v.id }] : []
        })
        const fresh: Record<string, VehicleDetails> = { ...serverDetails }
        ids.forEach((id, i) => {
          const d = detailSnaps[i].data() as VehicleDetails | undefined
          if (d) fresh[id] = d
          else delete fresh[id]
        })
        const now = planImport(rows, liveVehicles, fresh)
        if (planShape(now) !== planShape(plan)) throw new ImportAbort(STALE_MESSAGE, true)

        let writes = 0
        const count = { filled: 0, expirySet: 0, replayed: false }
        // ใช้คู่รถ↔ทะเบียนจากแผนล่าสุด (now) — ทะเบียนในประวัติต้องเป็นของจริงตอนบันทึก
        now.matched.forEach((m) => {
          const i = ids.indexOf(m.vehicleId)
          const fill = now.fills.find((f) => f.vehicleId === m.vehicleId)
          // นับเผื่อ: doc ที่อ่านแต่ไม่เขียน SDK ก็ส่ง verify ไปใน commit → คันที่จับคู่ = 3 เสมอ (รถ/เล่ม/compliance) + ประวัติ 2 ถ้าตั้งวัน
          writes += 3
          if (fill) {
            count.filled++
            tx.set(doc(db, "vehicleDetails", m.vehicleId), { ...fill.fields, id: m.vehicleId, updatedAt: serverTimestamp(), updatedBy: by }, { merge: true })
          }
          const cur = fresh[m.vehicleId]?.registrationDate
          const reg = isIsoDate(cur) ? cur : regOf(fill?.fields ?? {})
          const expiry = expiryToSetFromRegistration(compSnaps[i].data() as VehicleCompliance | undefined, reg, today)
          if (expiry) {
            count.expirySet++
            writes += 2
            writeExpiryFromRegistration(tx, db, { id: m.vehicleId, licensePlate: m.licensePlate }, expiry, expiryBy, nowIso)
          }
        })

        chosen.forEach((c, i) => {
          const pick = picks[c.plateKey]
          const id = newRefs[i].id
          // รูปเดียวกับฟอร์ม "เพิ่มรถยนต์ใหม่" (ไม่มี GPS / อัตราสิ้นเปลือง = ใช้ค่ามาตรฐาน)
          tx.set(doc(db, "vehicles", id), {
            id,
            licensePlate: c.licensePlate,
            type: pick.type,
            maxLoadCapacityKg: maxLoadOf(pick),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
          tx.set(doc(db, "vehicleDetails", id), { ...c.fields, id, updatedAt: serverTimestamp(), updatedBy: by }, { merge: true })
          writes += 2
          const expiry = expiryToSetFromRegistration(undefined, regOf(c.fields), today)
          if (expiry) {
            count.expirySet++
            writes += 3
            writeExpiryFromRegistration(tx, db, { id, licensePlate: c.licensePlate }, expiry, expiryBy, nowIso)
          }
        })
        // นับจากสิ่งที่จะเขียนจริง (ไม่ใช่ตัวอย่าง) — เกินเพดานก่อน commit = ยกเลิกทั้งหมด
        if (writes > MAX_WRITES) throw new ImportAbort("ตารางใหญ่เกินกว่าจะบันทึกครั้งเดียว — แบ่งวางเป็นชุดละไม่เกินประมาณ 60 คัน", false)
        // รอบซ้ำที่ไม่มีอะไรต้องเขียน (ไม่มีรถใหม่) = รอบก่อนบันทึกไปแล้วแต่คำตอบหาย — อย่าแจ้งว่า "0 คัน"
        if (attempt > 1 && count.filled === 0 && count.expirySet === 0 && chosen.length === 0) count.replayed = true
        done = count
      })
      const { filled, expirySet, replayed } = done
      toast({
        title: "นำเข้าข้อมูลแล้ว",
        description: replayed
          ? "บันทึกเรียบร้อยแล้ว (เน็ตสะดุดระหว่างรอผล — ระบบตรวจแล้วว่าบันทึกครบ ไม่ได้บันทึกซ้ำ)"
          : `เพิ่มรถใหม่ ${chosen.length} คัน · เติมข้อมูล ${filled} คัน · ตั้งวันภาษี/พ.ร.บ. ${expirySet} คัน`,
      })
      onOpenChange(false)
    } catch (e) {
      if (e instanceof ImportAbort) {
        setError(e.message)
        if (e.replan) setPlan(null)
      } else {
        console.error(e)
        // เน็ตหลุดตอนรอผล = อาจบันทึกไปแล้วก็ได้ → ให้กดตรวจสอบใหม่ (รถที่เพิ่มแล้วจะไม่ถูกเสนอซ้ำ)
        setPlan(null)
        toast({ title: "นำเข้าไม่สำเร็จ", description: 'อาจไม่มีสิทธิ์แก้ไข หรือเน็ตหลุด — กด "ตรวจสอบ" อีกครั้งเพื่อดูว่าบันทึกไปแล้วหรือยัง', variant: "destructive" })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95%] max-w-3xl rounded-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>นำเข้ารถจาก Excel</DialogTitle>
          <DialogDescription>
            คัดลอกตารางจาก Excel <b>รวมแถวหัวตาราง</b> แล้ววางด้านล่าง → กด &quot;ตรวจสอบ&quot; เพื่อดูผลก่อน ยังไม่บันทึกจนกว่าจะกดยืนยัน ·
            ทะเบียนที่ยังไม่มีในระบบ = เพิ่มเป็นรถใหม่ · ไม่เขียนทับข้อมูลเดิม · ตั้งวันภาษี/พ.ร.บ. จากวันจดทะเบียนให้คันที่ยังไม่มีวัน
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
            {plan.creates.length > 0 && (
              <Section title={`🆕 รถที่ยังไม่มีในระบบ — จะเพิ่มใหม่ ${chosen.length} จาก ${plan.creates.length} คัน`}>
                <p className="text-xs text-muted-foreground">
                  เลือกประเภทรถ + น้ำหนักบรรทุกสูงสุด (ค่าที่ใช้จัดรถ) ให้ครบ — ระบบเติมให้จากเล่มเท่าที่ทำได้ · GPS ผูกทีหลังได้ที่ปุ่มแก้ไขรถ ·
                  ไม่เอาคันไหนให้เอาติ๊กออก
                </p>
                {plan.creates.map((c) => {
                  const p = picks[c.plateKey]
                  const missing = p?.include && (!p.type || maxLoadOf(p) == null)
                  const reg = regOf(c.fields)
                  return (
                    <div key={c.plateKey} className={`space-y-2 rounded border p-2 ${missing ? "border-orange-400" : ""}`}>
                      <label className="flex cursor-pointer items-center gap-2 font-semibold">
                        <Checkbox checked={!!p?.include} onCheckedChange={(v) => setPick(c.plateKey, { include: v === true })} />
                        {c.licensePlate}
                        {!c.hasPlate && <span className="text-xs font-normal text-orange-600">(ไม่มีเลขทะเบียน — ใช้ชื่อนี้แทน)</span>}
                        <span className="text-xs font-normal text-muted-foreground">← ตาราง{c.rowLabel}</span>
                      </label>
                      <div className="text-xs text-muted-foreground">
                        {[c.fields.brand, c.fields.model, c.fields.bodyType].filter(Boolean).join(" · ")}
                        {reg ? ` · จดทะเบียน ${formatThaiDate(reg)}` : " · ไม่มีวันจดทะเบียน (ภาษี/พ.ร.บ. = ยังไม่มีข้อมูล)"}
                      </div>
                      {p?.include && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Select value={p.type} onValueChange={(v) => setPick(c.plateKey, { type: v })}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="เลือกประเภทรถ" />
                            </SelectTrigger>
                            <SelectContent>
                              {typeOptions.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            className="h-9"
                            inputMode="numeric"
                            placeholder="น้ำหนักบรรทุกสูงสุด (kg)"
                            value={p.maxLoad}
                            onChange={(e) => setPick(c.plateKey, { maxLoad: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </Section>
            )}

            <Section title={`✅ รถที่มีในระบบ — จะเติมข้อมูล ${plan.fills.length} คัน (เฉพาะช่องที่ยังว่าง)`}>
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

            {expiryPreview.length > 0 && (
              <Section title={`📅 จะตั้งวันหมดอายุภาษี + พ.ร.บ. จากวันจดทะเบียน ${expiryPreview.length} คัน (คันที่มีวันอยู่แล้วไม่แตะ)`}>
                <div className="text-xs">
                  {expiryPreview.map((x) => `${x.plate} → ${formatThaiDate(x.expiry)}`).join(" · ")}
                </div>
                <p className="text-xs text-muted-foreground">เป็นวันครบรอบจดทะเบียน — ถ้าไม่ตรงกับป้ายภาษีจริง แก้ได้ที่รายละเอียดรถแต่ละคัน</p>
              </Section>
            )}

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
              <Section title={`✂️ ข้ามบางช่อง (อ่านไม่ชัด / ไม่สมเหตุสมผล) ${plan.skippedFields.length} ช่อง — กรอกทีหลังได้ที่รายละเอียดรถ`}>
                {plan.skippedFields.map((s, i) => (
                  <div key={i} className="text-xs">
                    <b>{s.plate}</b> · {FIELD_LABEL[s.field]} “{s.value}” — {s.reason}
                  </div>
                ))}
              </Section>
            )}

            {plan.untouchedVehicles.length > 0 && (
              <Section title={`▫️ รถในระบบที่ไม่มีในตาราง ${plan.untouchedVehicles.length} คัน (ไม่แตะ)`}>
                <div className="text-xs text-muted-foreground">{plan.untouchedVehicles.join(", ")}</div>
              </Section>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          {plan && incomplete.length > 0 && (
            <p className="text-xs text-orange-600">ยังเลือกประเภทรถ / กรอกน้ำหนักบรรทุกไม่ครบ {incomplete.length} คัน: {incomplete.map((c) => c.licensePlate).join(", ")}</p>
          )}
          <Button className="w-full bg-accent" onClick={apply} disabled={nothingToDo || incomplete.length > 0 || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {plan ? `ยืนยัน: เพิ่มใหม่ ${chosen.length} · เติมข้อมูล ${plan.fills.length} · ตั้งวัน ${expiryPreview.length} คัน` : "ตรวจสอบก่อนบันทึก"}
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
