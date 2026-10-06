"use client"

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { queueDateLabel } from './QueueNoticeCard'
import type { ContinuousBooking } from '@/types/continuous-queue'

export interface BorrowChoice {
  bookingId: string
  borrowDriver: boolean
  borrowVehicle: boolean
  reason: string
  compensationRequired: boolean
}

export function BorrowQueueDialog({ open, onClose, date, bookings, driverId, vehicleId, destinationNames, isProcessing, onConfirm }: {
  open: boolean
  onClose: () => void
  date: string
  bookings: ContinuousBooking[]
  driverId: string
  vehicleId: string
  destinationNames: string[]
  isProcessing: boolean
  onConfirm: (choice: BorrowChoice) => Promise<void>
}) {
  const [bookingId, setBookingId] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [compensationRequired, setCompensationRequired] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setBookingId(bookings[0]?.id || '')
    setReason('')
    setCompensationRequired(false)
  }, [open, date, driverId, vehicleId])
  const booking = bookings.find(b => b.id === bookingId)
  const borrowDriver = !!booking && driverId === booking.driverId
  const borrowVehicle = !!booking && vehicleId === booking.vehicleId
  const alreadyBorrowed = booking?.overrides[date]?.state === 'borrowed'
  return <Dialog open={open} onOpenChange={next => { if (!next && !isProcessing) onClose() }}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>ปรับคิวเฉพาะวันนี้</DialogTitle>
        <DialogDescription>เก็บช่วงคิวเดิมไว้ เปลี่ยนเฉพาะวันที่ {queueDateLabel(date)} หลังตกลงกับไซต์เดิมแล้ว</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <label className="block space-y-1 text-sm">คิวต้นทาง
          <select className="w-full rounded-md border border-border bg-background p-2" value={bookingId} onChange={e => setBookingId(e.target.value)} disabled={isProcessing}>
            {bookings.map(b => <option value={b.id} key={b.id}>{b.siteName} · {b.driverName} · {b.vehiclePlate}</option>)}
          </select>
        </label>
        {booking && <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p>คิวเดิม {queueDateLabel(booking.startDate)} ถึง {queueDateLabel(booking.endDate)}</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={borrowDriver} disabled readOnly />ยืมคนขับ {booking.driverName}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={borrowVehicle} disabled readOnly />ยืมรถ {booking.vehiclePlate}</label>
          <p className="text-xs text-muted-foreground">รายการที่ยืมยึดตามรถและคนขับที่เลือกด้านล่างหน้าจัดคิว เปลี่ยนได้โดยปิดหน้าต่างแล้วเลือกใหม่</p>
          {!borrowDriver && <p className="text-xs">{booking.driverName} ยังจองให้ {booking.siteName}</p>}
          {!borrowVehicle && <p className="text-xs">รถ {booking.vehiclePlate} ยังจองให้ {booking.siteName}</p>}
        </div>}
        <p className="text-sm">คิวใหม่ไป {destinationNames.join(', ')}</p>
        {alreadyBorrowed && <p role="alert" className="text-sm text-red-400">วันนี้มีการยืมแล้ว ต้องจัดการคืนคิวที่หน้าสรุปคิวก่อน</p>}
        <label className="block space-y-1 text-sm">เหตุผลและข้อตกลงกับไซต์เดิม
          <textarea value={reason} onChange={e => setReason(e.target.value)} disabled={isProcessing} rows={3} className="w-full rounded-md border border-border bg-background p-2" placeholder="เช่น ตกลงยืมไปส่งของเร่งด่วนช่วงวันนี้" />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={compensationRequired} onChange={e => setCompensationRequired(e.target.checked)} disabled={isProcessing} />ตกลงชดเชยให้ไซต์เดิม 1 วัน</label>
        <p className="text-xs text-muted-foreground">หากมีชดเชย เลือกวันว่างและบันทึกคิวชดเชยภายหลังที่หน้าสรุปคิว ไม่มีการขยายวันสิ้นสุดอัตโนมัติ</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isProcessing}>ยกเลิก</Button>
        <Button onClick={() => onConfirm({ bookingId, borrowDriver, borrowVehicle, reason: reason.trim(), compensationRequired })} disabled={isProcessing || !booking || (!borrowDriver && !borrowVehicle) || !reason.trim() || alreadyBorrowed}>
          {isProcessing ? 'กำลังบันทึก' : 'อนุมัติปรับคิวเฉพาะวันนี้'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
