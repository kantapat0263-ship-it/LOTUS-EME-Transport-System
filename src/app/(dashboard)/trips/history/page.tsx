
"use client"

import * as React from "react"
import { Search, Filter, Calendar, MapPin, Truck, ChevronRight, FileText, Download, Loader2, Printer, Trash2 } from "lucide-react"
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
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, query, orderBy, doc, updateDoc, serverTimestamp, deleteDoc } from "firebase/firestore"
import { Trip, TripStatus, UserProfile } from "@/types/models"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

export default function TripHistoryPage() {
  const router = useRouter()
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile } = useDoc<UserProfile>(userProfileRef)
  
  const isViewer = profile?.role === 'viewer'

  const [searchTerm, setSearchTerm] = React.useState("")
  const [selectedStatus, setSelectedStatus] = React.useState("all")
  const [selectedTrip, setSelectedTrip] = React.useState<any | null>(null)
  const [isWorksheetOpen, setIsWorksheetOpen] = React.useState(false)

  const tripsRef = useMemoFirebase(() => query(collection(db, "trips"), orderBy("createdAt", "desc")), [db])
  const { data: trips, isLoading } = useCollection<any>(tripsRef)

  const filteredTrips = trips?.filter(trip => {
    const searchStr = (trip.tripId || trip.id || "").toLowerCase();
    const driverStr = (trip.driverName || "").toLowerCase();
    const plateStr = (trip.vehiclePlate || "").toLowerCase();
    
    const matchesSearch = searchStr.includes(searchTerm.toLowerCase()) || 
                          driverStr.includes(searchTerm.toLowerCase()) ||
                          plateStr.includes(searchTerm.toLowerCase())
    const matchesStatus = selectedStatus === "all" || trip.status === selectedStatus
    return matchesSearch && matchesStatus
  }) || []

  const handleStatusChange = async (tripId: string, newStatus: TripStatus) => {
    if (isViewer) return
    const tripRef = doc(db, "trips", tripId)
    await updateDoc(tripRef, { 
      status: newStatus,
      updatedAt: serverTimestamp()
    })
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus} แล้ว` })
  }

  const handleDeleteTrip = async (tripId: string) => {
    if (isViewer) return
    if (confirm("คุณแน่ใจหรือไม่ว่าต้องการลบทริปนี้?")) {
      await deleteDoc(doc(db, "trips", tripId))
      toast({ title: "ลบทริปสำเร็จ" })
    }
  }

  const handleCleanup = async () => {
    if (isViewer) return
    const incomplete = trips?.filter(t => !t.tripId || t.stops?.length === 0 || !t.vehiclePlate);
    if (!incomplete || incomplete.length === 0) {
      toast({ title: "ไม่พบข้อมูลที่ไม่สมบูรณ์" });
      return;
    }
    
    if (confirm(`พบข้อมูลไม่สมบูรณ์ ${incomplete.length} รายการ ต้องการลบทั้งหมดหรือไม่?`)) {
      for (const t of incomplete) {
        await deleteDoc(doc(db, "trips", t.id));
      }
      toast({ title: `ลบข้อมูลไม่สมบูรณ์ ${incomplete.length} รายการเรียบร้อยแล้ว` });
    }
  }

  const getStatusColor = (status: TripStatus) => {
    switch (status) {
      case 'Completed': return 'bg-green-500 text-white hover:bg-green-600';
      case 'In Progress': return 'bg-blue-500 text-white hover:bg-blue-600';
      case 'Planned': return 'bg-orange-500 text-white hover:bg-orange-600';
      case 'Cancelled': return 'bg-destructive text-white hover:bg-destructive/90';
      default: return '';
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">ประวัติการส่งของ</h2>
          <p className="text-sm md:text-base text-muted-foreground">รายการเที่ยววิ่งทั้งหมดและการติดตามสถานะ</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isViewer && (
            <Button variant="outline" size="sm" onClick={handleCleanup} className="text-destructive border-destructive hover:bg-destructive/10 h-10 px-3 flex-1 sm:flex-none">
              <Trash2 className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">ลบรายการเสีย</span>
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-10 px-3 flex-1 sm:flex-none">
            <Download className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Export Excel</span>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหา Trip ID, คนขับ..." 
                className="pl-10 h-11 md:h-10" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="h-11 md:h-10">
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
              <Input type="date" className="pl-10 h-11 md:h-10" />
            </div>
            <Button variant="outline" className="w-full h-11 md:h-10">
              <Filter className="mr-2 h-4 w-4" /> กรองเพิ่มเติม
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
        ) : filteredTrips.length === 0 ? (
          <div className="text-center p-12 text-muted-foreground bg-secondary/20 rounded-xl border border-dashed text-sm">
            ไม่พบรายการเที่ยววิ่ง
          </div>
        ) : filteredTrips.map((trip) => (
          <Card key={trip.id} className="hover:border-accent/30 transition-all cursor-pointer overflow-hidden group">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center p-4 gap-4">
              <div className="flex items-center gap-4 w-full lg:w-auto">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <Truck className="h-5 w-5 md:h-6 md:w-6 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-base md:text-lg truncate">{trip.tripId || "ID Error"}</span>
                    {isViewer ? (
                      <Badge className={cn("text-[10px] h-5", getStatusColor(trip.status))}>
                        {trip.status}
                      </Badge>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Badge className={cn("cursor-pointer text-[10px] h-5", getStatusColor(trip.status))}>
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
                    )}
                  </div>
                  <p className="text-[10px] md:text-xs text-muted-foreground truncate">{trip.tripDate} • {trip.stops?.[trip.stops.length - 1]?.siteName || "No stops"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 lg:gap-8 flex-1 w-full lg:w-auto border-t lg:border-t-0 pt-4 lg:pt-0">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">คนขับ</p>
                  <p className="text-xs md:text-sm font-medium truncate">{trip.driverName || "-"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">พาหนะ</p>
                  <p className="text-xs md:text-sm font-medium truncate">{trip.vehiclePlate || "-"}</p>
                </div>
                <div className="hidden md:block">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">ระยะทาง / จุดส่ง</p>
                  <p className="text-xs md:text-sm font-medium">{trip.totalDistanceKm?.toFixed(1) || 0} กม. / {trip.stops?.length || 0} จุด</p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full lg:w-auto justify-end border-t lg:border-t-0 pt-3 lg:pt-0 mt-1 lg:mt-0">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="hover:bg-accent/10 hover:text-accent h-9 px-3 flex-1 sm:flex-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTrip(trip);
                    setIsWorksheetOpen(true);
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" /> ใบงาน
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 group-hover:translate-x-1 transition-transform"
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
        <DialogContent className="max-w-[95%] sm:max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader className="sr-only">
            <DialogTitle>ใบงานการขนส่ง (Delivery Worksheet)</DialogTitle>
            <DialogDescription>
              รายละเอียดและใบกำกับการขนส่งสำหรับ Trip ID: {selectedTrip?.tripId}
            </DialogDescription>
          </DialogHeader>
          <div id="worksheet-content" className="p-2 md:p-4 bg-white text-black rounded-lg">
            <div className="flex flex-col sm:flex-row justify-between items-start border-b-2 border-black pb-4 mb-6 gap-2">
              <div>
                <h1 className="text-xl md:text-2xl font-bold uppercase">LOTUS EME Delivery</h1>
                <p className="text-[10px] md:text-sm">ใบกำกับการขนส่งวัสดุและสินค้า</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="font-bold text-sm md:text-base">Trip ID: {selectedTrip?.tripId}</p>
                <p className="text-[10px] md:text-sm">วันที่: {selectedTrip?.tripDate}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8 mb-8">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase text-gray-500">ข้อมูลคนขับ</p>
                <p className="text-base md:text-lg font-bold">{selectedTrip?.driverName}</p>
              </div>
              <div className="space-y-1 text-left sm:text-right">
                <p className="text-[10px] font-bold uppercase text-gray-500">ข้อมูลยานพาหนะ</p>
                <p className="text-base md:text-lg font-bold">ทะเบียน: {selectedTrip?.vehiclePlate}</p>
              </div>
            </div>
            <div className="border-t border-b border-black py-4 mb-6">
              <h3 className="font-bold text-sm md:text-base mb-4">ลำดับการส่งของ (Delivery Sequence)</h3>
              <div className="space-y-6">
                {selectedTrip?.stops?.map((stop: any, idx: number) => (
                  <div key={idx} className="flex gap-4 border-l-2 border-dashed border-gray-300 pl-4 relative">
                    <div className="absolute -left-[11px] top-0 w-5 h-5 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-base md:text-lg">{stop.siteName}</p>
                      <p className="text-xs md:text-sm mt-1 whitespace-pre-wrap">{stop.cargoDetails}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="print:hidden flex flex-row gap-2 mt-4">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setIsWorksheetOpen(false)}>ปิด</Button>
            <Button className="bg-accent flex-1 h-11" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> พิมพ์</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
