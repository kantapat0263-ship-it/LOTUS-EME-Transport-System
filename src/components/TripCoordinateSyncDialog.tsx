"use client"

import * as React from 'react'
import type { User } from 'firebase/auth'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { canSyncTripCoordinates, coordinateSyncDigest, coordinateSyncPreview, type CoordinatePair, type CoordinatePreview, type CoordinateSyncCommand } from '@/lib/tripCoordinateSync'
import { saveTripCoordinates } from '@/lib/tripCoordinateSyncClient'
import type { Site, Trip } from '@/types/models'

const formatCoords = ({ lat, lng }: CoordinatePair) => lat == null || lng == null ? 'ไม่มีพิกัด' : `${lat.toFixed(6)}, ${lng.toFixed(6)}`

export function TripCoordinateSyncDialog({ trip, sites, user }: { trip: Trip; sites: Site[]; user: User }) {
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [rows, setRows] = React.useState<CoordinatePreview[]>([])
  const [baseline, setBaseline] = React.useState('')
  const [selected, setSelected] = React.useState<number[]>([])
  const [saving, setSaving] = React.useState(false)
  const [preparing, setPreparing] = React.useState(false)
  const [error, setError] = React.useState('')
  const commandRef = React.useRef<CoordinateSyncCommand | null>(null)
  const reloadPreview = async () => {
    setPreparing(true)
    setRows([])
    setBaseline('')
    setSelected([])
    setError('')
    commandRef.current = null
    try {
      const digest = await coordinateSyncDigest(trip)
      setRows(coordinateSyncPreview(trip, sites))
      setBaseline(digest)
    } catch { setError('เตรียมรายการไม่ได้ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง') }
    finally { setPreparing(false) }
  }
  const save = async () => {
    if (saving || preparing || !baseline || !selected.length) return
    if (!commandRef.current) commandRef.current = {
      operationId: crypto.randomUUID(), tripId: trip.id, baseline,
      selections: rows.filter(row => selected.includes(row.stopIndex) && !row.reason).map(row => ({ stopIndex: row.stopIndex, siteId: row.siteId, latitude: row.to.lat!, longitude: row.to.lng! })),
    }
    setSaving(true)
    setError('')
    try {
      const result = await saveTripCoordinates(user, commandRef.current)
      toast({ title: 'ซิงก์พิกัดแล้ว', description: `อัปเดต ${result.updatedStops} จุดในใบคิวนี้` })
      setOpen(false)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง') }
    finally { setSaving(false) }
  }
  return <>
    <Button variant="outline" size="sm" disabled={preparing || !canSyncTripCoordinates(trip)} onClick={() => { void reloadPreview(); setOpen(true) }}>
      <RefreshCw className="h-4 w-4 mr-2" />ซิงก์พิกัดจากสถานที่
    </Button>
    <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next) }}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ซิงก์พิกัดจากสถานที่</DialogTitle>
          <DialogDescription>
            เลือกจุดที่จะใช้พิกัดล่าสุดในรายการสถานที่ อัปเดตหมุดนำทาง ไม่คำนวณ กม. หรือค่าน้ำมันย้อนหลัง
            {trip.queueLink && ' · คิวต่อเนื่องเปลี่ยนเฉพาะใบคิววันที่นี้ ไม่เปลี่ยนวันอื่นในช่วงจอง'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {preparing ? <p className="text-sm text-muted-foreground">กำลังเตรียมรายการ…</p> : rows.length === 0 && !error && <p className="text-sm text-muted-foreground">ใบคิวนี้ไม่มีจุดส่งของ</p>}
          {rows.map(row => <label key={row.stopIndex} className="flex gap-3 rounded-xl border p-3 cursor-pointer">
            <Checkbox aria-label={`เลือกจุด ${row.stopIndex + 1} ${row.siteName}`} className="mt-1" disabled={saving || !!row.reason || (!selected.includes(row.stopIndex) && selected.length >= 100)} checked={selected.includes(row.stopIndex)} onCheckedChange={checked => {
              setSelected(values => checked === true ? [...values, row.stopIndex] : values.filter(index => index !== row.stopIndex))
              commandRef.current = null
              setError('')
            }} />
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-semibold break-words">{row.stopIndex + 1}. {row.siteName}</p>
              <p className="text-muted-foreground">เดิม: {formatCoords(row.from)}</p>
              <p>ล่าสุด: {formatCoords(row.to)}</p>
              {row.reason && <p className="text-xs text-muted-foreground">{row.reason}</p>}
            </div>
          </label>)}
          <p className="text-xs text-muted-foreground">รายการงาน ผู้ขอ ลำดับจุด และหมายเหตุคงเดิม · เลือกได้ครั้งละไม่เกิน 100 จุด</p>
          <p className="text-xs text-muted-foreground">หลังบันทึก ให้คนขับรีเฟรชใบงานที่เปิดค้างอยู่เพื่อใช้พิกัดใหม่</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={saving || preparing} onClick={() => void reloadPreview()}>โหลดรายการใหม่</Button>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>ยกเลิก</Button>
          <Button disabled={saving || preparing || !baseline || !selected.length} onClick={save}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}บันทึกพิกัด {selected.length} จุด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
