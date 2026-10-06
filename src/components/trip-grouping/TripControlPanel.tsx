
"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { Truck, User, Navigation, Loader2, AlertCircle } from "lucide-react"
import { LeaveBadge } from "@/components/driver-leave/LeaveBadge"
import { regularDriversFirst, type DriverLeaveStatus } from "@/lib/driverLeave"
import { sortVehiclesByType } from "@/lib/vehicleOrder"

interface TripControlPanelProps {
  selectedCount: number;
  vehicles: any[];
  drivers: any[];
  tripsToday: any[];
  vehicleId: string;
  driverId: string;
  setVehicleId: (id: string) => void;
  setDriverId: (id: string) => void;
  onCreate: () => void;
  isProcessing: boolean;
  mode: 'auto' | 'manual';
  leaveFor: (driverId: string) => DriverLeaveStatus;
  startDate: string;
  endDate: string;
  setEndDate: (date: string) => void;
  queueStatus: 'loading' | 'ready' | 'error';
  hasQueueConflict: boolean;
  onRefreshQueues: () => void;
}

export function TripControlPanel({
  selectedCount,
  vehicles,
  drivers,
  tripsToday,
  vehicleId,
  driverId,
  setVehicleId,
  setDriverId,
  onCreate,
  isProcessing,
  mode,
  leaveFor,
  startDate,
  endDate,
  setEndDate,
  queueStatus,
  hasQueueConflict,
  onRefreshQueues
}: TripControlPanelProps) {
  const orderedDrivers = React.useMemo(() => regularDriversFirst(drivers), [drivers])
  const orderedVehicles = React.useMemo(() => sortVehiclesByType(vehicles), [vehicles])
  return (
    <Card className="fixed bottom-4 left-4 right-4 lg:left-[17rem] lg:right-8 z-30 shadow-xl border-accent/20 bg-card/95 backdrop-blur-md">
      <CardContent className="p-4">
        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-4">
          {/* Summary */}
          <div className="flex items-center gap-3 min-w-[160px] border-b xl:border-b-0 xl:border-r border-border/50 pb-3 xl:pb-0 xl:pr-4">
            <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center font-bold text-lg text-white shadow shadow-accent/20">
              {selectedCount}
            </div>
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">จุดหมาย</p>
              <p className="text-sm font-bold text-white">เตรียมจัดเที่ยววิ่ง</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-accent flex items-center gap-1 uppercase">
                <Truck className="h-3 w-3" /> เลือกรถ
              </label>
              <Select value={vehicleId} onValueChange={setVehicleId} disabled={isProcessing}>
                <SelectTrigger className="h-10 text-sm font-medium">
                  <SelectValue placeholder="ค้นหาทะเบียนรถ..." />
                </SelectTrigger>
                <SelectContent>
                  {orderedVehicles.map(v => (
                    <SelectItem key={v.id} value={v.id} className="text-sm">
                      {v.licensePlate} ({v.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-accent flex items-center gap-1 uppercase">
                <User className="h-3 w-3" /> เลือกคนขับ
              </label>
              <Select value={driverId} onValueChange={setDriverId} disabled={isProcessing}>
                <SelectTrigger className="h-10 text-sm font-medium">
                  <SelectValue placeholder="ค้นหาชื่อคนขับ..." />
                </SelectTrigger>
                <SelectContent>
                  {orderedDrivers.map(d => {
                    const hasTrip = tripsToday.some(t => t.driverId === d.id && t.status !== 'Cancelled')
                    return (
                      <SelectItem key={d.id} value={d.id} className="text-sm">
                        <div className="flex items-center justify-between w-full">
                          <span className="flex min-w-0 items-center gap-2">
                            <span>{hasTrip ? '✅ ' : '○ '}{d.name}</span>
                            <LeaveBadge status={leaveFor(d.id)} />
                          </span>
                          {hasTrip && <span className="ml-2 text-[10px] opacity-60">(มีงานแล้ว)</span>}
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label htmlFor="continuous-queue-end" className="text-xs text-muted-foreground">คิวต่อเนื่องถึงวันที่ <span className="text-[10px]">เว้นว่างหากทำวันเดียว</span></label>
              <input id="continuous-queue-end" type="date" min={startDate} value={endDate} onChange={e => setEndDate(e.target.value)} disabled={isProcessing || hasQueueConflict} className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" />
              {hasQueueConflict && <p className="text-xs text-amber-300">คนขับหรือรถมีคิวต่อเนื่องอยู่ ปรับเฉพาะวันที่เลือกได้หลังตกลงกับไซต์เดิม</p>}
              {queueStatus !== 'ready' && <p className="text-xs text-amber-300">{queueStatus === 'loading' ? 'กำลังตรวจคิวต่อเนื่อง' : 'ตรวจคิวต่อเนื่องไม่ได้ ลองโหลดข้อมูลอีกครั้ง'}</p>}
              {queueStatus === 'error' && <Button variant="outline" size="sm" type="button" onClick={onRefreshQueues}>ตรวจคิวอีกครั้ง</Button>}
            </div>
          </div>

          {/* Action */}
          <div className="xl:pl-2">
            <Button 
              className="w-full xl:w-auto h-11 px-8 bg-accent hover:bg-accent/90 text-sm font-bold shadow shadow-accent/20 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
              onClick={onCreate}
              disabled={isProcessing || selectedCount === 0 || !vehicleId || !driverId || queueStatus !== 'ready'}
            >
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Navigation className="mr-2 h-4 w-4" />
              )}
              {selectedCount === 0 && mode === 'manual' ? "กรุณาเลือกจุดบน Map" : hasQueueConflict ? "ปรับคิวเฉพาะวันนี้" : endDate && endDate > startDate ? "สร้างคิวต่อเนื่อง" : "สร้างเที่ยววิ่ง"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
