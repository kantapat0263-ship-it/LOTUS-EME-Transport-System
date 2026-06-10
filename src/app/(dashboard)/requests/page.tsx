"use client"

import * as React from "react"
import { RequestForm } from "@/components/requests/RequestForm"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  ClipboardList, 
  History, 
  Settings2, 
  Loader2, 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
  AlertCircle, 
  CheckCircle2, 
  XCircle,
  User as UserIcon,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Search,
  Truck,
  Check,
  Trash2,
  Edit,
  Plus,
  Building2,
  Eye,
  EyeOff,
  Store,
  Landmark,
  Briefcase,
  Lock,
  Phone,
  Info
} from "lucide-react"
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from "@/firebase"
import { doc, collection, query, updateDoc, serverTimestamp, getDocs, writeBatch, where, setDoc, onSnapshot } from "firebase/firestore"
import { UserProfile, Site } from "@/types/models"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader } from "@googlemaps/js-api-loader"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"

// Helper to format date YYYY-MM-DD to DD/MM/YYYY
function formatDateDisplay(dateStr: string) {
  if (!dateStr) return "";
  if (dateStr.includes('-')) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

const getStatusBadge = (status: string) => {
  const config: any = {
    'pending': { label: 'รอดำเนินการ', color: 'bg-orange-500', textColor: 'text-orange-500', dot: true },
    'in_progress': { label: 'กำลังดำเนินการ', color: 'bg-blue-500', textColor: 'text-blue-400', dot: true },
    'partial': { label: 'จัดบางส่วน', color: 'bg-blue-500', textColor: 'text-blue-400', dot: true },
    'approved': { label: '✅ จัดรถแล้ว', color: 'bg-green-500', textColor: 'text-green-500', dot: false },
    'rejected': { label: '❌ ปฏิเสธ', color: 'bg-red-500', textColor: 'text-red-500', dot: false },
    'rescheduled': { label: '📅 เลื่อนวันแล้ว', color: 'bg-blue-500', textColor: 'text-blue-400', dot: false },
    'cancelled': { label: 'ยกเลิกแล้ว', color: 'bg-gray-500', textColor: 'text-gray-400', dot: false },
  }

  const item = config[status] || { label: status, color: 'bg-gray-500', textColor: 'text-gray-400', dot: false }

  return (
    <Badge variant="outline" className={cn("gap-1.5", item.textColor, `border-border/50 bg-secondary/30`)}>
      {item.dot && (
        <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", item.color)} />
      )}
      {item.label}
    </Badge>
  )
}

function InlineRequestManager({ userRole, profileName }: { userRole?: string, profileName?: string }) {
  const { toast } = useToast()
  const db = useFirestore()
  const isStaff = userRole === 'admin' || userRole === 'dispatcher'
  
  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: companySettings } = useDoc<any>(settingsRef)

  const [showCancelled, setShowCancelled] = React.useState(false)
  const requestsRef = useMemoFirebase(() => query(
    collection(db, "vehicleRequests"), 
    where("status", "in", showCancelled 
      ? ["pending", "rescheduled", "partial", "in_progress", "cancelled"] 
      : ["pending", "rescheduled", "partial", "in_progress"])
  ), [db, showCancelled])

  const urgentRef = useMemoFirebase(() => query(
    collection(db, "urgentRequests"),
    where("status", "==", "pending")
  ), [db])
  const { data: urgentRequests } = useCollection<any>(urgentRef)

  const { data: rawRequests, isLoading } = useCollection<any>(requestsRef)

  const requests = React.useMemo(() => {
    if (!rawRequests) return [];
    return [...rawRequests].sort((a, b) => {
      const dateA = a.createdAt?.toDate() || new Date(0);
      const dateB = b.createdAt?.toDate() || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
  }, [rawRequests]);

  const [selectedReqId, setSelectedReqId] = React.useState<string | null>(null)
  const [isDetailOpen, setIsDetailOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [isProcessing, setIsStaffProcessing] = React.useState(false)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [isClearConfirmOpen, setIsClearConfirmOpen] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)
  const [selectedDestIndexes, setSelectedDestIndexes] = React.useState<Set<number>>(new Set())

  const [isRescheduleOpen, setIsRescheduleOpen] = React.useState(false)
  const [rescheduleDate, setRescheduleDate] = React.useState("")
  const [rescheduleNote, setRescheduleNote] = React.useState("")
  const [isRescheduling, setIsRescheduling] = React.useState(false)
  
  const [editingCoords, setEditingCoords] = React.useState<Record<number, string>>({})
  
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapInstanceRef = React.useRef<google.maps.Map | null>(null)
  const markersRef = React.useRef<google.maps.Marker[]>([])

  const [stopNotes, setStopNotes] = React.useState<Record<string, string>>({})
  const [isSavingNote, setIsSavingNote] = React.useState<number | null>(null)

  const selectedReq = React.useMemo(() => {
    if (!selectedReqId) return null
    return requests.find(r => r.id === selectedReqId) || null
  }, [selectedReqId, requests])

  // Look up related trip and driver info
  const relatedTripRef = useMemoFirebase(() => (db && selectedReq?.tripId) ? doc(db, "trips", selectedReq.tripId) : null, [db, selectedReq?.tripId])
  const { data: relatedTrip } = useDoc<any>(relatedTripRef)

  const relatedDriverRef = useMemoFirebase(() => (db && relatedTrip?.driverId) ? doc(db, "drivers", relatedTrip.driverId) : null, [db, relatedTrip?.driverId])
  const { data: relatedDriver } = useDoc<any>(relatedDriverRef)

  React.useEffect(() => {
    if (selectedReq) {
      const assigned = selectedReq.assignedDestinations || []
      const available = selectedReq.destinations
        .map((_: any, i: number) => i)
        .filter((i: number) => !assigned.includes(i))
      
      setSelectedDestIndexes(new Set(available))
      setStopNotes(selectedReq.stopNotes || {})
    }
  }, [selectedReqId, selectedReq])

  React.useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || companySettings?.googleMapsApiKeyReference;
    
    if (!isDetailOpen || !selectedReq || !apiKey) {
      if (markersRef.current) markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
      mapInstanceRef.current = null;
      return;
    }

    const initMap = async () => {
      if (!mapContainerRef.current) return;

      const loader = new Loader({
        apiKey: apiKey,
        version: "weekly",
        libraries: ["places", "geometry"]
      });

      try {
        await loader.load();
        const google = window.google;
        
        const newMap = new google.maps.Map(mapContainerRef.current!, {
          center: { lat: 13.7563, lng: 100.5018 },
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          styles: [
            { featureType: "landscape", elementType: "all", color: "#2d3139" },
            { featureType: "road", elementType: "all", color: "#1a1c23" },
            { featureType: "water", elementType: "all", color: "#172899" }
          ] as unknown as google.maps.MapTypeStyle[]
        });

        mapInstanceRef.current = newMap;
        
        const bounds = new google.maps.LatLngBounds();
        let hasCoords = false;

        selectedReq.destinations.forEach((dest: any, idx: number) => {
          if (dest.lat && dest.lng) {
            hasCoords = true;
            const pos = { lat: dest.lat, lng: dest.lng };
            bounds.extend(pos);

            const marker = new google.maps.Marker({
              position: pos,
              map: newMap,
              label: {
                text: (idx + 1).toString(),
                color: "#ffffff",
                fontWeight: "bold"
              },
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: dest.type === 'site' ? "#f59e0b" : "#9333ea",
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: "#ffffff"
              },
              title: dest.siteName
            });
            markersRef.current.push(marker);
          }
        });

        if (hasCoords) {
          newMap.fitBounds(bounds);
          google.maps.event.addListenerOnce(newMap, "idle", () => {
            google.maps.event.trigger(newMap, 'resize');
          });
        }
      } catch (err) {
        console.error("Map initialization failed", err);
      }
    };

    const timer = setTimeout(initMap, 300);
    return () => {
      clearTimeout(timer);
      if (markersRef.current) markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
    };
  }, [isDetailOpen, selectedReqId, companySettings?.googleMapsApiKeyReference]);

  const filteredRequests = requests?.filter(req => 
    req.requestId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    req.requestedBy.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  const toggleDest = (idx: number) => {
    const newSet = new Set(selectedDestIndexes);
    if (newSet.has(idx)) {
      newSet.delete(idx);
    } else {
      newSet.add(idx);
    }
    setSelectedDestIndexes(newSet);
  }

  const handleApproveUrgent = async (urgentId: string, requestedBy: string, requestedDate: string) => {
    try {
      await updateDoc(doc(db, "urgentRequests", urgentId), {
        status: "approved",
        approvedBy: profileName || "Dispatcher",
        approvedAt: serverTimestamp()
      })
      toast({ 
        title: "อนุมัติแล้ว", 
        description: `${requestedBy} สามารถขอรถวันที่ ${requestedDate} ได้แล้ว` 
      })
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    }
  }

  const handleRejectUrgent = async (urgentId: string, requestedBy: string) => {
    const reason = prompt(`เหตุผลที่ปฏิเสธคำขอของ ${requestedBy}:`)
    if (!reason) return
    try {
      await updateDoc(doc(db, "urgentRequests", urgentId), {
        status: "rejected",
        rejectReason: reason,
        rejectedBy: profileName || "Dispatcher",
        rejectedAt: serverTimestamp()
      })
      toast({ title: "ปฏิเสธแล้ว", description: `ปฏิเสธคำขอของ ${requestedBy} แล้ว` })
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    }
  }

  const handleSaveStopNote = async (stopIndex: number) => {
    if (!selectedReq) return
    setIsSavingNote(stopIndex)
    try {
      const noteKey = `stop_${stopIndex}`
      const noteValue = stopNotes[noteKey] || ""
      
      const vrRef = doc(db, 'vehicleRequests', selectedReq.id)
      const updateData = {
        [`stopNotes.${noteKey}`]: noteValue,
        [`stopNotesUpdatedBy`]: profileName || "Dispatcher",
        [`stopNotesUpdatedAt`]: new Date().toISOString()
      }
      await updateDoc(vrRef, updateData)

      if (selectedReq.tripId) {
        const tripRef = doc(db, "trips", selectedReq.tripId)
        await updateDoc(tripRef, {
          [`stopNotes.${noteKey}`]: noteValue
        })
      }

      toast({ title: "บันทึกแล้ว", description: `บันทึกหมายเหตุจุดที่ ${stopIndex + 1} เรียบร้อย` })
    } catch (e) {
      toast({ title: "ผิดพลาด", variant: "destructive" })
    } finally {
      setIsSavingNote(null)
    }
  }

  const handleSaveCoordinates = async (destIndex: number) => {
    if (!selectedReq) return
    const coordStr = editingCoords[destIndex] || ""
    if (!coordStr.trim()) {
      toast({ title: "กรุณาใส่พิกัด", variant: "destructive" })
      return
    }
    
    const [lat, lng] = coordStr.split(',').map(s => parseFloat(s.trim()))
    if (isNaN(lat) || isNaN(lng)) {
      toast({ title: "พิกัดไม่ถูกต้อง", description: "รูปแบบ: 14.0815, 100.7129", variant: "destructive" })
      return
    }

    try {
      const newDestinations = [...selectedReq.destinations]
      newDestinations[destIndex] = { 
        ...newDestinations[destIndex], 
        lat, 
        lng 
      }
      
      await updateDoc(doc(db, "vehicleRequests", selectedReq.id), {
        destinations: newDestinations,
        updatedAt: serverTimestamp()
      })

      // บันทึกลง /sites อัตโนมัติถ้าเป็น custom type
      if (newDestinations[destIndex].type === 'other') {
        const siteName = newDestinations[destIndex].siteName || newDestinations[destIndex].customName
        if (siteName) {
          const newSiteRef = doc(collection(db, "sites"))
          await setDoc(newSiteRef, {
            id: newSiteRef.id,
            name: siteName,
            address: "",
            latitude: lat,
            longitude: lng,
            projectTypeTag: "อื่น ๆ",
            status: "Active",
            isUserAdded: true,
            addedBy: "dispatcher",
            createdAt: serverTimestamp()
          })
        }
      }

      toast({ title: "บันทึกพิกัดสำเร็จ", description: `อัพเดทพิกัดจุดที่ ${destIndex + 1} แล้ว` })
      setEditingCoords(prev => {
        const next = { ...prev }
        delete next[destIndex]
        return next
      })
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    }
  }

  const handleAcknowledge = async () => {
    if (!selectedReq) return
    setIsStaffProcessing(true)
    try {
      const ref = doc(db, "vehicleRequests", selectedReq.id)
      await updateDoc(ref, {
        status: "in_progress",
        acknowledgedBy: profileName || "Dispatcher",
        acknowledgedAt: new Date().toISOString(),
        updatedAt: serverTimestamp()
      })
      toast({ title: "รับงานและกำลังดำเนินการ", description: `คำขอ ${selectedReq.requestId} เปลี่ยนสถานะเป็นกำลังดำเนินการแล้ว` })
      setIsDetailOpen(false)
      setSelectedReqId(null)
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    } finally {
      setIsStaffProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!selectedReq) return
    if (!rejectReason.trim()) {
      toast({ title: "ระบุเหตุผล", description: "กรุณาระบุเหตุผลที่ไม่นุมัติ", variant: "destructive" })
      return
    }

    setIsStaffProcessing(true)
    try {
      const ref = doc(db, "vehicleRequests", selectedReq.id)
      await updateDoc(ref, {
        status: "rejected",
        rejectReason,
        updatedAt: serverTimestamp()
      })
      toast({ title: "ดำเนินการสำเร็จ", description: `คำขอ ${selectedReq.requestId} ถูกปฏิเสธแล้ว` })
      setIsDetailOpen(false)
      setSelectedReqId(null)
      setRejectReason("")
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    } finally {
      setIsStaffProcessing(false)
    }
  }

  const handleReschedule = async () => {
    if (!selectedReq) return
    if (!rescheduleDate) {
      toast({ title: "กรุณาเลือกวันที่ใหม่", variant: "destructive" })
      return
    }
    if (!rescheduleNote.trim()) {
      toast({ title: "กรุณาใส่หมายเหตุการเลื่อนวัน", variant: "destructive" })
      return
    }
    setIsRescheduling(true)
    try {
      const ref = doc(db, "vehicleRequests", selectedReq.id)
      await updateDoc(ref, {
        requestDate: rescheduleDate,
        status: "rescheduled",
        rescheduleNote: rescheduleNote,
        rescheduledBy: profileName || "Dispatcher",
        rescheduledAt: new Date().toISOString(),
        updatedAt: serverTimestamp()
      })
      toast({ 
        title: "เลื่อนวันเรียบร้อย", 
        description: `คำขอ ${selectedReq.requestId} เลื่อนไปวันที่ ${rescheduleDate} แล้ว` 
      })
      setIsRescheduleOpen(false)
      setIsDetailOpen(false)
      setSelectedReqId(null)
      setRescheduleDate("")
      setRescheduleNote("")
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    } finally {
      setIsRescheduling(false)
    }
  }

  const handleClearAllData = async () => {
    if (userRole !== 'admin') return
    setIsClearing(true)
    try {
      const batch = writeBatch(db)
      const snapshot = await getDocs(collection(db, "vehicleRequests"))
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref)
      })
      await batch.commit()
      toast({ title: "ล้างข้อมูลสำเร็จ", description: "ลบข้อมูลคำขอใช้รถทั้งหมดเรียบร้อยแล้ว" })
      setIsClearConfirmOpen(false)
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถลบข้อมูลได้", variant: "destructive" })
    } finally {
      setIsClearing(false)
    }
  }

  const hasCoordinates = selectedReq?.destinations?.some((d: any) => d.lat && d.lng);

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {urgentRequests && urgentRequests.length > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 space-y-2">
          <p className="text-xs font-bold text-orange-400 flex items-center gap-2">
            🔔 คำขออนุมัติพิเศษ ({urgentRequests.length} รายการ)
          </p>
          {urgentRequests.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between bg-background/50 p-2 rounded-lg">
              <div>
                <p className="text-xs font-bold text-white">{u.requestedBy}</p>
                <p className="text-[10px] text-muted-foreground">ขอรถวันที่: {u.requestedDate}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => handleApproveUrgent(u.id, u.requestedBy, u.requestedDate)}
                >
                  ✅ อนุมัติ
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => handleRejectUrgent(u.id, u.requestedBy)}
                >
                  ❌ ปฏิเสธ
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="ค้นหาด้วยรหัส VR หรือชื่อผู้ขอ..." 
            className="pl-10 bg-secondary/20 h-11"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-4 bg-secondary/20 px-4 rounded-lg h-11">
          <Label htmlFor="show-cancelled" className="text-xs font-bold flex items-center gap-2 cursor-pointer">
            {showCancelled ? <Eye className="h-4 w-4 text-accent" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
            แสดงรายการที่ยกเลิก
          </Label>
          <Switch 
            id="show-cancelled"
            checked={showCancelled}
            onCheckedChange={setShowCancelled}
          />
        </div>
        {userRole === 'admin' && (
          <Button 
            variant="outline" 
            className="border-red-500/50 text-red-500 hover:bg-red-500/10 h-11"
            onClick={() => setIsClearConfirmOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" /> ล้างข้อมูลทั้งหมด
          </Button>
        )}
      </div>

      {filteredRequests.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRequests.map((req) => (
            <Card 
              key={req.id} 
              className={cn(
                "border-border/50 hover:border-accent/30 transition-all cursor-pointer group relative overflow-hidden",
                (req.status === "pending" || req.status === "in_progress" || req.status === "partial" || req.status === "rescheduled") && "border-accent/30 bg-accent/5 shadow-lg shadow-accent/5",
                req.status === "cancelled" && "opacity-50 grayscale-[0.5]"
              )}
              onClick={() => {
                setSelectedReqId(req.id)
                setIsDetailOpen(true)
              }}
            >
              {(req.status === "pending" || req.status === "in_progress" || req.status === "partial" || req.status === "rescheduled" || req.status === "cancelled") && (
                <div className={cn(
                  "absolute top-0 left-0 w-1 h-full", 
                  req.status === "partial" ? "bg-blue-500" : 
                  req.status === "cancelled" ? "bg-gray-500" : 
                  req.status === "in_progress" || req.status === "rescheduled" ? "bg-blue-500" : "bg-orange-500"
                )} />
              )}
              <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-accent">{req.requestId}</span>
                      {getStatusBadge(req.status)}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <UserIcon className="h-3 w-3" /> {req.requestedBy}
                      </div>
                      {req.requestedByPhone && (
                        <div className="flex items-center gap-2 text-xs text-orange-400 font-bold">
                          <Phone className="h-3 w-3" /> {req.requestedByPhone}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground flex flex-col">
                    <span className="font-bold text-foreground">{formatDateDisplay(req.requestDate)}</span>
                    <span>{req.requestTime} น.</span>
                  </div>
                </div>

                <div className="flex gap-2 items-center text-xs">
                  <MapPin className="h-3 w-3 text-accent shrink-0" />
                  <span className="truncate flex-1">{req.destinations[0]?.siteName}</span>
                  {req.destinations.length > 1 && (
                    <span className="text-muted-foreground text-[10px] shrink-0">(และอีก {req.destinations.length - 1} จุด)</span>
                  )}
                </div>

                <div className="flex justify-end pt-2 border-t border-border/20">
                  <span className="text-[10px] text-accent flex items-center group-hover:translate-x-1 transition-transform font-bold">
                    ดูรายละเอียดและจัดการ <ChevronRight className="h-3 w-3 ml-1" />
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground bg-secondary/10 rounded-xl border border-dashed">
          ไม่พบรายการคำขอใช้รถ
        </div>
      )}

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-accent" /> รายละเอียดคำขอ {selectedReq?.requestId}
            </DialogTitle>
            <DialogDescription>
              ตรวจสอบข้อมูลพิกัดและรายละเอียดใบงาน
            </DialogDescription>
          </DialogHeader>

          {selectedReq && (
            <div className="space-y-6 py-4">
              {selectedReq.status !== 'cancelled' && (
                <div className="rounded-xl overflow-hidden border border-border/50 h-[250px] bg-muted/20 relative">
                  {hasCoordinates ? (
                    <div ref={mapContainerRef} className="w-full h-full" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-secondary/10 p-4 text-center">
                      <MapPin className="h-8 w-8 mb-2 opacity-20" />
                      <p className="text-xs">ไม่มีข้อมูลพิกัดสำหรับจุดหมายในคำขอนี้</p>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-secondary/30 p-4 rounded-xl border border-border/50">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">ผู้ขอใช้รถ</p>
                  <p className="text-sm font-bold text-white">{selectedReq.requestedBy}</p>
                  {selectedReq.requestedByPhone && (
                    <a href={`tel:${selectedReq.requestedByPhone}`} className="text-sm font-bold text-orange-400 flex items-center gap-1 hover:underline">
                      <Phone className="h-3 w-3" /> {selectedReq.requestedByPhone}
                    </a>
                  )}
                  <p className="text-[10px] text-muted-foreground">{selectedReq.requestedByEmail}</p>

                  {/* Driver Info for Dispatcher */}
                  {relatedTrip && (
                    <div className="pt-2 border-t border-border/20 mt-2 space-y-1 animate-in fade-in slide-in-from-top-1">
                      <p className="text-[10px] uppercase text-accent font-bold tracking-wider">จัดรถโดย</p>
                      <p className="text-sm font-bold text-white flex items-center gap-2">
                        <Truck className="h-3.5 w-3.5 text-accent" /> {relatedTrip.driverName}
                      </p>
                      {relatedDriver?.phoneNumber && (
                        <a href={`tel:${relatedDriver.phoneNumber}`} className="text-xs font-bold text-blue-400 flex items-center gap-1 hover:underline">
                          <Phone className="h-3.5 w-3.5" /> {relatedDriver.phoneNumber}
                        </a>
                      )}
                      <p className="text-[10px] text-muted-foreground">ทะเบียน: {relatedTrip.vehiclePlate}</p>
                    </div>
                  )}
                </div>
                <div className="space-y-1 sm:text-right">
                  <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">วัน/เวลาที่ต้องการ</p>
                  <p className="text-sm font-bold text-accent">{formatDateDisplay(selectedReq.requestDate)} @ {selectedReq.requestTime} น.</p>
                  <p className="text-[10px] text-muted-foreground">ส่งคำขอเมื่อ: {selectedReq.createdAt?.toDate()?.toLocaleString('th-TH')}</p>
                </div>
              </div>

              {/* Display Request Notes for Dispatcher */}
              {(selectedReq.note || selectedReq.notes) && (selectedReq.note?.trim() !== '' || selectedReq.notes?.trim() !== '') && (
                <div style={{
                  margin: '12px 0',
                  padding: '8px 12px',
                  borderLeft: '3px solid #f97316',
                  backgroundColor: 'rgba(249, 115, 22, 0.08)',
                  borderRadius: '0 4px 4px 0'
                }}>
                  <div style={{ color: '#f97316', fontWeight: 500, fontSize: '13px' }}>
                    📌 หมายเหตุจากผู้ขอ:
                  </div>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', marginTop: '4px' }}>
                    {selectedReq.note || selectedReq.notes}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold flex items-center gap-2 text-white">
                    <MapPin className="h-4 w-4 text-accent" /> จุดหมายปลายทาง ({selectedReq.destinations.length})
                  </p>
                </div>
                
                <div className="space-y-3">
                  {selectedReq.destinations.map((dest: any, idx: number) => {
                    const isAssigned = (selectedReq.assignedDestinations || []).includes(idx);
                    const isSelected = selectedDestIndexes.has(idx);

                    return (
                      <div 
                        key={idx} 
                        className={cn(
                          "bg-background/50 border border-border/50 p-4 rounded-xl relative overflow-hidden group/item flex gap-4 items-start",
                          isSelected && "border-accent/40 bg-accent/5",
                          isAssigned && "opacity-60 bg-secondary/10"
                        )}
                      >
                        <div className="pt-1">
                          <Checkbox 
                            id={`dest-${idx}`}
                            checked={isSelected || isAssigned}
                            disabled={isAssigned || selectedReq.status === 'cancelled'}
                            onCheckedChange={() => toggleDest(idx)}
                            className={cn(isAssigned && "data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500")}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold flex flex-wrap items-center gap-2">
                                <span className={cn(
                                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0",
                                  dest.type === 'site' ? "bg-accent/20 text-accent" : "bg-purple-500/20 text-purple-400"
                                )}>
                                  {idx + 1}
                                </span>
                                <span className={cn(isSelected && "text-accent")}>{dest.siteName}</span>
                                
                                {isStaff ? (
                                  <div className="flex items-center gap-1 ml-auto">
                                    <span className="text-[10px] text-muted-foreground font-bold">🕗</span>
                                    <Input
                                      defaultValue={dest.requestTime || "08:30"}
                                      className="h-6 w-16 text-[10px] px-1 bg-background/50 border-accent/20 font-bold"
                                      onBlur={async (e) => {
                                        const newTime = e.target.value;
                                        if (newTime === dest.requestTime) return;
                                        const newDestinations = [...selectedReq.destinations];
                                        newDestinations[idx] = { ...newDestinations[idx], requestTime: newTime };
                                        await updateDoc(doc(db, "vehicleRequests", selectedReq.id), {
                                          destinations: newDestinations,
                                          updatedAt: serverTimestamp()
                                        });
                                        toast({ title: "อัปเดตเวลาสำเร็จ" });
                                      }}
                                    />
                                    <span className="text-[10px] text-muted-foreground font-bold">น.</span>
                                  </div>
                                ) : (
                                  dest.requestTime && (
                                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-accent/5 text-accent border-accent/20">
                                      🕗 {dest.requestTime} น.
                                    </Badge>
                                  )
                                )}

                                {isAssigned && (
                                  <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px] h-5">
                                    <Check className="h-3 w-3 mr-1" /> จัดแล้ว
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-2 bg-secondary/20 p-2 rounded text-xs text-muted-foreground border border-dashed">
                                <span className="font-bold text-foreground text-[10px] block mb-1">รายละเอียดงาน:</span>
                                {isStaff ? (
                                  <Textarea
                                    defaultValue={dest.jobDescription}
                                    onBlur={async (e) => {
                                      const newValue = e.target.value;
                                      if (newValue === dest.jobDescription) return;
                                      const newDestinations = [...selectedReq.destinations];
                                      newDestinations[idx] = { ...newDestinations[idx], jobDescription: newValue };
                                      await updateDoc(doc(db, "vehicleRequests", selectedReq.id), {
                                        destinations: newDestinations,
                                        updatedAt: serverTimestamp()
                                      });
                                      toast({ title: "บันทึกรายละเอียดงานแล้ว" });
                                    }}
                                    className="text-xs bg-background/50 min-h-[60px] border-accent/20 focus-visible:ring-accent/30"
                                  />
                                ) : (
                                  dest.jobDescription || "ไม่ได้ระบุลักษณะงาน"
                                )}
                              </div>
                              
                              {(!dest.lat || !dest.lng || (dest.lat === 0 && dest.lng === 0)) && (
                                <div style={{
                                  marginTop: '8px',
                                  padding: '8px 12px',
                                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                                  borderLeft: '3px solid #ef4444',
                                  borderRadius: '0 4px 4px 0'
                                }}>
                                  <p className="text-xs font-bold text-red-400 flex items-center gap-1 mb-2">
                                    ⚠️ ไม่มีพิกัด — กรุณาใส่พิกัดเพื่อให้จัดคิวได้
                                  </p>
                                  <div className="flex gap-2 items-center">
                                    <Input
                                      placeholder="14.0815, 100.7129"
                                      className="h-8 text-xs flex-1 bg-background"
                                      value={editingCoords[idx] || ""}
                                      onChange={(e) => setEditingCoords(prev => ({ ...prev, [idx]: e.target.value }))}
                                    />
                                    <Button
                                      size="sm"
                                      className="h-8 text-xs bg-red-500 hover:bg-red-600 text-white shrink-0"
                                      onClick={() => handleSaveCoordinates(idx)}
                                    >
                                      📍 บันทึกพิกัด
                                    </Button>
                                  </div>
                                  <a 
                                    href="https://maps.google.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-accent mt-1 flex items-center gap-1"
                                  >
                                    🗺️ เปิด Google Maps เพื่อหาพิกัด
                                  </a>
                                </div>
                              )}

                              {isStaff && (() => {
                                const noteKey = `stop_${idx}`
                                const current = stopNotes[noteKey] || ''
                                const saved = selectedReq?.stopNotes?.[noteKey] || ''
                                const dirty = current !== saved
                                const saving = isSavingNote === idx
                                return (
                                <div style={{
                                  marginTop: '12px',
                                  borderLeft: '3px solid #3b82f6',
                                  paddingLeft: '8px'
                                }}>
                                  <small style={{ color: '#3b82f6', fontWeight: 'bold' }}>
                                    ✏️ บันทึกโดย {profileName || "ผู้จัดคิว"}:
                                  </small>
                                  <div className="mt-1 flex flex-col gap-1.5">
                                    <Textarea
                                      placeholder="ระบุหมายเหตุเพิ่มเติมจากผู้จัดคิว"
                                      value={current}
                                      onChange={(e) => setStopNotes(prev => ({
                                        ...prev,
                                        [noteKey]: e.target.value
                                      }))}
                                      onBlur={() => { if (dirty) handleSaveStopNote(idx) }}
                                      className="text-xs bg-background min-h-[60px]"
                                    />
                                    <div className="text-[10px] flex items-center gap-1 h-4">
                                      {saving ? (
                                        <span className="text-blue-400 flex items-center gap-1">
                                          <Loader2 className="h-3 w-3 animate-spin" /> กำลังบันทึก…
                                        </span>
                                      ) : dirty ? (
                                        <span className="text-amber-400">● บันทึกอัตโนมัติเมื่อคลิกออกจากช่อง</span>
                                      ) : current ? (
                                        <span className="text-green-400">✓ บันทึกแล้ว</span>
                                      ) : (
                                        <span className="text-muted-foreground">บันทึกอัตโนมัติเมื่อคลิกออกจากช่อง</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                )
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {(selectedReq.status === "pending" || selectedReq.status === "partial" || selectedReq.status === "in_progress" || selectedReq.status === "rescheduled") ? (
                <div className="pt-6 border-t border-border/50 space-y-5">
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-wider text-red-400">เหตุผลกรณีไม่อนุมัติ</Label>
                      <Textarea 
                        placeholder="ระบุเหตุผลเพื่อให้ผู้ขอรับทราบ..."
                        className="bg-secondary/20 min-h-[80px]"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 h-12 border-blue-500/50 text-blue-400 hover:bg-blue-500 hover:text-white"
                      onClick={() => {
                        setRescheduleDate(selectedReq?.requestDate || "")
                        setIsRescheduleOpen(true)
                      }}
                      disabled={isProcessing || isRescheduling}
                    >
                      📅 เลื่อนวันที่
                    </Button>
                    <Button 
                      variant="outline"
                      className="flex-1 h-12 border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white" 
                      onClick={handleReject}
                      disabled={isProcessing}
                    >
                      <XCircle className="mr-2 h-4 w-4" /> ปฏิเสธคำขอ
                    </Button>
                    <Button 
                      className="flex-[2] h-12 bg-accent hover:bg-accent/90 shadow-lg shadow-accent/20" 
                      onClick={handleAcknowledge}
                      disabled={isProcessing}
                    >
                      {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      ✅ รับทราบและดำเนินการ
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={cn(
                  "p-5 rounded-xl border text-center space-y-2",
                  selectedReq.status === "approved" ? "bg-green-500/10 border-green-500/30 text-green-500" : 
                  selectedReq.status === "cancelled" ? "bg-gray-500/10 border-gray-500/30 text-gray-400" :
                  "bg-red-500/10 border-red-500/30 text-red-500"
                )}>
                  <div className="flex items-center justify-center gap-2 font-bold text-lg">
                    {selectedReq.status === "approved" ? <CheckCircle2 className="h-6 w-6" /> : 
                     selectedReq.status === "cancelled" ? <XCircle className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
                    {selectedReq.status === "approved" ? "จัดรถครบถ้วนแล้ว" : 
                     selectedReq.status === "cancelled" ? "ยกเลิกโดยผู้ใช้งาน" : "ไม่อนุมัติ"}
                  </div>
                  {selectedReq.tripId && (
                    <Badge variant="outline" className="bg-green-500 text-white border-transparent">
                      Trip ID ล่าสุด: {selectedReq.tripId}
                    </Badge>
                  )}
                  {selectedReq.rejectReason && (
                    <p className="text-xs italic text-muted-foreground mt-2 border-t border-red-500/20 pt-2">
                      เหตุผล: {selectedReq.rejectReason}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isRescheduleOpen} onOpenChange={setIsRescheduleOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2 text-blue-400">
              📅 เลื่อนวันที่คำขอ {selectedReq?.requestId}
            </DialogTitle>
            <DialogDescription>
              วันที่ปัจจุบัน: {selectedReq?.requestDate}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">วันที่ใหม่</Label>
              <Input
                type="date"
                value={rescheduleDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-blue-400">
                หมายเหตุการเลื่อนวัน <span className="text-red-400">*</span>
              </Label>
              <Textarea
                placeholder="เช่น รถเต็มในวันดังกล่าว ขอเลื่อนไปวันถัดไป"
                value={rescheduleNote}
                onChange={(e) => setRescheduleNote(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsRescheduleOpen(false)} className="flex-1">
              ยกเลิก
            </Button>
            <Button 
              onClick={handleReschedule} 
              disabled={isRescheduling || !rescheduleDate || !rescheduleNote.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isRescheduling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : "📅 ยืนยันเลื่อนวัน"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการล้างข้อมูลทั้งหมด?</AlertDialogTitle>
            <AlertDialogDescription>
              การกระทำนี้จะลบข้อมูลคำขอใช้รถทั้งหมดในระบบอย่างถาวร (รวมถึงรายการที่จัดรถแล้ว) และไม่สามารถย้อนกลับได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAllData} className="bg-red-500 hover:bg-red-600" disabled={isClearing}>
              {isClearing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              ยืนยันลบข้อมูลทั้งหมด
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default function RequestsPage() {
  const { user } = useUser()
  const db = useFirestore()
  const { toast } = useToast()
  
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef)

  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: settings } = useDoc<any>(settingsRef)

  const [activeTab, setActiveTab] = React.useState("form")
  const [isCancelOpen, setIsCancelOpen] = React.useState(false)
  const [reqToCancel, setReqToCancel] = React.useState<any>(null)
  const [viewingUserReq, setViewingUserReq] = React.useState<any>(null)

  // Related Trip and Driver lookup for user's selected request
  const relatedTripRef = useMemoFirebase(() => (db && viewingUserReq?.tripId) ? doc(db, "trips", viewingUserReq.tripId) : null, [db, viewingUserReq?.tripId])
  const { data: relatedTrip } = useDoc<any>(relatedTripRef)

  const relatedDriverRef = useMemoFirebase(() => (db && relatedTrip?.driverId) ? doc(db, "drivers", relatedTrip.driverId) : null, [db, relatedTrip?.driverId])
  const { data: relatedDriver } = useDoc<any>(relatedDriverRef)

  const myRequestsRef = useMemoFirebase(() => (db && user) ? query(
    collection(db, "vehicleRequests"),
    where("userId", "==", user.uid)
  ) : null, [db, user])
  
  const { data: myRequests, isLoading: isDataLoading } = useCollection<any>(myRequestsRef)

  const isStaff = profile?.role === 'admin' || profile?.role === 'dispatcher'

  const handleCancelRequest = async () => {
    if (!reqToCancel) return
    try {
      await updateDoc(doc(db, "vehicleRequests", reqToCancel.id), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      toast({ title: "ยกเลิกสำเร็จ", description: `คำขอ ${reqToCancel.requestId} ถูกยกเลิกแล้ว` })
      setIsCancelOpen(false)
      setReqToCancel(null)
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    }
  }

  if (isProfileLoading) {
    return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-accent" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">ขอใช้รถและจัดการคำขอ</h2>
        <p className="text-sm md:text-base text-muted-foreground">ระบบส่งคำขอใช้รถวัสดุและติดตามสถานะคิวงาน</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-secondary/50 p-1 w-full sm:w-auto">
          <TabsTrigger value="form" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">
            <ClipboardList className="mr-2 h-4 w-4" /> ใบขอใช้รถ
          </TabsTrigger>
          <TabsTrigger value="list" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">
            <History className="mr-2 h-4 w-4" /> คำขอของฉัน
          </TabsTrigger>
          {isStaff && (
            <TabsTrigger value="manage" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">
              <Settings2 className="mr-2 h-4 w-4" /> จัดการคำขอ
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="form" className="animate-in slide-in-from-left-2 duration-300">
          <RequestForm />
        </TabsContent>

        <TabsContent value="list" className="animate-in slide-in-from-right-2 duration-300">
          <div className="max-w-4xl mx-auto space-y-4">
            {isDataLoading && !myRequests ? (
              <div className="flex flex-col gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-32 w-full bg-secondary/20 animate-pulse rounded-xl" />
                ))}
              </div>
            ) : myRequests && myRequests.length > 0 ? (
              [...myRequests].sort((a,b) => (b.createdAt?.toDate()?.getTime() || 0) - (a.createdAt?.toDate()?.getTime() || 0)).map((req: any) => (
                <Card 
                  key={req.id} 
                  className={cn(
                    "border-border/50 hover:border-accent/30 transition-all overflow-hidden group cursor-pointer",
                    req.status === "cancelled" && "opacity-50 grayscale-[0.5]"
                  )}
                  onClick={() => setViewingUserReq(req)}
                >
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row">
                      <div className={cn(
                        "w-full sm:w-1.5 h-1.5 sm:h-auto shrink-0",
                        req.status === "pending" ? "bg-orange-500" :
                        (req.status === "in_progress" || req.status === "partial" || req.status === "rescheduled") ? "bg-blue-500" :
                        req.status === "approved" ? "bg-green-500" :
                        req.status === "cancelled" ? "bg-gray-500" : "bg-red-500"
                      )} />
                      
                      <div className="flex-1 p-4 md:p-6 space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-lg text-accent">{req.requestId}</span>
                              {getStatusBadge(req.status)}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <CalendarIcon className="h-3.5 w-3.5" /> {formatDateDisplay(req.requestDate)}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5" /> {req.requestTime} น.
                              </div>
                              <div className="flex items-center gap-1.5 text-foreground font-medium">
                                <MapPin className="h-3.5 w-3.5 text-accent" /> {req.destinations?.length || 0} จุดหมาย
                              </div>
                              <div className="flex items-center gap-1.5">
                                <UserIcon className="h-3.5 w-3.5" /> {req.requestedBy}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            {(req.status === "pending" || req.status === "partial" || req.status === "in_progress" || req.status === "rescheduled") && req.userId === user?.uid && (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-8 text-xs border-red-500/30 text-red-500/70 hover:bg-red-500/10 hover:text-red-500"
                                onClick={() => {
                                  setReqToCancel(req)
                                  setIsCancelOpen(true)
                                }}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1.5" /> ยกเลิก
                              </Button>
                            )}
                          </div>
                        </div>

                        {req.status === 'rescheduled' && req.rescheduleNote && (
                          <div style={{
                            marginTop: '8px',
                            padding: '8px 12px',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            borderLeft: '3px solid #3b82f6',
                            borderRadius: '0 4px 4px 0'
                          }}>
                            <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '13px' }}>
                              📅 เลื่อนวันเป็น: {req.requestDate}
                            </span>
                            <p style={{ color: '#e2e8f0', fontSize: '12px', marginTop: '2px' }}>
                              หมายเหตุ: {req.rescheduleNote}
                            </p>
                            <p style={{ color: '#94a3b8', fontSize: '11px', marginTop: '2px' }}>
                              เลื่อนโดย: {req.rescheduledBy}
                            </p>
                          </div>
                        )}

                        {req.status === 'rejected' && req.rejectReason && (
                          <div style={{
                            marginTop: '8px',
                            padding: '8px 12px',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderLeft: '3px solid #ef4444',
                            borderRadius: '0 4px 4px 0'
                          }} className="animate-in slide-in-from-top-1">
                            <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '13px' }} className="flex items-center gap-1.5">
                              <XCircle className="h-3.5 w-3.5" /> ❌ เหตุผลที่ปฏิเสธ:
                            </span>
                            <p style={{ color: '#e2e8f0', marginLeft: '24px', fontSize: '13px', marginTop: '2px' }} className="italic">
                              "{req.rejectReason}"
                            </p>
                          </div>
                        )}

                        <Separator className="bg-border/50" />

                        <div className="grid grid-cols-1 gap-3">
                          {req.destinations?.map((dest: any, idx: number) => {
                            const isAssigned = (req.assignedDestinations || []).includes(idx);
                            const stopDispatcherNote = req.stopNotes?.[`stop_${idx}`];
                            
                            return (
                              <div key={idx} className={cn("flex flex-col gap-1 text-sm", isAssigned && "opacity-50")}>
                                <div className="flex gap-3">
                                  <div className={cn("font-bold min-w-[20px]", isAssigned ? "text-green-500" : "text-accent")}>
                                    {isAssigned ? <Check className="h-4 w-4" /> : `${idx + 1}.`}
                                  </div>
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <p className="font-semibold text-foreground">{dest.siteName}</p>
                                      {dest.requestTime && (
                                        <Badge variant="outline" className="text-[10px] h-4 py-0 bg-accent/5 text-accent border-accent/20">
                                          🕗 {dest.requestTime} น.
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">{dest.jobDescription || "ไม่ได้ระบุลักษณะงาน"}</p>
                                  </div>
                                </div>
                                {stopDispatcherNote && (
                                  <div className="ml-8 mt-1 p-2 rounded bg-blue-500/5 border border-blue-500/10 text-[11px] text-blue-300 italic">
                                    ✏️ บันทึกจัดรถ: {stopDispatcherNote}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Display Request Notes in My Requests list */}
                        {(req.note || req.notes) && (req.note?.trim() !== '' || req.notes?.trim() !== '') && (
                          <div style={{
                            marginTop: '6px',
                            padding: '6px 10px',
                            borderLeft: '3px solid #f97316',
                            backgroundColor: 'rgba(249, 115, 22, 0.08)',
                            borderRadius: '0 4px 4px 0',
                            fontSize: '13px'
                          }}>
                            <span style={{ color: '#f97316', fontWeight: 500 }}>
                              📌 หมายเหตุ:
                            </span>
                            <span style={{ color: '#e2e8f0', marginLeft: '6px' }}>
                              {req.note || req.notes}
                            </span>
                          </div>
                        )}

                        <div className="flex justify-end pt-2">
                          <span className="text-[10px] text-accent flex items-center group-hover:translate-x-1 transition-transform font-bold">
                            กดเพื่อดูรายละเอียด <ChevronRight className="h-3 w-3 ml-1" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="text-center py-20 space-y-4 bg-secondary/10 rounded-2xl border border-dashed border-border/50">
                <div className="bg-secondary/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                  <ClipboardList className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-foreground font-semibold">ยังไม่มีคำขอรถ</p>
                  <p className="text-xs text-muted-foreground">รายการที่คุณส่งคำขอจะแสดงที่นี่เพื่อติดตามสถานะ</p>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {isStaff && (
          <TabsContent value="manage" className="animate-in slide-in-from-bottom-2 duration-300">
            <InlineRequestManager userRole={profile?.role} profileName={profile?.name} />
          </TabsContent>
        )}
      </Tabs>

      <AlertDialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการยกเลิกคำขอ</AlertDialogTitle>
            <AlertDialogDescription>
              คุณต้องการยกเลิกคำขอ {reqToCancel?.requestId} ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ปิด</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelRequest} className="bg-red-500 hover:bg-red-600">ยืนยันยกเลิก</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* User Request Detail Dialog */}
      <Dialog open={!!viewingUserReq} onOpenChange={(open) => !open && setViewingUserReq(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-accent" /> รายละเอียดคำขอ {viewingUserReq?.requestId}
            </DialogTitle>
            <DialogDescription>
              ข้อมูลจุดหมายและเวลานัดหมายที่ระบุไว้
            </DialogDescription>
          </DialogHeader>

          {viewingUserReq && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-secondary/30 p-4 rounded-xl border border-border/50">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">ผู้ขอใช้รถ</p>
                  <p className="text-sm font-bold text-white">{viewingUserReq.requestedBy}</p>
                  {viewingUserReq.requestedByPhone && (
                    <a href={`tel:${viewingUserReq.requestedByPhone}`} className="text-xs font-bold text-orange-400 flex items-center gap-1 hover:underline">
                      <Phone className="h-3 w-3" /> {viewingUserReq.requestedByPhone}
                    </a>
                  )}
                  <p className="text-[10px] text-muted-foreground">{viewingUserReq.requestedByEmail}</p>

                  {/* Assigned Driver Info for User */}
                  {relatedTrip && (
                    <div className="pt-2 border-t border-border/20 mt-2 space-y-1 animate-in fade-in slide-in-from-top-1">
                      <p className="text-[10px] uppercase text-accent font-bold tracking-wider">คนขับรถที่มอบหมาย</p>
                      <p className="text-sm font-bold text-white flex items-center gap-2">
                        <Truck className="h-3.5 w-3.5 text-accent" /> {relatedTrip.driverName}
                      </p>
                      {relatedDriver?.phoneNumber && (
                        <a href={`tel:${relatedDriver.phoneNumber}`} className="text-xs font-bold text-blue-400 flex items-center gap-1 hover:underline">
                          <Phone className="h-3.5 w-3.5" /> {relatedDriver.phoneNumber}
                        </a>
                      )}
                      <p className="text-[10px] text-muted-foreground">ทะเบียน: {relatedTrip.vehiclePlate}</p>
                    </div>
                  )}
                </div>
                <div className="space-y-1 sm:text-right">
                  <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">วันที่ต้องการรถ</p>
                  <p className="text-sm font-bold text-accent">{formatDateDisplay(viewingUserReq.requestDate)}</p>
                  <p className="text-[10px] text-muted-foreground">ส่งคำขอเมื่อ: {viewingUserReq.createdAt?.toDate()?.toLocaleString('th-TH')}</p>
                  <div className="flex items-center justify-end gap-2 mt-1">
                    {getStatusBadge(viewingUserReq.status)}
                  </div>
                </div>
              </div>

              {viewingUserReq.status === 'rescheduled' && viewingUserReq.rescheduleNote && (
                <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                  <p className="text-xs text-blue-500 font-bold mb-1 uppercase flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" /> รายละเอียดการเลื่อนวัน
                  </p>
                  <p className="text-sm text-foreground font-bold">เลื่อนเป็นวันที่: {formatDateDisplay(viewingUserReq.requestDate)}</p>
                  <p className="text-sm text-muted-foreground italic mt-1">หมายเหตุ: "{viewingUserReq.rescheduleNote}"</p>
                  <p className="text-[10px] text-muted-foreground mt-1">ดำเนินการโดย: {viewingUserReq.rescheduledBy}</p>
                </div>
              )}

              <div className="space-y-3">
                <p className="text-sm font-bold flex items-center gap-2 text-white">
                  <MapPin className="h-4 w-4 text-accent" /> จุดหมายและเวลาที่ระบุ ({viewingUserReq.destinations.length})
                </p>
                <div className="space-y-3">
                  {viewingUserReq.destinations.map((dest: any, idx: number) => {
                    const isAssigned = (viewingUserReq.assignedDestinations || []).includes(idx);
                    
                    return (
                      <div key={idx} className={cn(
                        "bg-background/50 border border-border/50 p-4 rounded-xl flex gap-4 items-start",
                        isAssigned && "border-green-500/30 bg-green-500/5"
                      )}>
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0",
                          isAssigned ? "bg-green-500 text-white" : "bg-accent/20 text-accent"
                        )}>
                          {isAssigned ? <Check className="h-4 w-4" /> : idx + 1}
                        </div>
                        <div className="flex-1 space-y-2 min-w-0">
                          <div className="flex justify-between items-start gap-4">
                            <p className="font-bold text-white truncate">{dest.siteName}</p>
                            <Badge className="bg-accent/10 text-accent border-accent/20 shrink-0">
                              🕗 {dest.requestTime || "08:30"} น.
                            </Badge>
                          </div>
                          <div className="bg-secondary/20 p-2 rounded text-xs text-muted-foreground border border-dashed border-border/50">
                            <span className="font-bold text-foreground text-[10px] block mb-1 uppercase tracking-wider">📦 ลักษณะงาน / วัสดุ:</span>
                            <p className="whitespace-pre-wrap">{dest.jobDescription || "ไม่ได้ระบุลักษณะงาน"}</p>
                          </div>
                          {isAssigned && viewingUserReq.stopNotes?.[`stop_${idx}`] && (
                            <div className="p-2 rounded bg-blue-500/5 border border-blue-500/10 text-[11px] text-blue-300 italic">
                              ✏️ บันทึกจัดรถ: {viewingUserReq.stopNotes[`stop_${idx}`]}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {(viewingUserReq.note || viewingUserReq.notes) && (
                <div className="space-y-2">
                  <p className="text-sm font-bold flex items-center gap-2 text-white">
                    <MessageSquare className="h-4 w-4 text-accent" /> หมายเหตุเพิ่มเติมจากผู้ขอ
                  </p>
                  <div className="p-3 bg-accent/5 border border-accent/20 rounded-xl text-sm italic text-muted-foreground leading-relaxed">
                    "{viewingUserReq.note || viewingUserReq.notes}"
                  </div>
                </div>
              )}

              {viewingUserReq.status === 'rejected' && viewingUserReq.rejectReason && (
                <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                  <p className="text-xs text-red-500 font-bold mb-1 uppercase flex items-center gap-2">
                    <XCircle className="h-4 w-4" /> เหตุผลที่ปฏิเสธงาน
                  </p>
                  <p className="text-sm text-foreground italic">"{viewingUserReq.rejectReason}"</p>
                </div>
              )}

              {viewingUserReq.tripId && viewingUserReq.status === 'approved' && (
                <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/30 text-green-500 flex gap-3">
                  <Truck className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold uppercase">จัดรถเรียบร้อยแล้ว</p>
                    <p className="text-xs">หมายเลขเที่ยววิ่ง: <span className="font-bold">{viewingUserReq.tripId}</span> สามารถติดตามสถานะได้ในหน้าประวัติการส่ง</p>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="w-full h-11" onClick={() => setViewingUserReq(null)}>ปิดหน้าต่าง</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
