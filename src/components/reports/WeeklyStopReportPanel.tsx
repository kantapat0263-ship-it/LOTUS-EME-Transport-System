'use client'
import * as React from 'react'
import type { User } from 'firebase/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Lock, Loader2 } from 'lucide-react'
import { todayBangkok } from '@/lib/vehicle-compliance'
import { loadWeeklyStopReport, submitStopReview } from '@/lib/weeklyStopClient'
import type { WeeklyDay, WeeklyEvent, WeeklyStopReport } from '@/lib/driverStopSummary'
import type { StopReviewCommand } from '@/server/weeklyStopValidation'

function monday(date: string) {
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(ms)) return ''
  const weekday = new Date(ms).getUTCDay()
  return new Date(ms - ((weekday + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
}
const minutes = (value: number) => Math.round(value * 10) / 10
const clock = (ms: number) => new Date(ms).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
const kindLabel = { office: 'ออฟฟิศ', job: 'จุดงาน', rest: '🅿 พักระหว่างทาง', lunch: '🍚 พักเที่ยง', review: 'จอดนอกจุดงาน รอตรวจสอบ' }
const qualityLabel = { sufficient: 'คำนวณจาก GPS ที่มี', missing: 'ข้อมูลไม่พอ / ไม่มีระยะวิ่ง', incomplete: 'ข้อมูลไม่พอ / GPS ขาดช่วง', ambiguous: 'ระบุคนขับไม่ได้ / ข้อมูลซ้อนกัน' }

export function WeeklyStopReportPanel({ user, isAdmin }: { user: User | null; isAdmin: boolean }) {
  const [weekStart, setWeekStart] = React.useState(() => monday(todayBangkok()))
  const [report, setReport] = React.useState<WeeklyStopReport | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [selected, setSelected] = React.useState<{ day: WeeklyDay; event: WeeklyEvent } | null>(null)
  const [reason, setReason] = React.useState('')
  const [excluded, setExcluded] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')
  const pending = React.useRef<StopReviewCommand | null>(null)
  const generation = React.useRef(0)
  const saveGeneration = React.useRef(0)
  React.useEffect(() => {
    generation.current++
    saveGeneration.current++
    setReport(null); setError(''); setSelected(null); setLoading(false); setSaving(false); setMessage(''); setSaveError(''); pending.current = null
  }, [user?.uid, isAdmin, weekStart])
  React.useEffect(() => () => { generation.current++; saveGeneration.current++ }, [])
  async function load(keepDraft = false): Promise<WeeklyStopReport | null> {
    if (!user || !isAdmin || !weekStart) return null
    const version = ++generation.current
    setLoading(true); setError('')
    try {
      const value = await loadWeeklyStopReport(user, weekStart)
      if (version !== generation.current) return null
      setReport(value)
      if (keepDraft && selected) {
        const day = value.days.find(row => row.key === selected.day.key)
        const event = day?.events.find(row => row.eventId === selected.event.eventId && row.kind === 'review')
        if (day && event) { setSelected({ day, event }); pending.current = null; setSaveError('โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจและบันทึกอีกครั้ง ข้อความที่กรอกยังอยู่') }
        else setSaveError('จุดจอดเปลี่ยนไปแล้ว ข้อความที่กรอกยังอยู่ กรุณาคัดลอกไว้แล้วเปิดรายการใหม่')
      }
      return value
    } catch (failure) {
      if (version === generation.current) { setReport(null); setError(failure instanceof Error ? failure.message : 'โหลดรายงานไม่สำเร็จ') }
      return null
    } finally { if (version === generation.current) setLoading(false) }
  }
  function edit(day: WeeklyDay, event: WeeklyEvent) {
    setSelected({ day, event }); setReason(event.review?.reason ?? ''); setExcluded(event.review?.stale ? false : event.review?.excluded ?? true); setSaveError(''); pending.current = null
  }
  async function save() {
    if (!user || !selected || !reason.trim() || saving) return
    const command = pending.current ?? { operationId: crypto.randomUUID(), weekStart, dayKey: selected.day.key, eventId: selected.event.eventId, sourceFingerprint: selected.day.sourceFingerprint, expectedVersion: selected.event.review?.version ?? 0, excluded, reason: reason.trim() }
    pending.current = command
    const version = saveGeneration.current
    setSaving(true); setSaveError(''); setMessage('')
    try {
      await submitStopReview(user, command)
      if (version !== saveGeneration.current) return
      pending.current = null; setSelected(null); setMessage('บันทึกเหตุผลแล้ว ตัวเลขจะเปลี่ยนเมื่อโหลดรายงานล่าสุดสำเร็จ')
      await load()
    } catch (failure) {
      if (version === saveGeneration.current) setSaveError(failure instanceof Error ? failure.message : 'ยังยืนยันผลบันทึกไม่ได้')
    } finally { if (version === saveGeneration.current) setSaving(false) }
  }
  if (!isAdmin || !user) return null
  return <Card className="border-sky-500/30">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-5 w-5" /> สรุปรายสัปดาห์ต่อคนขับ</CardTitle>
      <CardDescription>เฉพาะผู้ดูแล · ไม่รวมในภาพรายงานที่ส่งกลุ่ม · ใช้คุยตรวจสอบเป็นรายคน</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="weekly-stop-week">เลือกวันในสัปดาห์ (จันทร์–อาทิตย์)</Label><Input id="weekly-stop-week" type="date" value={weekStart} disabled={loading || saving} onChange={event => { setMessage(''); setWeekStart(monday(event.target.value)) }} /></div>
        <Button onClick={() => load()} disabled={loading || saving || !weekStart}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} โหลดสรุปสัปดาห์</Button>
      </div>
      <p className="text-xs text-muted-foreground">GPS เป็นค่าประมาณ แยกพักหลังขับต่อเนื่อง ≥ 2 ชม. ไม่เกิน 45 นาที และพักเที่ยง 11:30–13:00 ไม่เกิน 60 นาที จุดงาน/ออฟฟิศไม่รวมในเวลารอตรวจสอบ</p>
      {message && <p role="status" className="text-sm text-emerald-400">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {report && <>
        <p className="font-medium">สัปดาห์ {report.weekStart} ถึง {report.weekEnd}</p>
        <p className="text-xs text-muted-foreground">ใช้เฉพาะเวลารอตรวจสอบที่ยังไม่มีเหตุยืนยัน ÷ กม. GPS ที่บันทึก × 100 มี GPS ขาดช่วง / ไม่มีระยะ / คนขับซ้อนกัน จะแสดงข้อมูลไม่พอ จึงไม่ควรเทียบจากตัวเลขดิบหรือใช้ตัดสินคนขับทันที</p>
        {report.drivers.length === 0 && <p className="text-sm text-muted-foreground">ไม่พบวันงานที่ระบุคนขับได้ในสัปดาห์นี้</p>}
        {report.drivers.length > 0 && <Table><TableHeader><TableRow><TableHead>คนขับ</TableHead><TableHead>วัน/คันที่คำนวณได้</TableHead><TableHead>กม. GPS ประมาณ</TableHead><TableHead>รอตรวจสอบ (นาที)</TableHead><TableHead>พักปกติ (นาที)</TableHead><TableHead>นาที / 100 กม.</TableHead></TableRow></TableHeader><TableBody>
          {report.drivers.map(driver => <TableRow key={driver.driverId}><TableCell>{driver.driverName || driver.driverId}</TableCell><TableCell>{driver.sufficientDays}/{driver.days}</TableCell><TableCell>{driver.distanceKm.toFixed(1)}</TableCell><TableCell>{minutes(driver.reviewMin)}{driver.excludedMin > 0 && <div className="text-xs text-muted-foreground">มีเหตุ ตัดออก {minutes(driver.excludedMin)}</div>}</TableCell><TableCell>{minutes(driver.restMin + driver.lunchMin)}</TableCell><TableCell>{driver.minutesPer100Km == null ? 'ข้อมูลไม่พอ' : driver.minutesPer100Km.toFixed(1)}</TableCell></TableRow>)}
        </TableBody></Table>}
        <div className="space-y-2">{report.days.map(day => <details key={day.key} className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{day.date} · {day.plate} · {day.driverName || 'ระบุคนขับไม่ได้'} <span className="text-xs text-muted-foreground">({qualityLabel[day.quality]})</span></summary>
          <p className="mt-2 text-xs text-muted-foreground">GPS ที่ต่อเนื่อง {minutes(day.observedMin)} นาที · ช่วงเงียบ {minutes(day.gapMin)} นาที · การไม่พบจุดจอดไม่ยืนยันว่าทั้งวันไม่มีเหตุ</p>
          {day.quality === 'ambiguous' && <p className="mt-1 text-xs text-amber-400">ผู้เกี่ยวข้อง {day.candidateDrivers.map(driver => driver.driverName || driver.driverId).join(' / ') || 'ไม่ทราบ'} ยังไม่แบ่งระยะหรือเวลาจอดให้ใคร</p>}
          {day.events.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{day.quality === 'sufficient' ? 'ไม่พบจุดจอดนอกออฟฟิศตั้งแต่ 15 นาทีในข้อมูลที่มี' : 'ข้อมูลไม่พอสำหรับสรุปจุดจอด'}</p>}
          {day.events.map(event => <div key={event.eventId} className="mt-3 rounded-md bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className={event.kind === 'review' && !(event.review?.excluded && !event.review.stale) ? 'text-red-400' : 'text-muted-foreground'}>{kindLabel[event.kind]} · {minutes(event.durationMin)} นาที · {clock(event.startT)}–{clock(event.endT)}</span>{event.kind === 'review' && <Button size="sm" variant="outline" disabled={loading || saving} onClick={() => edit(day, event)}>{event.review?.excluded && !event.review.stale ? 'แก้เหตุผล / ยกเลิกตัดเวลา' : 'บันทึกเหตุผล'}</Button>}</div>
            {event.uncertain && <p className="mt-1 text-xs text-amber-400">GPS ขาดช่วงระหว่างจอด เวลาจอดและประเภทพักยังยืนยันไม่ได้ครบ</p>}
            {event.review && <p className="mt-1 text-xs text-muted-foreground">{event.review.stale ? 'ข้อมูลต้นทางเปลี่ยน เหตุเดิมยังไม่ใช้ตัดสถิติ' : event.review.excluded ? 'มีเหตุ ยืนยันตัดออกจากสถิติ' : 'บันทึกไว้ แต่ไม่ตัดออก'} · {event.review.reason} · ผู้บันทึก {event.review.updatedBy}</p>}
            <a className="mt-1 inline-block text-xs text-sky-400 underline" href={`https://www.google.com/maps/search/?api=1&query=${event.lat},${event.lng}`} target="_blank" rel="noopener noreferrer">ดูตำแหน่ง</a>
          </div>)}
        </details>)}</div>
      </>}
    </CardContent>
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !saving && !loading) { setSelected(null); pending.current = null } }}>
      <DialogContent><DialogHeader><DialogTitle>บันทึกเหตุผลจอดนอกจุดงาน</DialogTitle><DialogDescription>{selected?.day.date} · {selected?.day.plate} · {selected?.day.driverName} · {selected && `${clock(selected.event.startT)}–${clock(selected.event.endT)}`}</DialogDescription></DialogHeader>
        <Label htmlFor="weekly-stop-reason">เหตุผล / ข้อมูลที่ยืนยันแล้ว</Label><Textarea id="weekly-stop-reason" value={reason} maxLength={500} disabled={saving || loading} onChange={event => { setReason(event.target.value); pending.current = null }} />
        <Label className="flex items-center gap-2"><Checkbox checked={excluded} disabled={saving || loading} onCheckedChange={value => { setExcluded(value === true); pending.current = null }} /> มีเหตุที่ยืนยันแล้ว ตัดเวลานี้ออกจากสถิติ</Label>
        <p className="text-xs text-muted-foreground">การแก้ไขและยกเลิกเก็บชื่อผู้บันทึกกับประวัติทุกครั้ง ไม่แก้ข้อมูล GPS หรือใบคิว</p>
        {saveError && <p role="alert" className="text-sm text-red-400">{saveError}</p>}
        <DialogFooter><Button variant="outline" disabled={saving || loading} onClick={() => load(true)}>โหลดข้อมูลใหม่ (เก็บข้อความ)</Button><Button disabled={saving || loading || !reason.trim()} onClick={save}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} บันทึกเหตุผล</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
}
