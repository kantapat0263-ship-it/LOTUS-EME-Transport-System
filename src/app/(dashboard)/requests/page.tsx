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

const getStatusBadge = (status: string) => {
  const config: any = {
    'pending': { label: 'รอดำเนินการ', color: 'bg-orange-500', textColor: 'text-orange-500', dot: true },
    'in_progress': { label: 'กำลังดำเนินการ', color: 'bg-blue-500', textColor: 'text-blue-400', dot: true },
    'partial': { label: 'จัดบางส่วน', color: 'bg-blue-500', textColor: 'text-blue-400', dot: true },
    'approved': { label: '✅ จัดรถแล้ว', color: 'bg-green-500', textColor: 'text-green-500', dot: false },
    'rejected': { label: '❌ ปฏิเสธ', color: 'bg-red-500', textColor: 'text-red-500', dot: false },
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
    where("status", "in", showCancelled ? ["pending", "partial", "in_progress", "cancelled"] : ["pending", "partial", "in_progress"])
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

  const [selectedReqId, setSelectedReqId] = React.useState<string | null>(null)
  const [isDetailOpen, setIsDetailOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [isProcessing, setIsStaffProcessing] = React.useState(false)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [isClearConfirmOpen, setIsClearConfirmOpen] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)
  const [selectedDestIndexes, setSelectedDestIndexes] = React.useState<Set<number>>(new Set())
  
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapInstanceRef = React.useRef<google.maps.Map | null>(null)
  const markersRef = React.useRef<google.maps.Marker[]>([])

  const [stopNotes, setStopNotes] = React.useState<Record<string, string>>({})
  const [isSavingNote, setIsSavingNote] = React.useState<number | null>(null)

  const selectedReq = React.useMemo(() => {
    if (!selectedReqId) return null
    return requests.find(r => r.id === selectedReqId) || null
  }, [selectedReqId, requests])

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

  // Improved map effect to prevent flickering and interaction issues
  React.useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || companySettings?.googleMapsApiKeyReference;
    
    if (!isDetailOpen || !selectedReq || !apiKey) {
      // Cleanup when dialog closes
      markersRef.current.forEach(m => m.setMap(null));
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
        
        // Re-initialize map or reuse
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
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
    };
  }, [isDetailOpen, selectedReqId, companySettings?.googleMapsApiKeyReference]); // Reduced dependencies

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
                (req.status === "pending" || req.status === "in_progress" || req.status === "partial") && "border-accent/30 bg-accent/5 shadow-lg shadow-accent/5",
                req.status === "cancelled" && "opacity-50 grayscale-[0.5]"
              )}
              onClick={() => {
                setSelectedReqId(req.id)
                setIsDetailOpen(true)
              }}
            >
              {(req.status === "pending" || req.status === "in_progress" || req.status === "partial" || req.status === "cancelled") && (
                <div className={cn(
                  "absolute top-0 left-0 w-1 h-full", 
                  req.status === "partial" ? "bg-blue-500" : 
                  req.status === "cancelled" ? "bg-gray-500" : 
                  req.status === "in_progress" ? "bg-blue-500" : "bg-orange-500"
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

              {(selectedReq.status === "pending" || selectedReq.status === "partial" || selectedReq.status === "in_progress") ? (
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
    </div>
  )
}

export default function RequestsPage() {
  const { user } = useUser()
  const db = useFirestore()
  const { toast } = useToast()
  
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef)

  const [activeTab, setActiveTab] = React.useState("form")
  const [isCancelOpen, setIsCancelOpen] = React.useState(false)
  const [reqToCancel, setReqToCancel] = React.useState<any>(null)

  const myRequestsRef = useMemoFirebase(() => (db && user) ? query(
    collection(db, "vehicleRequests"),
    where("userId", "==", user.uid)
  ) : null, [db, user])
  
  const { data: myRequests, isLoading: isDataLoading } = useCollection<any>(myRequestsRef)

  const isStaff = profile?.role === 'admin' || profile?.role === 'dispatcher'

  const handleOpenEdit = (req: any) => {
    // Logic for editing a request if needed, otherwise this is a placeholder
    toast({ title: "Coming soon", description: "ระบบแก้ไขคำขอกำลังอยู่ในการพัฒนา" })
  }

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
                <Card key={req.id} className={cn(
                  "border-border/50 hover:border-accent/30 transition-all overflow-hidden group",
                  req.status === "cancelled" && "opacity-50 grayscale-[0.5]"
                )}>
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row">
                      <div className={cn(
                        "w-full sm:w-1.5 h-1.5 sm:h-auto shrink-0",
                        req.status === "pending" ? "bg-orange-500" :
                        (req.status === "in_progress" || req.status === "partial") ? "bg-blue-500" :
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
                            {(req.status === "pending" || req.status === "partial" || req.status === "in_progress") && req.userId === user?.uid && (
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
    </div>
  )
}
