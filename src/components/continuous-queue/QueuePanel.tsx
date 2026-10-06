"use client"

import * as React from 'react'
import { useUser } from '@/firebase'
import { useContinuousQueues } from '@/hooks/use-continuous-queues'
import { runContinuousQueueCommand } from '@/lib/continuousQueueClient'
import { expandQueueDates, isManagedTrip } from '@/lib/continuousQueue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { queueDateLabel } from './QueueNoticeCard'
import type { ContinuousBooking, QueueCommand } from '@/types/continuous-queue'
import type { Trip } from '@/types/models'
import { createQueueCommandFlight } from './queue-command-flight'

type QueueAction =
  | { action: 'extend'; tripId: string }
  | { action: 'return' | 'schedule-compensation' | 'complete-compensation' | 'cancel-compensation' | 'complete-day'; bookingId: string; date: string }

export function QueueBookingSummary({ booking, date }: { booking: ContinuousBooking; date: string }) {
  const override = booking.overrides[date]
  const borrowed = override?.state === 'borrowed'
  const owed = Object.values(booking.overrides).filter(o => o.compensation === 'owed').length
  const scheduled = Object.values(booking.overrides).filter(o => o.compensation === 'scheduled').length
  return <div className="space-y-1 text-sm">
    <p className="font-semibold">{booking.siteName} · {booking.driverName} · {booking.vehiclePlate}</p>
    <p className="text-xs text-muted-foreground">คิวเดิม {queueDateLabel(booking.startDate)} ถึง {queueDateLabel(booking.endDate)}</p>
    {owed > 0 && <p className="text-xs font-medium text-amber-300">{`ค้างชดเชย ${owed} วัน`}</p>}
    {scheduled > 0 && <p className="text-xs font-medium text-amber-300">{`นัดชดเชย ${scheduled} วัน ยังไม่ได้ยืนยันทำงาน`}</p>}
    {date >= booking.startDate && date <= booking.endDate && <p>{borrowed
      ? `วันที่ ${queueDateLabel(date)} ${[override.borrowDriver ? 'คนขับ' : '', override.borrowVehicle ? 'รถ' : ''].filter(Boolean).join('และ')} ไป ${override.targetSiteName}`
      : `วันที่ ${queueDateLabel(date)} ทำงานให้ ${booking.siteName}`}</p>}
    {borrowed && <>
      {!override.borrowDriver && <p className="text-xs text-amber-300">{booking.driverName} ยังจองให้ {booking.siteName}</p>}
      {!override.borrowVehicle && <p className="text-xs text-amber-300">รถ {booking.vehiclePlate} ยังจองให้ {booking.siteName}</p>}
    </>}
  </div>
}

const actionLabels: Record<QueueAction['action'], string> = {
  extend: 'กำหนดคิวต่อเนื่อง', return: 'คืนคิวให้ไซต์เดิม', 'schedule-compensation': 'จัดวันชดเชย',
  'complete-compensation': 'ยืนยันทำงานชดเชยแล้ว', 'cancel-compensation': 'ยกเลิกวันที่นัดชดเชย', 'complete-day': 'ยืนยันทำงานวันนี้แล้ว',
}

export function QueuePanel({ date, trips, onChanged, checkAssignments }: {
  date: string
  trips: Trip[]
  onChanged: () => void | Promise<void>
  checkAssignments: (targets: { driverId: string; date: string }[]) => Promise<boolean>
}) {
  const { user } = useUser()
  const queues = useContinuousQueues(date)
  const [action, setAction] = React.useState<QueueAction | null>(null)
  const [newDate, setNewDate] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const mountedRef = React.useRef(false)
  const contextRef = React.useRef('')
  const commandFlightRef = React.useRef(createQueueCommandFlight())
  contextRef.current = `${date}|${JSON.stringify(action)}|${newDate}|${reason}`
  React.useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const normalTrips = trips.filter(t => t.status === 'Planned' && !isManagedTrip(t))
  const [extendTripId, setExtendTripId] = React.useState('')
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
  const booking = action && 'bookingId' in action ? queues.bookings.find(b => b.id === action.bookingId) : undefined
  const trip = action?.action === 'extend' ? normalTrips.find(t => t.id === action.tripId) : undefined

  const open = (next: QueueAction) => {
    if (commandFlightRef.current.isPending()) return
    setAction(next); setNewDate(''); setReason(''); setError('')
  }

  const confirm = async () => {
    if (!action || !user || commandFlightRef.current.isPending()) return
    const context = contextRef.current
    const current = () => mountedRef.current && contextRef.current === context
    const flight = commandFlightRef.current.begin(current)
    if (!flight) return
    setBusy(true); setError('')
    let succeeded = false
    try {
      if (queues.status !== 'ready') throw new Error('ตรวจข้อมูลคิวไม่ได้ กรุณาโหลดข้อมูลอีกครั้ง')
      let command: QueueCommand
      const operationId = ''
      if (action.action === 'extend') {
        if (!trip || !newDate || newDate <= trip.tripDate) throw new Error('เลือกวันสิ้นสุดหลังวันเริ่มคิว')
        const dates = expandQueueDates(trip.tripDate, newDate)
        if (!await checkAssignments(dates.map(d => ({ driverId: trip.actualDriverId || trip.driverId, date: d })))) return
        command = { action: 'extend', tripId: trip.id, endDate: newDate, operationId }
      } else {
        if (!booking) throw new Error('ไม่พบคิวต้นทางแล้ว กรุณาโหลดข้อมูลใหม่')
        if (action.action === 'schedule-compensation') {
          if (!newDate || newDate < today) throw new Error('เลือกวันที่ชดเชยตั้งแต่วันนี้เป็นต้นไป')
          if (!await checkAssignments([{ driverId: booking.driverId, date: newDate }])) return
          command = { action: 'schedule-compensation', bookingId: booking.id, originalDate: action.date, date: newDate, operationId }
        } else if (action.action === 'return') {
          if (!reason.trim()) throw new Error('กรอกเหตุผลการคืนคิว')
          if (!await checkAssignments([{ driverId: booking.driverId, date: action.date }])) return
          command = { action: 'return', bookingId: booking.id, date: action.date, reason: reason.trim(), operationId }
        } else if (action.action === 'complete-day') {
          command = { action: 'complete-day', bookingId: booking.id, date: action.date, operationId }
        } else {
          command = { action: action.action, bookingId: booking.id, originalDate: action.date, operationId }
        }
      }
      if (!flight.isCurrent()) return
      command.operationId = flight.operationId(JSON.stringify({ ...command, userId: user.uid }))
      await runContinuousQueueCommand(user, command)
      succeeded = true
      if (!flight.isCurrent()) return
      queues.refresh()
      await onChanged()
      if (current()) setAction(null)
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message || 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      flight.finish(succeeded)
      if (mountedRef.current) setBusy(false)
    }
  }

  if (!date) return null
  return <Card className="no-print border-amber-500/30">
    <CardHeader className="pb-3">
      <CardTitle className="text-lg">คิวต่อเนื่องและวันชดเชย</CardTitle>
      <CardDescription>เปลี่ยนคิวเฉพาะวัน เก็บช่วงจองเดิมและข้อตกลงไว้ตรวจย้อนหลัง</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {queues.status !== 'ready' && <div className="space-y-2 text-sm text-amber-300" role="status">
        <p>{queues.status === 'loading' ? 'กำลังตรวจคิวต่อเนื่อง' : 'ตรวจคิวต่อเนื่องไม่ได้ในขณะนี้'}</p>
        {queues.status === 'error' && <Button size="sm" variant="outline" onClick={queues.refresh}>โหลดข้อมูลใหม่</Button>}
      </div>}
      {queues.status === 'ready' && queues.bookings.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีคิวต่อเนื่องหรือวันชดเชยค้าง</p>}
      {queues.status === 'ready' && queues.bookings.map(b => {
        const override = b.overrides[date]
        const effectiveId = override?.state === 'borrowed' ? override.targetTripId : b.dayTripIds[date]
        const effective = trips.find(t => t.id === effectiveId)
        const canReturn = override?.state === 'borrowed' && date >= today && effective?.status === 'Planned'
        return <div key={b.id} className="space-y-3 rounded-lg border border-border p-3">
          <QueueBookingSummary booking={b} date={date} />
          <div className="flex flex-wrap gap-2">
            {canReturn && <Button size="sm" variant="outline" disabled={busy} onClick={() => open({ action: 'return', bookingId: b.id, date })}>คืนคิวให้ไซต์เดิม</Button>}
            {effective && effective.status !== 'Completed' && effective.status !== 'Cancelled' && date <= today && <Button size="sm" variant="outline" disabled={busy} onClick={() => open({ action: 'complete-day', bookingId: b.id, date })}>ยืนยันทำงานวันนี้แล้ว</Button>}
            {effective?.status === 'Completed' && <p className="text-xs text-green-400">ยืนยันปิดผลงานวันนี้แล้ว</p>}
          </div>
          {Object.keys(b.overrides).length > 0 && <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">ประวัติปรับคิวและวันชดเชย</summary>
            <div className="mt-2 space-y-3">
              {Object.entries(b.overrides).sort(([a], [c]) => a.localeCompare(c)).map(([originalDate, ov]) => <div key={originalDate} className="space-y-2 rounded-md bg-secondary/20 p-2">
                <p>{`${queueDateLabel(originalDate)} · ${ov.state === 'returned' ? 'คืนคิวแล้ว' : `ไป ${ov.targetSiteName}`} · ${ov.reason}`}</p>
                <p className="text-muted-foreground">{`บันทึกโดย ${ov.approvedByName || ov.approvedBy} เวลา ${new Date(ov.approvedAt).toLocaleString('th-TH')}`}</p>
                {ov.compensation === 'owed' && <div className="flex flex-wrap items-center gap-2 text-amber-300"><span>ค้างชดเชย 1 วัน</span><Button size="sm" variant="outline" disabled={busy} onClick={() => open({ action: 'schedule-compensation', bookingId: b.id, date: originalDate })}>จัดวันชดเชย</Button></div>}
                {ov.compensation === 'scheduled' && <div className="flex flex-wrap items-center gap-2">
                  <span className="text-amber-300">นัดชดเชย {ov.compensationDate ? queueDateLabel(ov.compensationDate) : ''} ยังไม่ได้ยืนยันทำงาน</span>
                  {ov.compensationDate && ov.compensationDate <= today && <Button size="sm" variant="outline" disabled={busy} onClick={() => open({ action: 'complete-compensation', bookingId: b.id, date: originalDate })}>ยืนยันทำงานชดเชยแล้ว</Button>}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => open({ action: 'cancel-compensation', bookingId: b.id, date: originalDate })}>ยกเลิกวันที่นัด</Button>
                </div>}
                {ov.compensation === 'completed' && <p className="text-green-400">ทำงานชดเชยแล้ว {ov.compensationDate ? queueDateLabel(ov.compensationDate) : ''}</p>}
              </div>)}
            </div>
          </details>}
        </div>
      })}
      {normalTrips.length > 0 && date >= today && <div className="space-y-2 border-t border-border pt-3">
        <p className="text-sm">กำหนดช่วงวันที่ให้ใบคิวที่สร้างไว้แล้ว</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select aria-label="เลือกใบคิวที่จะกำหนดช่วงวันที่" value={extendTripId} onChange={e => setExtendTripId(e.target.value)} disabled={busy} className="min-w-0 flex-1 rounded-md border border-border bg-background p-2 text-sm">
            <option value="">เลือกใบคิว</option>{normalTrips.map(t => <option value={t.id} key={t.id}>{t.driverName} · {t.vehiclePlate} · {t.stops.map(s => s.siteName).join(', ')}</option>)}
          </select>
          <Button variant="outline" disabled={busy || !normalTrips.some(t => t.id === extendTripId) || queues.status !== 'ready'} onClick={() => open({ action: 'extend', tripId: extendTripId })}>กำหนดคิวต่อเนื่อง</Button>
        </div>
      </div>}
      <Dialog open={!!action} onOpenChange={next => { if (!next && !commandFlightRef.current.isPending()) setAction(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{action ? actionLabels[action.action] : ''}</DialogTitle>
            <DialogDescription>{booking ? `${booking.siteName} · ${booking.driverName} · ${booking.vehiclePlate}` : trip ? `${trip.driverName} · ${trip.vehiclePlate}` : ''}</DialogDescription>
          </DialogHeader>
          {action?.action === 'extend' && <p className="text-sm">เริ่มวันที่ {trip ? queueDateLabel(trip.tripDate) : ''} จองทั้งคนขับและรถทุกวันในช่วงที่เลือก</p>}
          {action?.action === 'schedule-compensation' && <p className="text-sm">ชดเชยวันที่ยืม {queueDateLabel(action.date)} ใช้คนขับและรถเดิม ระบบจะตรวจว่าทั้งสองมีคิวชนหรือไม่ก่อนบันทึก</p>}
          {(action?.action === 'extend' || action?.action === 'schedule-compensation') && <label className="block space-y-1 text-sm">{action.action === 'extend' ? 'วันที่สิ้นสุดคิว' : 'วันที่ชดเชย'}<input type="date" value={newDate} min={action.action === 'extend' ? trip?.tripDate : today} onChange={e => setNewDate(e.target.value)} disabled={busy} className="w-full rounded-md border border-border bg-background p-2" /></label>}
          {action?.action === 'return' && <><p className="text-sm">คืนได้ก่อนเริ่มทำงาน คิวใหม่ของวันนี้จะถูกยกเลิก และกลับไปใช้คิวไซต์เดิม</p><label className="block space-y-1 text-sm">เหตุผล<textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} className="w-full rounded-md border border-border bg-background p-2" /></label></>}
          {action?.action === 'cancel-compensation' && <p className="text-sm">ยกเลิกวันที่นัดชดเชยและกลับเป็นค้างชดเชย 1 วัน</p>}
          {(action?.action === 'complete-day' || action?.action === 'complete-compensation') && <p className="text-sm">ยืนยันเฉพาะเมื่อได้ทำงานแล้ว การผ่านวันนัดหมายไม่ถือว่าทำงานเสร็จ</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setAction(null)}>ยกเลิก</Button><Button disabled={busy} onClick={() => void confirm()}>{busy ? 'กำลังบันทึก' : 'ยืนยันบันทึก'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>
}
