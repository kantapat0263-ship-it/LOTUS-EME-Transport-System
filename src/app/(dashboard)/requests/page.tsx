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
  Save
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

// Category mapping for filtering
const CATEGORIES = [
  { id: 'site', label: 'ไซน์งาน', icon: Building2, types: ['ไซน์งาน', 'Electrical', 'Plumbing', 'HVAC', 'Mixed'] },
  { id: 'store', label: 'ร้านค้า', icon: Store, types: ['ร้านค้า / ซัพพลายเออร์'] },
  { id: 'bank', label: 'ธนาคาร', icon: Landmark, types: ['ธนาคาร'] },
  { id: 'company', label: 'บริษัท', icon: Briefcase, types: ['บริษัท / หน่วยงานราชการ'] },
  { id: 'custom', label: 'กำหนดเอง', icon: MapPin, types: [] },
] as const;

function getCategoryFromType(type: string): string {
  if (['ไซน์งาน', 'Electrical', 'Plumbing', 'HVAC', 'Mixed'].includes(type)) return 'site';
  if (type === 'ร้านค้า / ซัพพลายเออร์') return 'store';
  if (type === 'ธนาคาร') return 'bank';
  if (type === 'บริษัท / หน่วยงานราชการ') return 'company';
  return 'custom';
}

// Inline helper component for Dispatcher Notes
function DispatcherNoteEditor({ req, userRole, profileName }: { req: any, userRole?: string, profileName?: string }) {
  const db = useFirestore()
  const [isEditing, setIsEditing] = React.useState(false)
  const [dispatcherNote, setDispatcherNote] = React.useState(req.dispatcherNote || "")
  const [isSaving, setIsSaving] = React.useState(false)

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsSaving(true)
    try {
      await updateDoc(doc(db, 'vehicleRequests', req.id), {
        dispatcherNote: dispatcherNote,
        dispatcherName: profileName || "Dispatcher",
        dispatcherUpdatedAt: new Date().toISOString()
      })
      setIsEditing(false)
    } catch (error) {
      console.error("Error saving dispatcher note:", error)
    } finally {
      setIsSaving(false)
    }
  }

  if (!(userRole === 'admin' || userRole === 'dispatcher')) return null

  return (
    <div className="mt-3 pt-3 border-t border-border/20 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-blue-400 uppercase flex items-center gap-1">
          ✏️ บันทึกโดย {req.dispatcherName || profileName || "Dispatcher"}:
        </span>
        {req.dispatcherUpdatedAt && !isEditing && (
          <span className="text-[9px] text-muted-foreground italic">
            {new Date(req.dispatcherUpdatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      
      {isEditing ? (
        <div className="space-y-2 animate-in fade-in zoom-in-95 duration-200">
          <Textarea 
            value={dispatcherNote}
            onChange={(e) => setDispatcherNote(e.target.value)}
            placeholder="ระบุหมายเหตุเพิ่มเติมจากผู้จัดคิว"
            className="text-xs bg-background/50 min-h-[60px] border-blue-500/30 focus-visible:ring-blue-500/30"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-[10px] bg-blue-600 hover:bg-blue-700" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : "บันทึก"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[10px] text-muted-foreground" onClick={() => { setIsEditing(false); setDispatcherNote(req.dispatcherNote || ""); }}>ยกเลิก</Button>
          </div>
        </div>
      ) : (
        <div 
          className="p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-blue-100/90 cursor-text hover:bg-blue-500/10 transition-all border-dashed"
          onClick={() => setIsEditing(true)}
        >
          {dispatcherNote || <span className="text-muted-foreground/60 italic">ระบุหมายเหตุเพิ่มเติมจากผู้จัดคิว...</span>}
        </div>
      )}
    </div>
  )
}

// Inline modified RequestManager to support "Manage Vehicle" flow and Split Trip
function InlineRequestManager({ userRole, profileName }: { userRole?: string, profileName?: string }) {
  const { toast } = useToast()
  const db = useFirestore()
  const router = useRouter()
  const isStaff = userRole === 'admin' || userRole === 'dispatcher'
  
  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: companySettings } = useDoc<any>(settingsRef)

  const [showCancelled, setShowCancelled] = React.useState(false)
  
  const requestsRef = useMemoFirebase(() => query(
    collection(db, "vehicleRequests"), 
    where("status", "in", showCancelled ? ["pending", "partial", "cancelled"] : ["pending", "partial"])
  ), [db, showCancelled])

  const { data: rawRequests, isLoading } = useCollection<any>(requestsRef)

  const requests = React.useMemo(() => {
    if (!rawRequests) return [];
    return [...rawRequests].sort((a, b) => {
      const dateA = a.createdAt?.toDate() || new Date(0);
      const dateB = b.createdAt?.toDate() || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
  }, [rawRequests]);

  const [selectedReq, setSelectedReq] = React.useState<any | null>(null)
  const [isDetailOpen, setIsDetailOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [isProcessing, setIsStaffProcessing] = React.useState(false)
  const [searchTerm, setSearchTerm] = React.useState("")
  
  const [isClearConfirmOpen, setIsClearConfirmOpen] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)
  
  const [selectedDestIndexes, setSelectedDestIndexes] = React.useState<Set<number>>(new Set())
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const [modalMarkers, setModalMarkers] = React.useState<google.maps.Marker[]>([])

  // State for per-stop dispatcher notes
  const [stopNotes, setStopNotes] = React.useState<Record<string, string>>({})
  const [isSavingNote, setIsSavingNote] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (selectedReq) {
      const assigned = selectedReq.assignedDestinations || []
      const available = selectedReq.destinations
        .map((_: any, i: number) => i)
        .filter((i: number) => !assigned.includes(i))
      
      setSelectedDestIndexes(new Set(available))
      setStopNotes(selectedReq.stopNotes || {})
    }
  }, [selectedReq])

  React.useEffect(() => {
    let mapTimeout: NodeJS.Timeout;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || companySettings?.googleMapsApiKeyReference;
    
    if (isDetailOpen && selectedReq && apiKey) {
      mapTimeout = setTimeout(() => {
        if (!mapContainerRef.current) return;

        const loader = new Loader({
          apiKey: apiKey,
          version: "weekly",
          libraries: ["places", "geometry"]
        });

        loader.load().then(() => {
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
            ]
          });

          const bounds = new google.maps.LatLngBounds();
          const markers: google.maps.Marker[] = [];
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
              markers.push(marker);
            }
          });

          if (hasCoords) {
            newMap.fitBounds(bounds);
            google.maps.event.addListenerOnce(newMap, "idle", () => {
              google.maps.event.trigger(newMap, 'resize');
              if (newMap.getZoom()! > 15) newMap.setZoom(15);
            });
          }

          setModalMarkers(markers);
        });
      }, 400); 
    }

    return () => {
      clearTimeout(mapTimeout);
      modalMarkers.forEach(m => m.setMap(null));
    }
  }, [isDetailOpen, selectedReq, companySettings]);

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

      // Also update linked trip if exists
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

  const handleManageVehicle = () => {
    if (!selectedReq) return
    
    if (selectedDestIndexes.size === 0) {
      toast({ title: "กรุณาเลือกจุดหมาย", description: "ต้องเลือกอย่างน้อย 1 จุดเพื่อจัดรถ", variant: "destructive" })
      return
    }

    const assigned = selectedReq.assignedDestinations || []
    const availableCount = selectedReq.destinations.length - assigned.length
    
    if (selectedDestIndexes.size < availableCount) {
      if (!confirm(`คุณเลือก ${selectedDestIndexes.size} จาก ${availableCount} จุดที่เหลือ\nจุดที่ไม่ได้เลือกยังต้องรอการจัดรถใน Trip อื่น ต้องการดำเนินการต่อหรือไม่?`)) {
        return
      }
    }
    
    const selectedDestinations = selectedReq.destinations.filter((_: any, i: number) => selectedDestIndexes.has(i))
    
    const pendingVR = {
      vrId: selectedReq.requestId,
      docId: selectedReq.id,
      requestDate: selectedReq.requestDate,
      requestTime: selectedReq.requestTime,
      requestedBy: selectedReq.requestedBy,
      destinations: selectedDestinations,
      totalDestinations: selectedReq.destinations.length,
      selectedCount: selectedDestIndexes.size,
      assignedIndexes: Array.from(selectedDestIndexes),
      // Pass the dispatcher notes
      stopNotes: selectedReq.stopNotes || {}
    }
    
    sessionStorage.setItem("pendingVR", JSON.stringify(pendingVR))
    router.push("/trips/plan")
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
      setSelectedReq(null)
      setRejectReason("")
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    } finally {
      setIsStaffProcessing(false)
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
      toast({ title: "ล้างข้อมูลสำเร็จ", description: "ลบข้อมูลคำขอรถทั้งหมดเรียบร้อยแล้ว" })
      setIsClearConfirmOpen(false)
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถลบข้อมูลได้", variant: "destructive" })
    } finally {
      setIsClearing(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">รอดำเนินการ</Badge>
      case "partial": return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">จัดบางส่วน</Badge>
      case "approved": return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">จัดรถแล้ว</Badge>
      case "rejected": return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">ไม่อนุมัติ</Badge>
      case "cancelled": return <Badge className="bg-gray-500/10 text-gray-400 border-gray-500/20">ยกเลิกแล้ว</Badge>
      default: return null
    }
  }

  const hasCoordinates = selectedReq?.destinations?.some((d: any) => d.lat && d.lng);

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
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
                (req.status === "pending" || req.status === "partial") && "border-yellow-500/30 bg-yellow-500/5 shadow-lg shadow-yellow-500/5",
                req.status === "cancelled" && "opacity-50 grayscale-[0.5]"
              )}
              onClick={() => {
                setSelectedReq(req)
                setIsDetailOpen(true)
              }}
            >
              {(req.status === "pending" || req.status === "partial" || req.status === "cancelled") && (
                <div className={cn(
                  "absolute top-0 left-0 w-1 h-full", 
                  req.status === "partial" ? "bg-blue-500" : 
                  req.status === "cancelled" ? "bg-gray-500" : "bg-yellow-500"
                )} />
              )}
              <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-accent">{req.requestId}</span>
                      {getStatusBadge(req.status)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <UserIcon className="h-3 w-3" /> {req.requestedBy}
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

                {/* Notes Section in List */}
                {req.note && req.note.trim() !== '' && (
                  <div style={{ 
                    marginTop: '8px', 
                    padding: '6px 10px', 
                    borderLeft: '3px solid #f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.08)',
                    borderRadius: '0 4px 4px 0'
                  }}>
                    <span style={{ fontSize: '12px', color: '#f97316', fontWeight: 500 }}>
                      📌 หมายเหตุผู้ขอ:
                    </span>
                    <span style={{ fontSize: '13px', color: '#e2e8f0', marginLeft: '6px' }}>
                      {req.note}
                    </span>
                  </div>
                )}

                {/* Dispatcher editable note */}
                <DispatcherNoteEditor 
                  req={req} 
                  userRole={userRole} 
                  profileName={profileName} 
                />

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

      <AlertDialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-500">ต้องการลบข้อมูลคำขอรถทั้งหมดใช่หรือไม่?</AlertDialogTitle>
            <AlertDialogDescription>
              การกระทำนี้จะลบรายการคำขอใช้รถ (Vehicle Requests) ทั้งหมดออกจากระบบ และไม่สามารถกู้คืนได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleClearAllData}
              className="bg-red-500 hover:bg-red-600"
              disabled={isClearing}
            >
              {isClearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              ยืนยันลบทั้งหมด
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              {/* Modal Map */}
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
                  <p className="text-[10px] text-muted-foreground">{selectedReq.requestedByEmail}</p>
                </div>
                <div className="space-y-1 sm:text-right">
                  <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">วัน/เวลาที่ต้องการ</p>
                  <p className="text-sm font-bold text-accent">{formatDateDisplay(selectedReq.requestDate)} @ {selectedReq.requestTime} น.</p>
                  <p className="text-[10px] text-muted-foreground">ส่งเมื่อ: {selectedReq.createdAt?.toDate()?.toLocaleString('th-TH')}</p>
                </div>
              </div>

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
                              
                              {/* NEW - Dispatcher note per stop */}
                              {isStaff && (
                                <div style={{
                                  marginTop: '12px',
                                  borderLeft: '3px solid #3b82f6',
                                  paddingLeft: '8px'
                                }}>
                                  <small style={{ color: '#3b82f6', fontWeight: 'bold' }}>
                                    ✏️ บันทึกโดย {profileName || "ผู้จัดคิว"} (จุดที่ {idx + 1}):
                                  </small>
                                  <div className="mt-1 flex flex-col gap-2">
                                    <Textarea
                                      placeholder="ระบุหมายเหตุเพิ่มเติมจากผู้จัดคิว"
                                      value={stopNotes[`stop_${idx}`] || ''}
                                      onChange={(e) => setStopNotes(prev => ({
                                        ...prev,
                                        [`stop_${idx}`]: e.target.value
                                      }))}
                                      className="text-xs bg-background min-h-[60px]"
                                    />
                                    <Button 
                                      size="sm" 
                                      className="h-7 text-[10px] w-fit bg-blue-600 hover:bg-blue-700"
                                      onClick={() => handleSaveStopNote(idx)}
                                      disabled={isSavingNote === idx}
                                    >
                                      {isSavingNote === idx ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                                      บันทึกเฉพาะจุดนี้
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedReq.note !== undefined && (
                <div className="space-y-2">
                  <p className="text-sm font-bold flex items-center gap-2 text-white">
                    <MessageSquare className="h-4 w-4 text-accent" /> หมายเหตุจากผู้ขอ
                  </p>
                  {isStaff ? (
                    <Textarea 
                      defaultValue={selectedReq.note}
                      onBlur={async (e) => {
                        const newValue = e.target.value;
                        if (newValue === selectedReq.note) return;
                        await updateDoc(doc(db, "vehicleRequests", selectedReq.id), {
                          note: newValue,
                          updatedAt: serverTimestamp()
                        });
                        toast({ title: "บันทึกหมายเหตุแล้ว" });
                      }}
                      placeholder="ข้อมูลเพิ่มเติม..."
                      className="p-3 bg-accent/5 border border-accent/20 rounded-xl text-sm italic text-muted-foreground leading-relaxed min-h-[100px] focus-visible:ring-accent/30"
                    />
                  ) : (
                    <div className="p-3 bg-accent/5 border border-accent/20 rounded-xl text-sm italic text-muted-foreground leading-relaxed">
                      "{selectedReq.note}"
                    </div>
                  )}
                </div>
              )}

              {(selectedReq.status === "pending" || selectedReq.status === "partial") ? (
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
                      className="flex-1 h-12 border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white" 
                      onClick={handleReject}
                      disabled={isProcessing}
                    >
                      <XCircle className="mr-2 h-4 w-4" /> ปฏิเสธคำขอ
                    </Button>
                    <Button 
                      className="flex-[2] h-12 bg-accent hover:bg-accent/90 shadow-lg shadow-accent/20" 
                      onClick={handleManageVehicle}
                      disabled={isProcessing}
                    >
                      {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
                      {selectedReq.status === 'partial' ? "จัดรถจุดที่เหลือ" : `จัดรถสำหรับที่เลือก (${selectedDestIndexes.size} จุด)`}
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
    </div>
  )
}

export default function RequestsPage() {
  const { user, isUserLoading } = useUser()
  const db = useFirestore()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = React.useState("form")
  const [myRequests, setMyRequests] = React.useState<any[] | null>(null)
  const [isDataLoading, setIsDataLoading] = React.useState(false)
  
  const userProfileRef = useMemoFirebase(() => (db && user) ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef)

  const sitesRef = useMemoFirebase(() => db ? query(collection(db, "sites"), where("status", "==", "Active")) : null, [db])
  const { data: sites } = useCollection<Site>(sitesRef)

  // Edit State
  const [editingReq, setEditingReq] = React.useState<any | null>(null)
  const [isEditDialogOpen, setIsEditOpen] = React.useState(false)
  const [editFormData, setEditFormData] = React.useState<any>(null)
  const [isSavingEdit, setIsSavingEdit] = React.useState(false)

  // Cancel Confirmation State
  const [reqToCancel, setReqToCancel] = React.useState<any | null>(null)
  const [isCancelConfirmOpen, setIsCancelOpen] = React.useState(false)

  // Clear Data State
  const [isClearConfirmOpen, setIsClearConfirmOpen] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)

  // Fetch requests with role-based filtering
  React.useEffect(() => {
    if (isUserLoading || !user || !db || isProfileLoading || !profile) return

    setIsDataLoading(true)
    const isStaff = profile.role === 'admin' || profile.role === 'dispatcher'
    
    let q;
    if (isStaff) {
      q = query(collection(db, "vehicleRequests"))
    } else {
      q = query(collection(db, "vehicleRequests"), where("userId", "==", user.uid))
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const results = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))
      const sortedResults = results.sort((a, b) => {
        const dateA = a.createdAt?.toDate() || new Date(0);
        const dateB = b.createdAt?.toDate() || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
      setMyRequests(sortedResults)
      setIsDataLoading(false)
    }, (error) => {
      console.error("Firestore error in RequestsPage:", error)
      setIsDataLoading(false)
    })

    return () => unsubscribe()
  }, [user, isUserLoading, db, profile, isProfileLoading])

  const handleCancelRequest = async () => {
    if (!reqToCancel) return
    try {
      await updateDoc(doc(db, "vehicleRequests", reqToCancel.id), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      toast({ title: "ยกเลิกสำเร็จ", description: `ยกเลิกคำขอ ${reqToCancel.requestId} เรียบร้อยแล้ว` })
      setIsCancelOpen(false)
      setReqToCancel(null)
    } catch (e) {
      toast({ title: "ผิดพลาด", description: "ไม่สามารถยกเลิกได้ในขณะนี้", variant: "destructive" })
    }
  }

  const handleOpenEdit = (req: any) => {
    setEditingReq(req)
    setEditFormData({
      requestDate: req.requestDate,
      requestTime: req.requestTime,
      note: req.note || "",
      destinations: req.destinations.map((d: any, idx: number) => ({
        id: `edit-${idx}-${Date.now()}`,
        type: d.type || "site",
        category: getCategoryFromType(d.siteName || d.type || "site"),
        searchTerm: "",
        siteId: d.siteId || "",
        siteName: d.siteName || "",
        customName: d.customName || d.siteName || "",
        coordinates: d.lat && d.lng ? `${d.lat}, ${d.lng}` : "",
        jobDescription: d.jobDescription || "",
        saveAsSite: false,
        locationType: "ไซน์งาน"
      }))
    })
    setIsEditOpen(true)
  }

  const handleUpdateEdit = async () => {
    if (!editingReq || !user) return
    setIsSavingEdit(true)
    try {
      const parsedDestinations = []
      
      for (const d of editFormData.destinations) {
        const [lat, lng] = d.coordinates.split(',').map((s: string) => parseFloat(s.trim()))
        const latVal = isNaN(lat) ? 0 : lat
        const lngVal = isNaN(lng) ? 0 : lng
        const finalName = d.category === "custom" ? d.customName : d.siteName

        parsedDestinations.push({
          type: d.category === "custom" ? "other" : "site",
          siteId: d.siteId || null,
          siteName: finalName,
          customName: d.category === "custom" ? d.customName : null,
          lat: latVal,
          lng: lngVal,
          jobDescription: d.jobDescription
        })

        if (d.category === "custom" && d.saveAsSite && d.customName && d.coordinates) {
          const newSiteRef = doc(collection(db, "sites"))
          await setDoc(newSiteRef, {
            id: newSiteRef.id,
            name: d.customName,
            address: "",
            latitude: latVal,
            longitude: lngVal,
            projectTypeTag: d.locationType,
            status: "Active",
            isUserAdded: true,
            addedBy: user.email,
            addedByName: profile?.name || user.email,
            createdAt: serverTimestamp()
          })
          toast({ title: "บันทึกสถานที่แล้ว", description: `บันทึก ${d.customName} เข้าสู่รายการโปรดแล้ว` })
        }
      }

      await updateDoc(doc(db, "vehicleRequests", editingReq.id), {
        requestDate: editFormData.requestDate,
        requestTime: editFormData.requestTime,
        destinations: parsedDestinations,
        note: editFormData.note,
        updatedAt: serverTimestamp()
      })

      toast({ title: "แก้ไขสำเร็จ", description: `อัปเดตข้อมูลคำขอ ${editingReq.requestId} เรียบร้อยแล้ว` })
      setIsEditOpen(false)
      setEditingReq(null)
    } catch (e) {
      toast({ title: "ผิดพลาด", description: "ไม่สามารถบันทึกการแก้ไขได้", variant: "destructive" })
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleClearAllData = async () => {
    if (profile?.role !== 'admin') return
    setIsClearing(true)
    try {
      const batch = writeBatch(db)
      const snapshot = await getDocs(collection(db, "vehicleRequests"))
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref)
      })
      await batch.commit()
      toast({ title: "ล้างข้อมูลสำเร็จ", description: "ลบข้อมูลคำขอรถทั้งหมดเรียบร้อยแล้ว" })
      setIsClearConfirmOpen(false)
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถลบข้อมูลได้", variant: "destructive" })
    } finally {
      setIsClearing(false)
    }
  }

  if (isUserLoading || isProfileLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-accent" />
      </div>
    )
  }

  const isStaff = profile?.role === 'admin' || profile?.role === 'dispatcher'
  const isAdmin = profile?.role === 'admin'

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">รอดำเนินการ</Badge>
      case "partial":
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20">จัดบางส่วน</Badge>
      case "approved":
        return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">จัดรถแล้ว</Badge>
      case "rejected":
        return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">ไม่อนุมัติ</Badge>
      case "cancelled":
        return <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/20">ยกเลิกแล้ว</Badge>
      default:
        return null
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">ระบบขอใช้รถ</h2>
          <p className="text-sm md:text-base text-muted-foreground">ส่งคำขอและจัดการการขอใช้รถสำหรับงานขนส่งและก่อสร้าง</p>
        </div>
        {isAdmin && (
          <Button 
            variant="outline" 
            className="border-red-500/50 text-red-500 hover:bg-red-500/10 h-10 w-full sm:w-auto"
            onClick={() => setIsClearConfirmOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" /> ล้างข้อมูลทั้งหมด
          </Button>
        )}
      </div>

      <AlertDialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-500">ต้องการลบข้อมูลคำขอรถทั้งหมดใช่หรือไม่?</AlertDialogTitle>
            <AlertDialogDescription>
              การกระทำนี้จะลบรายการคำขอใช้รถ (Vehicle Requests) ทั้งหมดออกจากระบบ และไม่สามารถกู้คืนได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleClearAllData}
              className="bg-red-500 hover:bg-red-600"
              disabled={isClearing}
            >
              {isClearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              ยืนยันลบทั้งหมด
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isCancelConfirmOpen} onOpenChange={setIsCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-500">ยืนยันการยกเลิกคำขอใช้รถ</AlertDialogTitle>
            <AlertDialogDescription>
              คุณต้องการยกเลิกคำขอ <span className="font-bold text-white">{reqToCancel?.requestId}</span> ใช่หรือไม่? การกระทำนี้ไม่สามารถยกเลิกได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReqToCancel(null)}>ปิด</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleCancelRequest}
              className="bg-red-500 hover:bg-red-600"
            >
              ยืนยันยกเลิก
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Edit className="h-5 w-5 text-accent" /> แก้ไขคำขอ {editingReq?.requestId}
            </DialogTitle>
            <DialogDescription>
              คุณสามารถปรับเปลี่ยนข้อมูลการส่งของและวันเวลาได้
            </DialogDescription>
          </DialogHeader>

          {editFormData && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>วันที่ต้องการรถ</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full h-11 justify-start text-left font-normal bg-background",
                          !editFormData.requestDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 text-accent" />
                        {editFormData.requestDate ? format(new Date(editFormData.requestDate), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={editFormData.requestDate ? new Date(editFormData.requestDate) : undefined}
                        onSelect={(date) => setEditFormData({...editFormData, requestDate: date ? format(date, "yyyy-MM-dd") : ""})}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>เวลาที่ต้องการ</Label>
                  <div className="relative">
                    <Input 
                      placeholder="08:30" 
                      className="h-11 pr-8"
                      value={editFormData.requestTime}
                      onChange={(e) => setEditFormData({...editFormData, requestTime: e.target.value})}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none font-bold">
                      น.
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="font-bold">จุดหมายปลายทาง ({editFormData.destinations.length}/10)</Label>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="border-accent text-accent"
                    onClick={() => setEditFormData({
                      ...editFormData,
                      destinations: [...editFormData.destinations, { id: `new-${Date.now()}`, type: "site", category: "site", searchTerm: "", siteId: "", siteName: "", customName: "", coordinates: "", jobDescription: "", saveAsSite: false, locationType: "ไซน์งาน" }]
                    })}
                  >
                    <Plus className="h-4 w-4 mr-2" /> เพิ่มจุดหมาย
                  </Button>
                </div>

                <div className="space-y-4">
                  {editFormData.destinations.map((dest: any, idx: number) => {
                    const category = CATEGORIES.find(c => c.id === dest.category);
                    const filteredSites = sites?.filter(s => {
                      if (dest.category === 'custom') return false;
                      const matchesType = category?.types.includes(s.projectTypeTag);
                      const matchesSearch = s.name.toLowerCase().includes(dest.searchTerm.toLowerCase());
                      return matchesType && matchesSearch;
                    }) || [];

                    // Explicit helper for edit mode updates
                    const updateEditDest = (updates: any) => {
                      const newDests = [...editFormData.destinations];
                      newDests[idx] = { ...newDests[idx], ...updates };
                      
                      // Auto-fill coordinates if siteId changes
                      if (updates.siteId !== undefined && newDests[idx].category !== "custom") {
                        const site = sites?.find(s => s.id === updates.siteId);
                        if (site) {
                          newDests[idx].siteName = site.name;
                          newDests[idx].coordinates = site.latitude && site.longitude ? `${site.latitude}, ${site.longitude}` : "";
                        }
                      }
                      setEditFormData({...editFormData, destinations: newDests});
                    };

                    return (
                      <Card key={dest.id} className="bg-secondary/20 border-border/50 p-4 space-y-4">
                        <div className="flex flex-wrap gap-1.5 p-1 bg-background/40 rounded-lg">
                          {CATEGORIES.map(cat => (
                            <Button 
                              key={cat.id}
                              type="button"
                              variant={dest.category === cat.id ? "default" : "ghost"}
                              size="sm"
                              className={cn(
                                "h-8 text-[10px] px-2.5 flex items-center gap-1.5 transition-all",
                                dest.category === cat.id ? "bg-accent text-white shadow-sm" : "text-muted-foreground hover:bg-secondary/60"
                              )}
                              onClick={() => {
                                updateEditDest({
                                  category: cat.id,
                                  siteId: "",
                                  siteName: "",
                                  customName: "",
                                  coordinates: "",
                                  searchTerm: ""
                                });
                              }}
                            >
                              <cat.icon className="h-3.5 w-3.5" /> {cat.label}
                            </Button>
                          ))}
                          <div className="flex-1" />
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={editFormData.destinations.length <= 1}
                            onClick={() => {
                              const newDests = editFormData.destinations.filter((_: any, i: number) => i !== idx)
                              setEditFormData({...editFormData, destinations: newDests})
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        {dest.category !== 'custom' ? (
                          <div className="space-y-4 animate-in fade-in duration-200">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input 
                                placeholder="พิมพ์เพื่อค้นหาสถานที่..." 
                                className="pl-10 h-10 text-xs bg-background/50"
                                value={dest.searchTerm}
                                onChange={(e) => updateEditDest({ searchTerm: e.target.value })}
                              />
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <Label className="text-[10px] uppercase text-muted-foreground font-bold">เลือกสถานที่</Label>
                                <Select 
                                  value={dest.siteId} 
                                  onValueChange={(val) => updateEditDest({ siteId: val })}
                                >
                                  <SelectTrigger className="h-11 bg-background/50">
                                    <SelectValue placeholder={`-- ค้นหา/เลือก${CATEGORIES.find(c => c.id === dest.category)?.label} --`} />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-64">
                                    {filteredSites.length > 0 ? filteredSites.map(s => (
                                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                    )) : (
                                      <div className="p-4 text-center text-xs text-muted-foreground">ไม่พบข้อมูลในหมวดหมู่นี้</div>
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-[10px] uppercase text-muted-foreground font-bold">พิกัด</Label>
                                <Input className="h-11 bg-muted/20 border-dashed" value={dest.coordinates} placeholder="ดึงข้อมูลอัตโนมัติ" readOnly />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-top-1 duration-200">
                            <div className="space-y-1.5">
                              <Label className="text-[10px] uppercase text-muted-foreground font-bold">ชื่อสถานที่</Label>
                              <Input 
                                className="h-11 bg-background/50" 
                                value={dest.customName}
                                placeholder="เช่น บริษัท TMT อยุธยา"
                                onChange={(e) => updateEditDest({ customName: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <Label className="text-[10px] uppercase text-muted-foreground font-bold">พิกัด (lat, lng)</Label>
                                <Button 
                                  variant="link" 
                                  className="h-auto p-0 text-[10px] text-accent"
                                  onClick={() => window.open('https://maps.google.com', '_blank')}
                                >
                                  <ExternalLink className="mr-1 h-3 w-3" /> แผนที่
                                </Button>
                              </div>
                              <Input 
                                className="h-11 bg-background/50" 
                                value={dest.coordinates}
                                placeholder="14.0815, 100.7129"
                                onChange={(e) => updateEditDest({ coordinates: e.target.value })}
                              />
                            </div>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <Label className="text-[10px] uppercase text-muted-foreground font-bold">ลักษณะงานที่ต้องทำ</Label>
                          <Textarea 
                            className="min-h-[80px] bg-background/30 text-sm" 
                            placeholder="รายละเอียดงาน เช่น ส่งอุปกรณ์ไฟฟ้า, รับตัวอย่างวัสดุ"
                            style={{ resize: 'vertical' }}
                            value={dest.jobDescription}
                            onChange={(e) => updateEditDest({ jobDescription: e.target.value })}
                          />
                        </div>

                        {dest.category === "custom" && (
                          <div className="space-y-4 pt-4 border-t border-border/30">
                            <div className="flex items-center space-x-2">
                              <Checkbox 
                                id={`save-site-edit-${idx}`} 
                              checked={dest.saveAsSite}
                                onCheckedChange={(checked) => updateEditDest({ saveAsSite: !!checked })}
                              />
                              <Label htmlFor={`save-site-edit-${idx}`} className="text-xs font-bold text-accent cursor-pointer">
                                บันทึกสถานที่นี้เพื่อใช้ครั้งต่อไป
                              </Label>
                            </div>

                            {dest.saveAsSite && (
                              <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-200">
                                <Label className="text-[10px] uppercase text-muted-foreground font-bold">ประเภทสถานที่</Label>
                                <Select 
                                  value={dest.locationType} 
                                  onValueChange={(val) => updateEditDest({ locationType: val })}
                                >
                                  <SelectTrigger className="h-11 bg-background/50"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="ไซน์งาน">ไซน์งาน</SelectItem>
                                    <SelectItem value="ร้านค้า / ซัพพลายเออร์">ร้านค้า / ซัพพลายเออร์</SelectItem>
                                    <SelectItem value="ธนาคาร">ธนาคาร</SelectItem>
                                    <SelectItem value="บริษัท / หน่วยงานราชการ">บริษัท / หน่วยงานราชการ</SelectItem>
                                    <SelectItem value="อื่น ๆ">อื่น ๆ</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-bold">หมายเหตุ (ระบุถึงคนจัดรถ)</Label>
                <Textarea 
                  value={editFormData.note}
                  placeholder="ข้อมูลเพิ่มเติม..."
                  className="bg-background/40 min-h-[100px]"
                  onChange={(e) => setEditFormData({...editFormData, note: e.target.value})}
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-row gap-2 mt-4">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setIsEditOpen(false)}>ยกเลิก</Button>
            <Button 
              className="flex-1 h-11 bg-accent hover:bg-accent/90 shadow-md" 
              onClick={handleUpdateEdit}
              disabled={isSavingEdit}
            >
              {isSavingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              บันทึกการแก้ไข
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              myRequests.map((req: any) => (
                <Card key={req.id} className={cn(
                  "border-border/50 hover:border-accent/30 transition-all overflow-hidden group",
                  req.status === "cancelled" && "opacity-50 grayscale-[0.5]"
                )}>
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row">
                      <div className={cn(
                        "w-full sm:w-1.5 h-1.5 sm:h-auto shrink-0",
                        req.status === "pending" ? "bg-yellow-500" :
                        req.status === "partial" ? "bg-blue-500" :
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
                          
                          <div className="flex items-center gap-2">
                            {(req.status === "pending" || req.status === "partial") && req.userId === user?.uid && (
                              <>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-8 text-xs border-border/50 hover:border-accent hover:text-accent"
                                  onClick={() => handleOpenEdit(req)}
                                >
                                  <Edit className="h-3.5 w-3.5 mr-1.5" /> แก้ไข
                                </Button>
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
                              </>
                            )}
                            <div className="shrink-0">
                              {req.status === "pending" ? <AlertCircle className="h-5 w-5 text-yellow-500" /> :
                               req.status === "partial" ? <Clock className="h-5 w-5 text-blue-400" /> :
                               req.status === "approved" ? <CheckCircle2 className="h-5 w-5 text-green-500" /> :
                               req.status === "cancelled" ? <XCircle className="h-5 w-5 text-gray-400" /> :
                               <XCircle className="h-5 w-5 text-red-500" />}
                            </div>
                          </div>
                        </div>

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
                                    <p className="font-semibold text-foreground">{dest.siteName}</p>
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

                        {/* Notes Section for My Requests List */}
                        {req.note && req.note.trim() !== '' && (
                          <div style={{ 
                            marginTop: '8px', 
                            padding: '6px 10px', 
                            borderLeft: '3px solid #f97316',
                            backgroundColor: 'rgba(249, 115, 22, 0.08)',
                            borderRadius: '0 4px 4px 0'
                          }}>
                            <span style={{ fontSize: '12px', color: '#f97316', fontWeight: 500 }}>
                              📌 หมายเหตุผู้ขอ:
                            </span>
                            <span style={{ fontSize: '13px', color: '#e2e8f0', marginLeft: '6px' }}>
                              {req.note}
                            </span>
                          </div>
                        )}

                        {req.status === "approved" && req.tripId && (
                          <div className="bg-green-500/5 border border-green-500/20 p-3 rounded-lg flex items-center justify-between animate-in zoom-in-95">
                            <p className="text-xs text-green-500 font-medium">จัดสรรงานครบถ้วนแล้ว</p>
                            <Badge className="bg-green-600 text-white border-transparent">
                              Trip ID: {req.tripId}
                            </Badge>
                          </div>
                        )}

                        {req.status === "cancelled" && (
                          <div className="bg-gray-500/5 border border-gray-500/20 p-3 rounded-lg animate-in slide-in-from-top-1">
                            <p className="text-xs text-gray-400 font-bold">ยกเลิกแล้วเมื่อ: {req.cancelledAt?.toDate()?.toLocaleString('th-TH')}</p>
                          </div>
                        )}

                        {req.status === "rejected" && req.rejectReason && (
                          <div className="bg-red-500/5 border border-red-500/20 p-3 rounded-lg animate-in slide-in-from-top-1">
                            <p className="text-xs text-red-500 font-bold mb-1">เหตุผลที่ไม่นุมัติ:</p>
                            <p className="text-xs text-muted-foreground italic">"{req.rejectReason}"</p>
                          </div>
                        )}
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
    </div>
  )
}
