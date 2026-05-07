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
import { Truck, User, Navigation, Loader2 } from "lucide-react"

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
  isProcessing
}: TripControlPanelProps) {
  return (
    <Card className="fixed bottom-6 left-4 right-4 lg:left-[17rem] lg:right-8 z-30 shadow-2xl border-accent/40 bg-card/95 backdrop-blur-md">
      <CardContent className="p-6">
        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-6">
          {/* Summary */}
          <div className="flex items-center gap-4 min-w-[200px] border-b xl:border-b-0 xl:border-r border-border/50 pb-4 xl:pb-0 xl:pr-6">
            <div className="w-14 h-14 rounded-full bg-accent flex items-center justify-center font-black text-2xl text-white shadow-lg shadow-accent/20">
              {selectedCount}
            </div>
            <div>
              <p className="text-base font-bold text-muted-foreground uppercase tracking-wider">จุดหมายที่เลือก</p>
              <p className="text-2xl font-black text-white">เที่ยววิ่งใหม่</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-black text-accent flex items-center gap-1.5 uppercase">
                <Truck className="h-4 w-4" /> เลือกรถที่จะใช้
              </label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger className="h-14 text-xl font-bold border-2">
                  <SelectValue placeholder="ค้นหาทะเบียนรถ..." />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => (
                    <SelectItem key={v.id} value={v.id} className="text-lg py-3">
                      {v.licensePlate} ({v.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-black text-accent flex items-center gap-1.5 uppercase">
                <User className="h-4 w-4" /> เลือกคนขับรถ
              </label>
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger className="h-14 text-xl font-bold border-2">
                  <SelectValue placeholder="ค้นหาชื่อคนขับ..." />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map(d => (
                    <SelectItem key={d.id} value={d.id} className="text-lg py-3">
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Action */}
          <div className="xl:pl-6">
            <Button 
              className="w-full xl:w-auto h-16 px-12 bg-accent hover:bg-accent/90 text-2xl font-black shadow-xl shadow-accent/20 transition-all hover:scale-105"
              onClick={onCreate}
              disabled={isProcessing || selectedCount === 0 || !vehicleId || !driverId}
            >
              {isProcessing ? (
                <Loader2 className="mr-2 h-6 w-6 animate-spin" />
              ) : (
                <Navigation className="mr-3 h-7 w-7" />
              )}
              สร้างเที่ยววิ่ง
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
