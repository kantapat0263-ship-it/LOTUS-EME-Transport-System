
"use client"

import * as React from "react"
import { Search, Filter, Calendar as CalendarIcon, MapPin, Truck, ChevronRight, FileText, Download, Loader2, Printer, Trash2, Phone, Edit, Plus, AlertTriangle, Save, X } from "lucide-react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, query, orderBy, doc, updateDoc, serverTimestamp, deleteDoc, addDoc, where } from "firebase/firestore"
import { Trip, TripStatus, UserProfile, Driver, Vehicle, Site, TripStop } from "@/types/models"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"

// Helper to format date YYYY-MM-DD to DD/MM/YYYY
function formatDateDisplay(dateStr: string) {
  if (!dateStr) return "-";
  if (dateStr.includes('-')) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

export default function TripHistoryPage() {
  const router = useRouter()
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()
  
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile } = useDoc<UserProfile>(userProfileRef)
  
  const isViewer = profile?.role === 'viewer'
  const isAdmin = profile?.role === 'admin'
  const isStaff = profile?.role === 'admin' || profile?.role === 'dispatcher'

  const [searchTerm, setSearchTerm] = React.useState("")
  const [selectedStatus, setSelectedStatus] = React.useState("all")
  
  // Initialize selectedDate to today's date in YYYY-MM-DD format
  const [selectedDate, setSelectedDate] = React.useState(() => {
    const today = new Date();
    // Use local time, not UTC, to avoid timezone offset issues
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  const [selectedTrip, setSelectedTrip] = React.useState<Trip | null>(null)
  const [isWorksheetOpen, setIsWorksheetOpen] = React.useState(false)

  const [tripToDelete, setTripToDelete] = React.useState<any | null>(null)
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false)

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = React.useState(false)

  // Edit Trip States
  const [isEditOpen, setIsEditOpen] = React.useState(false)
  const [editingTrip, setEditingTrip] = React.useState<Trip | null>(null)
  const [editFormData, setEditFormData] = React.useState<{
    vehicleId: string;
    driverId: string;
    stops: TripStop[];
    note: string;
  }>({
    vehicleId: "",
    driverId: "",
    stops: [],
    note: ""
  })

  const tripsRef = useMemoFirebase(() => query(collection(db, "trips"), orderBy("createdAt", "desc")), [db])
  const { data: trips, isLoading } = useCollection<Trip>(tripsRef)

  const driversRef = useMemoFirebase(() => collection(db, "drivers"), [db])
  const { data: drivers } = useCollection<Driver>(driversRef)

  const vehiclesRef = useMemoFirebase(() => collection(db, "vehicles"), [db])
  const { data: vehicles } = useCollection<Vehicle>(vehiclesRef)

  const sitesRef = useMemoFirebase(() => collection(db, "sites"), [db])
  const { data: sites } = useCollection<Site>(sitesRef)

  const getDisplayStatus = (trip: any): TripStatus => {
    if (trip.status === 'Cancelled') return 'Cancelled'
    const today = new Date().toISOString().split('T')[0]
    const tripDate = trip.tripDate || ""
    if (tripDate < today) return 'Completed'
    if (tripDate === today) return 'In Progress'
    return 'Planned'
  }

  const filteredTrips = React.useMemo(() => {
    return (trips || []).filter(trip => {
      // 1. Role-based Visibility Filter
      if (isViewer) {
        const userEmail = user?.email;
        const userName = profile?.name;
        
        const isOwner = 
          trip.requestedBy === userEmail || 
          (trip as any).requestedByEmail === userEmail ||
          (trip as any).requesterEmail === userEmail ||
          (trip as any).requestedBy === userName ||
          (trip as any).userId === user?.uid ||
          trip.stops?.some((s: any) => 
            s.requestedBy === userEmail || 
            s.requestedBy === userName
          );
          
        if (!isOwner) return false;
      }

      // 2. Search, Status, and Date Filters
      const matchSearch = !searchTerm || 
        (trip.tripId || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (trip.driverName || "").toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchStatus = !selectedStatus || selectedStatus === 'all' || 
        trip.status === selectedStatus
        
      const matchDate = !selectedDate || trip.tripDate === selectedDate
      
      return matchSearch && matchStatus && matchDate
    })
  }, [trips, isViewer, user, profile, searchTerm, selectedStatus, selectedDate]);

  const handleStatusChange = async (tripId: string, newStatus: TripStatus) => {
    if (isViewer) return
    const tripRef = doc(db, "trips", tripId)
    await updateDoc(tripRef, { 
      status: newStatus,
      updatedAt: serverTimestamp()
    })
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus} แล้ว` })
  }

  const handleOpenEdit = (trip: Trip) => {
    if (isViewer) return
    
    const canEdit = isAdmin || (profile?.role === 'dispatcher' && (trip.status === 'Planned' || trip.status === 'In Progress'))
    if (!canEdit) {
      toast({ title: "สิทธิ์ไม่เพียงพอ", description: "ไม่สามารถแก้ไขเที่ยววิ่งที่เสร็จสิ้นหรือยกเลิกแล้วได้", variant: "destructive" })
      return
    }

    if (trip.status === 'Completed' && !confirm("เที่ยววิ่งนี้เสร็จสิ้นแล้ว ต้องการแก้ไขจริงหรือไม่?")) {
      return
    }

    setEditingTrip(trip)
    setEditFormData({
      vehicleId: trip.vehicleId,
      driverId: trip.driverId,
      stops: [...trip.stops],
      note: ""
    })
    setIsEditOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editingTrip || !user) return
    if (!editFormData.note.trim()) {
      toast({ title: "กรุณาระบุหมายเหตุ", description: "ต้องระบุเหตุผลในการแก้ไขเพื่อบันทึกประวัติ", variant: "destructive" })
      return
    }

    try {
      const tripRef = doc(db, "trips", editingTrip.id)
      const selectedVehicle = vehicles?.find(v => v.id === editFormData.vehicleId)
      const selectedDriver = drivers?.find(d => d.id === editFormData.driverId)

      const changes: any = {}
      if (editingTrip.vehicleId !== editFormData.vehicleId) {
        changes.vehicle = { from: editingTrip.vehiclePlate, to: selectedVehicle?.licensePlate || "" }
      }
      if (editingTrip.driverId !== editFormData.driverId) {
        changes.driver = { from: editingTrip.driverName, to: selectedDriver?.name || "" }
      }

      const oldStops = editingTrip.stops.map(s => s.siteName)
      const nStops = editFormData.stops.map(s => s.siteName)
      
      const added = nStops.filter(s => !oldStops.includes(s))
      const removed = oldStops.filter(s => !nStops.includes(s))
      
      if (added.length > 0) changes.stopsAdded = added
      if (removed.length > 0) changes.stopsRemoved = removed
      
      const cargoChanged = JSON.stringify(editingTrip.stops.map(s => s.cargoDetails)) !== JSON.stringify(editFormData.stops.map(s => s.cargoDetails))
      if (cargoChanged) changes.cargoChanged = true

      // Update Trip
      await updateDoc(tripRef, {
        vehicleId: editFormData.vehicleId,
        vehiclePlate: selectedVehicle?.licensePlate || "",
        driverId: editFormData.driverId,
        driverName: selectedDriver?.name || "",
        stops: editFormData.stops.map((s, idx) => ({ ...s, order: idx })),
        updatedAt: serverTimestamp()
      })

      // Add Log
      const logRef = collection(db, "trips", editingTrip.id, "editLogs")
      await addDoc(logRef, {
        editedAt: serverTimestamp(),
        editedBy: user.email,
        note: editFormData.note,
        changes
      })

      toast({ title: "แก้ไขสำเร็จ", description: `อัปเดตข้อมูลเที่ยววิ่ง ${editingTrip.tripId} เรียบร้อยแล้ว` })
      setIsEditOpen(false)
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถบันทึกการแก้ไขได้", variant: "destructive" })
    }
  }

  const initiateDelete = (trip: any) => {
    if (isViewer) return
    setTripToDelete(trip)
    setIsDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!tripToDelete) return
    try {
      await deleteDoc(doc(db, "trips", tripToDelete.id))
      toast({ title: "ลบสำเร็จ", description: `ลบเที่ยววิ่ง ${tripToDelete.tripId || tripToDelete.id} เรียบร้อยแล้ว` })
      setIsDeleteOpen(false)
      setTripToDelete(null)
      const newSelection = new Set(selectedIds)
      newSelection.delete(tripToDelete.id)
      setSelectedIds(newSelection)
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถลบข้อมูลได้", variant: "destructive" })
    }
  }

  const toggleSelect = (id: string) => {
    const newSelection = new Set(selectedIds)
    if (newSelection.has(id)) {
      newSelection.delete(id)
    } else {
      newSelection.add(id)
    }
    setSelectedIds(newSelection)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTrips.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredTrips.map(t => t.id)))
    }
  }

  const confirmBulkDelete = async () => {
    try {
      const promises = Array.from(selectedIds).map(id => deleteDoc(doc(db, "trips", id)))
      await Promise.all(promises)
      toast({ title: "ลบสำเร็จ", description: `ลบทั้งหมด ${selectedIds.size} รายการเรียบร้อยแล้ว` })
      setSelectedIds(new Set())
      setIsBulkDeleteOpen(false)
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถลบบางรายการได้", variant: "destructive" })
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

  const getDriverPhone = (driverId: string) => {
    const driver = drivers?.find(d => d.id === driverId);
    return driver?.phoneNumber || "ไม่มีข้อมูลเบอร์ติดต่อ";
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">ประวัติการส่งของ</h2>
          <p className="text-sm md:text-base text-muted-foreground">
            {isViewer ? 'รายการเที่ยววิ่งที่คุณมีส่วนเกี่ยวข้อง' : 'รายการเที่ยววิ่งทั้งหมดและการติดตามสถานะ'}
          </p>
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
              <input 
                placeholder="ค้นหา Trip ID, คนขับ..." 
                className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="h-10">
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
              <Popover>
                <PopoverTrigger asChild>
                  <div className="flex w-full relative">
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full h-11 md:h-10 justify-start text-left font-normal bg-background pr-10",
                        !selectedDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 text-accent" />
                      {selectedDate ? formatDateDisplay(selectedDate) : <span>เลือกวันที่ (ทั้งหมด)</span>}
                    </Button>
                    {selectedDate && (
                      <div 
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 cursor-pointer hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground z-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDate("");
                        }}
                      >
                        <X className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate ? new Date(selectedDate + 'T00:00:00') : undefined}
                    onSelect={(date) => setSelectedDate(date ? format(date, "yyyy-MM-dd") : "")}
                    weekStartsOn={0}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="outline" className="w-full h-10">
              <Filter className="mr-2 h-4 w-4" /> กรองเพิ่มเติม
            </Button>
          </div>
        </CardContent>
      </Card>

      {!isStaff ? null : filteredTrips.length > 0 && (
        <div className="flex items-center justify-between bg-secondary/20 p-3 px-4 rounded-xl border border-dashed border-accent/20">
          <div className="flex items-center gap-3">
            <Checkbox 
              id="select-all"
              checked={selectedIds.size === filteredTrips.length && filteredTrips.length > 0}
              onCheckedChange={toggleSelectAll}
            />
            <label htmlFor="select-all" className="text-xs md:text-sm font-semibold cursor-pointer select-none">
              เลือกทั้งหมด ({selectedIds.size} รายการ)
            </label>
          </div>
          {selectedIds.size > 0 && (
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={() => setIsBulkDeleteOpen(true)}
              className="h-8 md:h-9 px-4 animate-in zoom-in duration-200"
            >
              <Trash2 className="mr-2 h-4 w-4" /> ลบที่เลือก
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
        ) : filteredTrips.length === 0 ? (
          <div className="text-center p-12 text-muted-foreground bg-secondary/20 rounded-xl border border-dashed text-sm">
            ไม่พบรายการเที่ยววิ่ง
          </div>
        ) : filteredTrips.map((trip) => (
          <Card key={trip.id} className={cn(
            "hover:border-accent/30 transition-all cursor-pointer overflow-hidden group relative",
            selectedIds.has(trip.id) && "border-accent bg-accent/5"
          )} onClick={() => router.push(`/trips/history/${trip.id}`)}>
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center p-4 gap-4">
              
              <div className="flex items-center gap-4 w-full lg:w-auto">
                {isStaff && (
                  <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox 
                      checked={selectedIds.has(trip.id)}
                      onCheckedChange={() => toggleSelect(trip.id)}
                    />
                  </div>
                )}
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <Truck className="h-5 w-5 md:h-6 md:w-6 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-base md:text-lg truncate">{trip.tripId || "ID Error"}</span>
                    {!isStaff ? (
                      <Badge className={cn("text-[10px] h-5", getStatusColor(getDisplayStatus(trip)))}>
                        {getDisplayStatus(trip)}
                      </Badge>
                    ) : (
                      <div onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Badge className={cn("cursor-pointer text-[10px] h-5", getStatusColor(getDisplayStatus(trip)))}>
                              {getDisplayStatus(trip)}
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
                    )}
                  </div>
                  <p className="text-[10px] md:text-xs text-muted-foreground truncate">{formatDateDisplay(trip.tripDate)} • {trip.stops?.[trip.stops.length - 1]?.siteName || "No stops"}</p>
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
                  className="hover:bg-accent/10 hover:text-accent h-9 px-3"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTrip(trip);
                    setIsWorksheetOpen(true);
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" /> ใบงาน
                </Button>
                
                {isStaff && (
                  <>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-9 w-9 text-muted-foreground hover:text-accent hover:bg-accent/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEdit(trip);
                      }}
                    >
                      <Edit className="h-5 w-5" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        initiateDelete(trip);
                      }}
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  </>
                )}
                
                <div className="flex items-center justify-center h-9 w-9">
                  <ChevronRight className="h-6 w-6 text-muted-foreground group-hover:text-accent group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Edit Trip Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-[95%] sm:max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-accent" /> แก้ไขเที่ยววิ่ง {editingTrip?.tripId}
            </DialogTitle>
            <DialogDescription>
              ปรับปรุงข้อมูลรถ คนขับ หรือจุดส่งของ พร้อมบันทึกเหตุผลการแก้ไข
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>เปลี่ยนรถ</Label>
                <Select 
                  value={editFormData.vehicleId} 
                  onValueChange={(val) => setEditFormData({...editFormData, vehicleId: val})}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {vehicles?.map(v => <SelectItem key={v.id} value={v.id}>{v.licensePlate} ({v.type})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>เปลี่ยนคนขับ</Label>
                <Select 
                  value={editFormData.driverId} 
                  onValueChange={(val) => setEditFormData({...editFormData, driverId: val})}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {drivers?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-bold">จัดการจุดส่งของ</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 border-accent text-accent">
                      <Plus className="mr-2 h-4 w-4" /> เพิ่มจุดแวะ
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-60 overflow-y-auto">
                    {sites?.map(site => (
                      <DropdownMenuItem key={site.id} onClick={() => {
                        setEditFormData({
                          ...editFormData,
                          stops: [...editFormData.stops, { siteId: site.id, siteName: site.name, order: editFormData.stops.length, cargoDetails: "" }]
                        })
                      }}>
                        {site.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="space-y-3">
                {editFormData.stops.map((stop, idx) => (
                  <div key={idx} className="flex gap-3 p-3 bg-secondary/20 rounded-lg border border-border/50">
                    <div className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs font-bold shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 space-y-2">
                      <p className="font-bold text-sm text-accent">{stop.siteName}</p>
                      <Textarea 
                        placeholder="รายละเอียดสินค้า..." 
                        className="text-xs min-h-[60px]"
                        value={stop.cargoDetails}
                        onChange={(e) => {
                          const newStops = [...editFormData.stops]
                          newStops[idx].cargoDetails = e.target.value
                          setEditFormData({...editFormData, stops: newStops})
                        }}
                      />
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-muted-foreground hover:text-destructive h-8 w-8"
                      onClick={() => {
                        const newStops = editFormData.stops.filter((_, i) => i !== idx)
                        setEditFormData({...editFormData, stops: newStops})
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-destructive">หมายเหตุการแก้ไข *</Label>
              <Textarea 
                placeholder="เช่น เปลี่ยนรถเพราะรถเสีย, เพิ่มจุดส่งตามที่แจ้งเพิ่ม"
                className="bg-destructive/5 border-destructive/20"
                value={editFormData.note}
                onChange={(e) => setEditFormData({...editFormData, note: e.target.value})}
              />
            </div>
          </div>

          <DialogFooter className="flex flex-row gap-2 mt-4">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setIsEditOpen(false)}>ยกเลิก</Button>
            <Button className="flex-1 h-11 bg-accent" onClick={handleSaveEdit}>
              <Save className="mr-2 h-4 w-4" /> บันทึกการแก้ไข
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-xl w-[95%]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> ยืนยันการลบเที่ยววิ่ง
            </DialogTitle>
            <DialogDescription className="pt-2">
              คุณต้องการลบเที่ยววิ่ง <span className="font-bold text-foreground">{tripToDelete?.tripId || tripToDelete?.id}</span> ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row gap-2 mt-4">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setIsDeleteOpen(false)}>ยกเลิก</Button>
            <Button variant="destructive" className="flex-1 h-11" onClick={confirmDelete}>ยืนยันลบ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-xl w-[95%]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> ยืนยันการลบหลายรายการ
            </DialogTitle>
            <DialogDescription className="pt-2">
              คุณต้องการลบเที่ยววิ่งที่เลือกทั้งหมด <span className="font-bold text-foreground">{selectedIds.size} รายการ</span> ใช่หรือไม่? ข้อมูลทั้งหมดจะถูกลบออกจากระบบอย่างถาวร
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row gap-2 mt-4">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setIsBulkDeleteOpen(false)}>ยกเลิก</Button>
            <Button variant="destructive" className="flex-1 h-11" onClick={confirmBulkDelete}>ยืนยันลบ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isWorksheetOpen} onOpenChange={setIsWorksheetOpen}>
        <DialogContent className="max-w-[95%] sm:max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader className="sr-only">
            <DialogTitle>ใบงานการขนส่ง (Delivery Worksheet)</DialogTitle>
            <DialogDescription>
              รายละเอียดสำหรับ Trip ID: {selectedTrip?.tripId}
            </DialogDescription>
          </DialogHeader>
          <div id="worksheet-content" className="p-2 md:p-4 bg-white text-black rounded-lg">
            <div className="flex flex-col sm:flex-row justify-between items-start border-b-2 border-black pb-4 mb-6 gap-2">
              <div>
                <h1 className="text-xl md:text-2xl font-bold uppercase">LOTUS GROUP Delivery</h1>
                <p className="text-[10px] md:sm">ใบกำกับการขนส่งวัสดุและสินค้า</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="font-bold text-sm md:text-base">Trip ID: {selectedTrip?.tripId}</p>
                <p className="text-[10px] md:sm">วันที่: {formatDateDisplay(selectedTrip?.tripDate || "")}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8 mb-8">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase text-gray-500">ข้อมูลคนขับ</p>
                <p className="text-base md:text-lg font-bold">{selectedTrip?.driverName}</p>
                <div className="flex items-center gap-1.5 text-xs text-gray-600">
                  <Phone className="h-3 w-3" />
                  <span>เบอร์ติดต่อ: {selectedTrip ? getDriverPhone(selectedTrip.driverId) : ""}</span>
                </div>
              </div>
              <div className="space-y-1 text-left sm:text-right">
                <p className="text-[10px] font-bold uppercase text-gray-500">ข้อมูลยานพาหนะ</p>
                <p className="text-base md:text-lg font-bold">ทะเบียน: {selectedTrip?.vehiclePlate}</p>
              </div>
            </div>
            <div className="border-t border-b border-black py-4 mb-6">
              <h3 className="font-bold text-sm md:text-base mb-4">ลำดับการส่งของ</h3>
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
