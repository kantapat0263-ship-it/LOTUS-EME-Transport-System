"use client"

import * as React from "react"
import { addDoc, arrayUnion, collection, deleteDoc, deleteField, doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { AlertTriangle, Bell, Check, Loader2, Package, Phone, Plus, Search, SkipForward, Trash2, Truck, Undo2, X } from "lucide-react"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { requestParcelNotifyPermission, useParcelWatches, type ParcelEntry } from "@/hooks/use-parcel-watches"
import { PARCEL_LIMITS, PARCEL_LOOKAHEAD_DAYS, parcelDeadlineWarning, runDateLabel, thaiShortDate, type ParcelRun } from "@/lib/parcelWatch"
import { cn } from "@/lib/utils"
import type { Driver, ParcelWatch, Site } from "@/types/models"

const HISTORY_AFTER_MS = 30 * 86_400_000

/** เวลาที่รายการจบ (ฝากแล้ว/ยกเลิก) — ใช้เรียงและพับเข้าประวัติ */
function doneAtMs(p: ParcelWatch): number {
  if (p.handedAt) return Date.parse(p.handedAt) || 0
  return p.updatedAt?.toMillis?.() ?? 0
}

export default function ParcelsPage() {
  const db = useFirestore()
  const { toast } = useToast()
  const { entries, today, loading, error } = useParcelWatches()
  const [adding, setAdding] = React.useState(false)
  const [showHistory, setShowHistory] = React.useState(false)
  const [permission, setPermission] = React.useState<NotificationPermission | "unsupported">("unsupported")

  const driversRef = useMemoFirebase(() => (db ? collection(db, "drivers") : null), [db])
  const { data: drivers } = useCollection<Driver>(driversRef)
  const phoneOf = (driverId: string) => drivers?.find((d) => d.id === driverId)?.phoneNumber || ""

  React.useEffect(() => {
    if ("Notification" in window) setPermission(Notification.permission)
  }, [adding])

  const all = entries ?? []
  const ready = all.filter((e) => e.parcel.status === "waiting" && e.runs.length > 0).sort((a, b) => a.runs[0].date.localeCompare(b.runs[0].date))
  const waiting = all.filter((e) => e.parcel.status === "waiting" && e.runs.length === 0)
    .sort((a, b) => (b.parcel.createdAt?.toMillis?.() ?? 0) - (a.parcel.createdAt?.toMillis?.() ?? 0))
  const done = all.filter((e) => e.parcel.status !== "waiting").sort((a, b) => doneAtMs(b.parcel) - doneAtMs(a.parcel))
  const recentDone = done.filter((e) => Date.now() - doneAtMs(e.parcel) <= HISTORY_AFTER_MS)
  const oldDone = done.filter((e) => Date.now() - doneAtMs(e.parcel) > HISTORY_AFTER_MS)

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action()
      toast({ title: success })
    } catch {
      toast({ title: "บันทึกไม่สำเร็จ", description: "ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", variant: "destructive" })
    }
  }
  const ref = (p: ParcelWatch) => doc(db, "parcelWatches", p.id)
  const actions = {
    handed: (p: ParcelWatch, r: ParcelRun) => run(() => updateDoc(ref(p), {
      status: "handed", handedAt: new Date().toISOString(), handedTripId: r.tripDocId, handedTripDate: r.date, handedPlate: r.plate, updatedAt: serverTimestamp(),
    }), "บันทึกว่าฝากแล้ว"),
    skip: (p: ParcelWatch, r: ParcelRun) => run(() => updateDoc(ref(p), { skippedTripIds: arrayUnion(r.tripDocId), updatedAt: serverTimestamp() }), "ข้ามเที่ยวนี้ รอรอบถัดไป"),
    unskip: (p: ParcelWatch) => run(() => updateDoc(ref(p), { skippedTripIds: [], updatedAt: serverTimestamp() }), "นับเที่ยวที่ข้ามไว้กลับมาแล้ว"),
    cancel: (p: ParcelWatch) => run(() => updateDoc(ref(p), { status: "cancelled", updatedAt: serverTimestamp() }), "ยกเลิกรายการแล้ว"),
    reopen: (p: ParcelWatch) => run(() => updateDoc(ref(p), {
      status: "waiting", handedAt: deleteField(), handedTripId: deleteField(), handedTripDate: deleteField(), handedPlate: deleteField(), updatedAt: serverTimestamp(),
    }), "กลับมารอรถแล้ว"),
    remove: (p: ParcelWatch) => {
      if (confirm(`ลบรายการ "${p.item}" ถาวร?`)) run(() => deleteDoc(ref(p)), "ลบรายการแล้ว")
    },
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Package className="h-7 w-7 text-accent" /> ฝากของไปไซต์</h2>
          <p className="text-muted-foreground text-sm mt-1">
            ระบุของที่จะฝากไปไซต์ ระบบแจ้งเตือนเมื่อคนจัดรถจัดคิวรถไปไซต์นั้น (ดูล่วงหน้า {PARCEL_LOOKAHEAD_DAYS} วัน) · เห็นเฉพาะรายการของคุณ
          </p>
        </div>
        <Button onClick={() => setAdding(true)} className="h-11 bg-accent text-white hover:bg-accent/90 shrink-0">
          <Plus className="mr-2 h-4 w-4" /> ฝากของ
        </Button>
      </div>

      {permission === "default" && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm">
          <Bell className="h-4 w-4 text-accent shrink-0" />
          <span className="flex-1 min-w-[12rem]">เปิด popup แจ้งเตือนมุมจอ เพื่อให้รู้ทันทีเมื่อมีรถไปไซต์ที่ฝากของ (ต้องเปิดระบบค้างไว้)</span>
          <Button size="sm" variant="outline" onClick={() => {
            if (!("Notification" in window)) return
            Notification.requestPermission().then(setPermission).catch(() => {})
          }}>เปิดแจ้งเตือน</Button>
        </div>
      )}
      {permission === "denied" && (
        <p className="text-xs text-muted-foreground">เบราว์เซอร์ปิด popup แจ้งเตือนของเว็บนี้ไว้ — ยังเห็นจุดแดงที่เมนูได้ตามปกติ (เปิด popup ได้ที่ตั้งค่าเว็บไซต์ของเบราว์เซอร์)</p>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">โหลดรายการไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้า</p>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
      ) : all.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <Package className="h-10 w-10 mx-auto opacity-40" />
            <p>ยังไม่มีของที่ฝากไว้</p>
            <p className="text-xs">กด "ฝากของ" แล้วเลือกไซต์ ระบบจะบอกเมื่อมีรถไปไซต์นั้น</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Section title="มีรถไปแล้ว" count={ready.length} tone="ready">
            {ready.map((e) => <ParcelCard key={e.parcel.id} entry={e} today={today} phoneOf={phoneOf} actions={actions} />)}
          </Section>
          <Section title="รอรถ" count={waiting.length} tone="waiting">
            {waiting.map((e) => <ParcelCard key={e.parcel.id} entry={e} today={today} phoneOf={phoneOf} actions={actions} />)}
          </Section>
          <Section title="ฝากแล้ว / ยกเลิก (30 วันล่าสุด)" count={recentDone.length} tone="done">
            {recentDone.map((e) => <ParcelCard key={e.parcel.id} entry={e} today={today} phoneOf={phoneOf} actions={actions} />)}
          </Section>
          {oldDone.length > 0 && (
            <div className="space-y-3">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? "ซ่อนประวัติ" : `ดูประวัติเก่า (${oldDone.length})`}
              </Button>
              {showHistory && oldDone.map((e) => <ParcelCard key={e.parcel.id} entry={e} today={today} phoneOf={phoneOf} actions={actions} />)}
            </div>
          )}
        </>
      )}

      <AddParcelDialog open={adding} onOpenChange={setAdding} today={today} />
    </div>
  )
}

function Section({ title, count, tone, children }: { title: string; count: number; tone: "ready" | "waiting" | "done"; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <section className="space-y-3">
      <h3 className={cn("text-sm font-bold flex items-center gap-2",
        tone === "ready" ? "text-green-600" : tone === "waiting" ? "text-foreground" : "text-muted-foreground")}>
        {tone === "ready" && <span className="h-2 w-2 rounded-full bg-red-500" />}
        {title} <span className="font-normal">({count})</span>
      </h3>
      {children}
    </section>
  )
}

interface CardActions {
  handed: (p: ParcelWatch, r: ParcelRun) => void
  skip: (p: ParcelWatch, r: ParcelRun) => void
  unskip: (p: ParcelWatch) => void
  cancel: (p: ParcelWatch) => void
  reopen: (p: ParcelWatch) => void
  remove: (p: ParcelWatch) => void
}

function ParcelCard({ entry, today, phoneOf, actions }: { entry: ParcelEntry; today: string; phoneOf: (driverId: string) => string; actions: CardActions }) {
  const { parcel, runs } = entry
  const first = runs[0]
  const warning = parcelDeadlineWarning(parcel, first, today)
  const phone = first ? phoneOf(first.driverId) : ""
  const skippedCount = parcel.skippedTripIds?.length ?? 0
  const isDone = parcel.status !== "waiting"

  return (
    <Card className={cn("overflow-hidden", first ? "border-green-500/50" : isDone ? "opacity-75" : "border-accent/20")}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold break-words">📦 {parcel.item}</p>
            <p className="text-sm text-muted-foreground break-words">→ {parcel.siteName}</p>
            {parcel.note && <p className="text-sm break-words">ส่งให้ / หมายเหตุ: {parcel.note}</p>}
            {parcel.deadline && !isDone && <p className="text-xs text-muted-foreground">ต้องถึงภายใน {thaiShortDate(parcel.deadline)}</p>}
          </div>
          {parcel.status === "handed" && <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-700">ฝากแล้ว</span>}
          {parcel.status === "cancelled" && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">ยกเลิก</span>}
        </div>

        {warning && (
          <p className="flex items-start gap-2 rounded-md bg-orange-500/10 p-2 text-sm text-orange-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {warning}
          </p>
        )}

        {first && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 space-y-1 text-sm">
            <p className="font-semibold text-green-700 flex items-center gap-2"><Truck className="h-4 w-4" /> มีรถไป {runDateLabel(first.date, today)}{runDateLabel(first.date, today) !== thaiShortDate(first.date) && ` (${thaiShortDate(first.date)})`}</p>
            <p>{first.plate}{first.driverName && ` · ${first.driverName}`}
              {phone && <a href={`tel:${phone}`} className="ml-2 inline-flex items-center gap-1 text-accent underline"><Phone className="h-3 w-3" />{phone}</a>}
            </p>
            {first.otherSites.length > 0 && <p className="text-muted-foreground">ไปพร้อม: {first.otherSites.join(", ")}</p>}
            {runs.length > 1 && <p className="text-xs text-muted-foreground">เที่ยวถัดไป: {runs.slice(1, 4).map((r) => runDateLabel(r.date, today)).join(", ")}</p>}
          </div>
        )}
        {!first && !isDone && (
          <p className="text-sm text-muted-foreground">ยังไม่มีรถไปไซต์นี้ใน {PARCEL_LOOKAHEAD_DAYS} วันข้างหน้า — ระบบจะแจ้งเมื่อคนจัดรถจัดคิว</p>
        )}
        {parcel.status === "handed" && (
          <p className="text-sm text-muted-foreground">
            ฝากไปกับ {parcel.handedPlate || "-"}{parcel.handedTripDate && ` วันที่ ${thaiShortDate(parcel.handedTripDate)}`}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {first && (
            <>
              <Button size="sm" className="bg-green-600 text-white hover:bg-green-700" onClick={() => actions.handed(parcel, first)}>
                <Check className="mr-1 h-4 w-4" /> ฝากแล้ว
              </Button>
              <Button size="sm" variant="outline" onClick={() => actions.skip(parcel, first)}>
                <SkipForward className="mr-1 h-4 w-4" /> รอรอบถัดไป
              </Button>
            </>
          )}
          {!isDone && skippedCount > 0 && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => actions.unskip(parcel)}>
              นับ {skippedCount} เที่ยวที่ข้ามกลับมา
            </Button>
          )}
          {!isDone && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => actions.cancel(parcel)}>
              <X className="mr-1 h-4 w-4" /> ยกเลิก
            </Button>
          )}
          {isDone && (
            <>
              <Button size="sm" variant="outline" onClick={() => actions.reopen(parcel)}>
                <Undo2 className="mr-1 h-4 w-4" /> กลับไปรอรถ
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => actions.remove(parcel)}>
                <Trash2 className="mr-1 h-4 w-4" /> ลบ
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AddParcelDialog({ open, onOpenChange, today }: { open: boolean; onOpenChange: (open: boolean) => void; today: string }) {
  const db = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const sitesRef = useMemoFirebase(() => (db && open ? collection(db, "sites") : null), [db, open])
  const { data: sites } = useCollection<Site>(sitesRef)

  const [search, setSearch] = React.useState("")
  const [site, setSite] = React.useState<Site | null>(null)
  const [item, setItem] = React.useState("")
  const [note, setNote] = React.useState("")
  const [deadline, setDeadline] = React.useState("")
  const [errors, setErrors] = React.useState<{ site?: string; item?: string; deadline?: string }>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setSearch(""); setSite(null); setItem(""); setNote(""); setDeadline(""); setErrors({})
  }, [open])

  const term = search.trim().toLowerCase()
  const matches = (sites ?? [])
    .filter((s) => s.status !== "Inactive" && (!term || s.name.toLowerCase().includes(term) || (s.address || "").toLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name, "th"))
    .slice(0, 50)

  const save = async () => {
    const next: typeof errors = {}
    if (!site) next.site = "เลือกไซต์ที่จะฝากของไป"
    if (!item.trim()) next.item = "ระบุของที่จะฝาก"
    if (deadline && deadline < today) next.deadline = "วันที่ต้องถึงต้องเป็นวันนี้หรือหลังจากนี้"
    setErrors(next)
    if (Object.keys(next).length > 0 || !site || !user) return
    requestParcelNotifyPermission()
    setSaving(true)
    try {
      await addDoc(collection(db, "parcelWatches"), {
        userId: user.uid,
        siteId: site.id,
        siteName: site.name,
        item: item.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        deadline: deadline || null,
        status: "waiting",
        skippedTripIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast({ title: "บันทึกแล้ว", description: `ระบบจะแจ้งเมื่อมีรถไป ${site.name}` })
      onOpenChange(false)
    } catch {
      toast({ title: "บันทึกไม่สำเร็จ", description: "ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ฝากของไปไซต์</DialogTitle>
          <DialogDescription>ระบบจะแจ้งเตือนเมื่อคนจัดรถจัดคิวรถไปไซต์ที่เลือก</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>ไซต์ปลายทาง</Label>
            {site ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent/5 p-2 text-sm">
                <span className="font-medium break-words">{site.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setSite(null)}>เปลี่ยน</Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="พิมพ์ค้นหาชื่อไซต์ หรือที่อยู่..." className="h-11 pl-10" />
                </div>
                <div className={cn("max-h-56 overflow-y-auto rounded-md border divide-y", errors.site && "border-destructive")}>
                  {sites == null ? (
                    <p className="p-3 text-center text-xs text-muted-foreground">กำลังโหลดรายชื่อไซต์...</p>
                  ) : matches.length === 0 ? (
                    <p className="p-3 text-center text-xs text-muted-foreground">ไม่พบไซต์</p>
                  ) : matches.map((s) => (
                    <button key={s.id} type="button" onClick={() => { setSite(s); setErrors((e) => ({ ...e, site: undefined })) }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary/60">
                      {s.name}
                      {s.address && <span className="block text-xs text-muted-foreground truncate">{s.address}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {errors.site && <p className="text-xs text-destructive">{errors.site}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="parcel-item">ของที่จะฝาก</Label>
            <Input id="parcel-item" value={item} maxLength={PARCEL_LIMITS.item} placeholder="เช่น Notebook 1 เครื่อง + สายชาร์จ"
              onChange={(e) => { setItem(e.target.value); setErrors((er) => ({ ...er, item: undefined })) }}
              className={cn("h-11", errors.item && "border-destructive")} />
            {errors.item && <p className="text-xs text-destructive">{errors.item}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="parcel-note">ส่งให้ใคร / หมายเหตุ (ไม่บังคับ)</Label>
            <Input id="parcel-note" value={note} maxLength={PARCEL_LIMITS.note} placeholder="เช่น ให้พี่สมชาย หน้างาน" onChange={(e) => setNote(e.target.value)} className="h-11" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="parcel-deadline">ต้องถึงภายใน (ไม่บังคับ)</Label>
            <Input id="parcel-deadline" type="date" value={deadline} min={today}
              onChange={(e) => { setDeadline(e.target.value); setErrors((er) => ({ ...er, deadline: undefined })) }}
              className={cn("h-11", errors.deadline && "border-destructive")} />
            {errors.deadline && <p className="text-xs text-destructive">{errors.deadline}</p>}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button onClick={save} disabled={saving} className="bg-accent text-white hover:bg-accent/90">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
