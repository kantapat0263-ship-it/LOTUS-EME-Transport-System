"use client"

import * as React from 'react'
import type { User } from 'firebase/auth'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { canSyncTripCoordinates, coordinateSyncDigest, coordinateSyncPreview, type CoordinatePair, type CoordinatePreview, type CoordinateSyncCommand } from '@/lib/tripCoordinateSync'
import { saveTripCoordinates, syncCoordinatesWithDistance } from '@/lib/tripCoordinateSyncClient'
import { computeTripPlanDistance, type PlanDistance } from '@/lib/planDistance'
import { updateTripWithQueueGuard } from '@/lib/tripQueueGuard'
import { useFirestore } from '@/firebase'
import { serverTimestamp } from 'firebase/firestore'
import type { Site, Trip } from '@/types/models'

const formatCoords = ({ lat, lng }: CoordinatePair) => lat == null || lng == null ? 'ไม่มีพิกัด' : `${lat.toFixed(6)}, ${lng.toFixed(6)}`

export function TripCoordinateSyncDialog({ trip, sites, user, mapsApiKey }: { trip: Trip; sites: Site[]; user: User; mapsApiKey: string }) {
  const { toast } = useToast()
  const db = useFirestore()
  const [open, setOpen] = React.useState(false)
  const [rows, setRows] = React.useState<CoordinatePreview[]>([])
  const [baseline, setBaseline] = React.useState('')
  const [selected, setSelected] = React.useState<number[]>([])
  const [saving, setSaving] = React.useState(false)
  const [preparing, setPreparing] = React.useState(false)
  const [error, setError] = React.useState('')
  const commandRef = React.useRef<CoordinateSyncCommand | null>(null)
  // ซิงก์พิกัดแล้วแต่บันทึก กม. ไม่สำเร็จ — เก็บผลระยะไว้ให้กดบันทึกซ้ำ (ซิงก์ซ้ำจะไม่คิดใหม่เพราะพิกัดตรงแล้ว)
  const [distanceRetry, setDistanceRetry] = React.useState<PlanDistance | null>(null)
  const saveDistance = (plan: PlanDistance) =>
    updateTripWithQueueGuard(db, trip.id, { totalDistanceKm: plan.km, totalEstimatedTimeMinutes: plan.minutes, fuelCost: plan.fuelCost, updatedAt: serverTimestamp() }).then(() => undefined)
  const reloadPreview = async () => {
    setDistanceRetry(null)
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
      const command = commandRef.current
      const outcome = await syncCoordinatesWithDistance({
        trip, command,
        computePlan: stops => computeTripPlanDistance(mapsApiKey, trip, stops),
        sync: () => saveTripCoordinates(user, command),
        saveDistance,
      })
      if (outcome.status === 'plan-failed') {
        setError('คิดระยะทางใหม่ไม่ได้ (แผนที่/อินเทอร์เน็ต) — ยังไม่ได้ซิงก์ ลองอีกครั้ง')
        return
      }
      if (outcome.distance === 'save-failed') {
        // ไม่ปิดหน้าต่าง/ไม่ขึ้นว่าสำเร็จเฉย ๆ (toast โชว์ได้ทีละอัน คำเตือนจะถูกทับ)
        setDistanceRetry(outcome.plan)
        setError(`ซิงก์พิกัดแล้ว ${outcome.updatedStops} จุด แต่บันทึกระยะทางใหม่ไม่สำเร็จ — กด "บันทึกระยะทางอีกครั้ง"`)
        return
      }
      const distanceNote = outcome.distance === 'saved' ? ` · ระยะทาง ${outcome.plan.km.toFixed(1)} กม.` : ''
      toast({ title: 'ซิงก์พิกัดแล้ว', description: `อัปเดต ${outcome.updatedStops} จุดในใบคิวนี้${distanceNote}` })
      setOpen(false)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง') }
    finally { setSaving(false) }
  }
  const retryDistance = async () => {
    if (!distanceRetry || saving) return
    setSaving(true)
    setError('')
    try {
      await saveDistance(distanceRetry)
      toast({ title: 'บันทึกระยะทางแล้ว', description: `ระยะทาง ${distanceRetry.km.toFixed(1)} กม.` })
      setDistanceRetry(null)
      setOpen(false)
    } catch { setError('ยังบันทึกระยะทางใหม่ไม่สำเร็จ — ลองอีกครั้ง') }
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
            เลือกจุดที่จะใช้พิกัดล่าสุดในรายการสถานที่ อัปเดตหมุดนำทาง และคิด กม./ค่าน้ำมันตามแผนใหม่ตามพิกัดใหม่
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
          {distanceRetry ? (
            <Button disabled={saving} onClick={() => void retryDistance()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}บันทึกระยะทางอีกครั้ง
            </Button>
          ) : (
            <Button disabled={saving || preparing || !baseline || !selected.length} onClick={save}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}บันทึกพิกัด {selected.length} จุด
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
