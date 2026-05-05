
"use client"

import * as React from "react"
import { Search, Filter, Calendar, MapPin, Truck, ChevronRight, FileText, Download, Loader2, Printer, MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { collection, query, orderBy, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { Trip, TripStatus } from "@/types/models"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"

export default function TripHistoryPage() {
  const router = useRouter()
  const db = useFirestore()
  const [searchTerm, setSearchTerm] = React.useState("")
  const [selectedStatus, setSelectedStatus] = React.useState("all")
  const [selectedTrip, setSelectedTrip] = React.useState<Trip | null>(null)
  const [isWorksheetOpen, setIsWorksheetOpen] = React.useState(false)

  const tripsRef = useMemoFirebase(() => query(collection(db, "trips"), orderBy("createdAt", "desc")), [db])
  const { data: trips, isLoading } = useCollection<any>(tripsRef)

  const filteredTrips = trips?.filter(trip => {
    const matchesSearch = trip.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          trip.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          trip.vehiclePlate.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = selectedStatus === "all" || trip.status === selectedStatus
    return matchesSearch && matchesStatus
  }) || []

  const handleStatusChange = async (tripId: string, newStatus: TripStatus) => {
    const tripRef = doc(db, "trips", tripId)
    await updateDoc(tripRef, { 
      status: newStatus,
      updatedAt: serverTimestamp()
    })
  }

  const handlePrint = () => {
    window.print()
  }

  const getStatusColor = (status: TripStatus) => {
    switch (status) {
      case 'Completed': return 'bg-green-500 hover:bg-green-600 text-white';
      case 'In Progress': return 'bg-blue-500 hover:bg-blue-600 text-white';
      case 'Planned': return 'bg-orange-500 hover:bg-orange-600 text-white';
      case 'Cancelled': return 'bg-destructive text-white';
      default: return '';
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">ประวัติการส่งของ</h2>
          <p className="text-muted-foreground">รายการเที่ยววิ่งทั้งหมดและการติดตามสถานะ</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหา Trip ID, คนขับ..." 
                className="pl-10" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="สถานะทั้งหมด" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">สถานะทั้งหมด</SelectItem>
                <SelectItem value="Planned">Planned</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input type="date" className="pl-10" />
            </div>
            <Button variant="outline" className="w-full">
              <Filter className="mr-2 h-4 w-4" /> กรองเพิ่มเติม
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
        ) : filteredTrips.length === 0 ? (
          <div className="text-center p-12 text-muted-foreground bg-secondary/20 rounded-xl border border-dashed">
            ไม่พบรายการเที่ยววิ่ง
          </div>
        ) : filteredTrips.map((trip) => (
          <Card key={trip.id} className="hover:border-accent/30 transition-all cursor-pointer overflow-hidden group">
            <div className="flex flex-col md:flex-row items-center p-4 gap-4">
              <div className="flex items-center gap-4 w-full md:w-auto">
                <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center">
                  <Truck className="h-6 w-6 text-accent" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">{trip.id}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Badge className={cn("cursor-pointer", getStatusColor(trip.status))}>
                          {trip.status}
                        </Badge>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleStatusChange(trip.id, 'Planned')}>Planned</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusChange(trip.id, 'In Progress')}>In Progress</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusChange(trip.id, 'Completed')}>Completed</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusChange(trip.id, 'Cancelled')}>Cancelled</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="text-xs text-muted-foreground">{trip.tripDate} • {trip.stops?.[trip.stops.length - 1]?.siteName || "No stops"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-8 flex-1 w-full md:w-auto">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">คนขับ</p>
                  <p className="text-sm font-medium">{trip.driverName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">พาหนะ</p>
                  <p className="text-sm font-medium">{trip.vehiclePlate}</p>
                </div>
                <div className="hidden md:block">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">ระยะทาง / จุดส่ง</p>
                  <p className="text-sm font-medium">{trip.totalDistanceKm?.toFixed(1) || 0} กม. / {trip.stops?.length || 0} จุด</p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="hidden sm:flex hover:bg-accent/10 hover:text-accent"
                  onClick={() => {
                    setSelectedTrip(trip);
                    setIsWorksheetOpen(true);
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" /> ใบงาน
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="group-hover:translate-x-1 transition-transform"
                  onClick={() => router.push(`/trips/history/${trip.id}`)}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Worksheet Dialog */}
      <Dialog open={isWorksheetOpen} onOpenChange={setIsWorksheetOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>ใบงานการขนส่ง (Delivery Worksheet)</DialogTitle>
            <DialogDescription>
              รายละเอียดและใบกำกับการขนส่งสำหรับ Trip ID: {selectedTrip?.id}
            </DialogDescription>
          </DialogHeader>
          <div id="worksheet-content" className="p-4 bg-white text-black rounded-lg">
            <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-6">
              <div>
                <h1 className="text-2xl font-bold uppercase">LOTUS EME Delivery Worksheet</h1>
                <p className="text-sm">ใบกำกับการขนส่งวัสดุและสินค้า</p>
              </div>
              <div className="text-right">
                <p className="font-bold">Trip ID: {selectedTrip?.id}</p>
                <p className="text-sm">วันที่: {selectedTrip?.tripDate}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8 mb-8">
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase text-gray-500">ข้อมูลคนขับ</p>
                <p className="text-lg font-bold">{selectedTrip?.driverName}</p>
                <p className="text-sm">พนักงานขับรถขนส่งประจำหน่วยงาน</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-xs font-bold uppercase text-gray-500">ข้อมูลยานพาหนะ</p>
                <p className="text-lg font-bold">ทะเบียน: {selectedTrip?.vehiclePlate}</p>
                <p className="text-sm">ประเภท: {selectedTrip?.vehiclePlate ? "รถกระบะ/รถบรรทุก" : "-"}</p>
              </div>
            </div>

            <div className="border-t border-b border-black py-4 mb-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <MapPin className="h-4 w-4" /> ลำดับการส่งของ (Delivery Sequence)
              </h3>
              <div className="space-y-6">
                {selectedTrip?.stops?.map((stop: any, idx: number) => (
                  <div key={idx} className="flex gap-4 border-l-2 border-dashed border-gray-300 pl-4 relative">
                    <div className="absolute -left-[11px] top-0 w-5 h-5 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <p className="font-bold text-lg">{stop.siteName}</p>
                        <Badge variant="outline" className="text-black border-black">ยังไม่ได้ลงของ</Badge>
                      </div>
                      <div className="mt-2 bg-gray-50 p-3 rounded border border-gray-200">
                        <p className="text-xs font-bold uppercase text-gray-500 mb-1">รายการสินค้า (Cargo Details):</p>
                        <p className="text-sm whitespace-pre-wrap">{stop.cargoDetails || "ไม่มีรายละเอียดสินค้า"}</p>
                      </div>
                      <div className="mt-4 flex gap-8">
                        <div className="flex-1 border-t border-gray-300 pt-2">
                          <p className="text-[10px] text-gray-400 uppercase">ลายเซ็นผู้รับ (Recipient Signature)</p>
                          <div className="h-10"></div>
                        </div>
                        <div className="flex-1 border-t border-gray-300 pt-2">
                          <p className="text-[10px] text-gray-400 uppercase">วัน/เวลา ที่รับ (Timestamp)</p>
                          <div className="h-10"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-100 p-4 rounded mb-6">
              <div className="flex justify-between border-r pr-4 border-gray-300">
                <span className="text-gray-500">ระยะทางรวมประมาณการ:</span>
                <span className="font-bold">{selectedTrip?.totalDistanceKm?.toFixed(1)} กม.</span>
              </div>
              <div className="flex justify-between pl-4">
                <span className="text-gray-500">เวลาเดินทางประมาณการ:</span>
                <span className="font-bold">{Math.floor((selectedTrip?.totalEstimatedTimeMinutes || 0) / 60)} ชม. {(selectedTrip?.totalEstimatedTimeMinutes || 0) % 60} นาที</span>
              </div>
            </div>

            <div className="text-[10px] text-gray-400 text-center mt-12 border-t pt-4">
              เอกสารนี้สร้างโดยระบบ LOTUS EME Transport System • พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}
            </div>
          </div>
          <DialogFooter className="flex justify-between w-full sm:justify-between items-center print:hidden">
            <p className="text-xs text-muted-foreground italic">* กรุณาพิมพ์เอกสารนี้ให้คนขับรถทุกครั้งก่อนออกเดินทาง</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsWorksheetOpen(false)}>ปิดหน้าต่าง</Button>
              <Button className="bg-accent hover:bg-accent/90" onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" /> พิมพ์ใบงาน
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
