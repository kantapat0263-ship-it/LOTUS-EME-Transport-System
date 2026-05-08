
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

interface TripControlPanelProps {
  selectedCount: number;
  vehicles: any[];
  drivers: any[];
  vehicleId: string;
  driverId: string;
  setVehicleId: (id: string) => void;
  setDriverId: (id: string) => void;
  onCreate: () => void;
  isProcessing: boolean;
  mode: 'auto' | 'manual';
}

export function TripControlPanel({
  selectedCount,
  vehicles,
  drivers,
  vehicleId,
  driverId,
  setVehicleId,
  setDriverId,
  onCreate,
  isProcessing,
  mode
}: TripControlPanelProps) {
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
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger className="h-10 text-sm font-medium">
                  <SelectValue placeholder="ค้นหาทะเบียนรถ..." />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => (
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
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger className="h-10 text-sm font-medium">
                  <SelectValue placeholder="ค้นหาชื่อคนขับ..." />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map(d => (
                    <SelectItem key={d.id} value={d.id} className="text-sm">
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Action */}
          <div className="xl:pl-2">
            <Button 
              className="w-full xl:w-auto h-11 px-8 bg-accent hover:bg-accent/90 text-sm font-bold shadow shadow-accent/20 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
              onClick={onCreate}
              disabled={isProcessing || selectedCount === 0 || !vehicleId || !driverId}
            >
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Navigation className="mr-2 h-4 w-4" />
              )}
              {selectedCount === 0 && mode === 'manual' ? "กรุณาเลือกจุดบน Map" : "สร้างเที่ยววิ่ง"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
