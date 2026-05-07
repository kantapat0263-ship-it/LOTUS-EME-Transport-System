"use client"

import * as React from "react"
import { RequestForm } from "@/components/requests/RequestForm"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  ClipboardList, 
  History, 
  Settings2, 
  Loader2, 
  Calendar, 
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
  Trash2
} from "lucide-react"
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from "@/firebase"
import { doc, collection, query, orderBy, onSnapshot, updateDoc, serverTimestamp, getDocs, writeBatch } from "firebase/firestore"
import { UserProfile } from "@/types/models"
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
import { Loader } from "@googlemaps/js-api-loader"

// Inline modified RequestManager to support "Manage Vehicle" flow and Split Trip
function InlineRequestManager({ userRole }: { userRole?: string }) {
  const { toast } = useToast()
  const db = useFirestore()
  const router = useRouter()
  const { user } = useUser()
  
  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: companySettings } = useDoc<any>(settingsRef)

  const requestsRef = useMemoFirebase(() => query(
    collection(db, "vehicleRequests"), 
    orderBy("createdAt", "desc")
  ), [db])

  const { data: requests, isLoading } = useCollection<any>(requestsRef)

  const [selectedReq, setSelectedReq] = React.useState<any | null>(null)
  const [isDetailOpen, setIsDetailOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [isProcessing, setIsStaffProcessing] = React.useState(false)
  const [searchTerm, setSearchTerm] = React.useState("")
  
  // Clear Data State
  const [isClearConfirmOpen, setIsClearConfirmOpen] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)
  
  // Split Trip States
  const [selectedDestIndexes, setSelectedDestIndexes] = React.useState<Set<number>>(new Set())
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const [modalMap, setModalMap] = React.useState<google.maps.Map | null>(null)
  const [modalMarkers, setModalMarkers] = React.useState<google.maps.Marker[]>([])

  // Reset selection and map markers when request changes or modal opens
  React.useEffect(() => {
    if (selectedReq) {
      const assigned = selectedReq.assignedDestinations || []
      const available = selectedReq.destinations
        .map((_: any, i: number) => i)
        .filter((i: number) => !assigned.includes(i))
      
      setSelectedDestIndexes(new Set(available))
    }
  }, [selectedReq])

  // Map initialization and marker rendering with delay fix
  React.useEffect(() => {
    let mapTimeout: NodeJS.Timeout;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || companySettings?.googleMapsApiKeyReference;
    
    if (isDetailOpen && selectedReq && apiKey) {
      // Small delay to ensure the modal and its content area are rendered
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
            // Trigger resize and adjust zoom for single markers
            google.maps.event.addListenerOnce(newMap, "idle", () => {
              google.maps.event.trigger(newMap, 'resize');
              if (newMap.getZoom()! > 15) newMap.setZoom(15);
            });
          }

          setModalMap(newMap);
          setModalMarkers(markers);
        });
      }, 400); // 400ms delay to be safe
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
      assignedIndexes: Array.from(selectedDestIndexes)
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
                (req.status === "pending" || req.status === "partial") && "border-yellow-500/30 bg-yellow-500/5 shadow-lg shadow-yellow-500/5"
              )}
              onClick={() => {
                setSelectedReq(req)
                setIsDetailOpen(true)
              }}
            >
              {(req.status === "pending" || req.status === "partial") && (
                <div className={cn("absolute top-0 left-0 w-1 h-full", req.status === "partial" ? "bg-blue-500" : "bg-yellow-500")} />
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
                    <span className="font-bold text-foreground">{req.requestDate}</span>
                    <span>{req.requestTime}</span>
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

      {/* Clear Confirmation Dialog */}
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
              ตรวจสอบข้อมูลพิกัดและเลือกจุดหมายที่ต้องการจัดรถ
            </DialogDescription>
          </DialogHeader>

          {selectedReq && (
            <div className="space-y-6 py-4">
              {/* Modal Map Fix */}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-secondary/30 p-4 rounded-xl border border-border/50">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">ผู้ขอใช้รถ</p>
                  <p className="text-sm font-bold text-white">{selectedReq.requestedBy}</p>
                  <p className="text-[10px] text-muted-foreground">{selectedReq.requestedByEmail}</p>
                </div>
                <div className="space-y-1 sm:text-right">
                  <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">วัน/เวลาที่ต้องการ</p>
                  <p className="text-sm font-bold text-accent">{selectedReq.requestDate} @ {selectedReq.requestTime}</p>
                  <p className="text-[10px] text-muted-foreground">ส่งเมื่อ: {selectedReq.createdAt?.toDate()?.toLocaleString('th-TH')}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold flex items-center gap-2 text-white">
                    <MapPin className="h-4 w-4 text-accent" /> จุดหมายปลายทาง ({selectedReq.destinations.length})
                  </p>
                  <div className="flex gap-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 text-[10px] font-bold text-muted-foreground"
                      onClick={() => {
                        const assigned = selectedReq.assignedDestinations || []
                        const available = selectedReq.destinations
                          .map((_: any, i: number) => i)
                          .filter((i: number) => !assigned.includes(i))
                        setSelectedDestIndexes(new Set(available))
                      }}
                    >
                      เลือกทั้งหมด
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 text-[10px] font-bold text-muted-foreground"
                      onClick={() => setSelectedDestIndexes(new Set())}
                    >
                      ล้างการเลือก
                    </Button>
                  </div>
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
                            disabled={isAssigned}
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
                                {dest.jobDescription || "ไม่ได้ระบุลักษณะงาน"}
                              </div>
                            </div>
                            {dest.lat && dest.lng && (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-9 w-9 p-0 border-accent/30 text-accent hover:bg-accent hover:text-white"
                                onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${dest.lat},${dest.lng}`, '_blank')}
                                title="ดูพิกัดบน Google Maps"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedReq.note && (
                <div className="space-y-2">
                  <p className="text-sm font-bold flex items-center gap-2 text-white">
                    <MessageSquare className="h-4 w-4 text-accent" /> หมายเหตุเพิ่มเติม
                  </p>
                  <div className="p-3 bg-accent/5 border border-accent/20 rounded-xl text-sm italic text-muted-foreground leading-relaxed">
                    "{selectedReq.note}"
                  </div>
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
                  selectedReq.status === "approved" ? "bg-green-500/10 border-green-500/30 text-green-500" : "bg-red-500/10 border-red-500/30 text-red-500"
                )}>
                  <div className="flex items-center justify-center gap-2 font-bold text-lg">
                    {selectedReq.status === "approved" ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
                    {selectedReq.status === "approved" ? "จัดรถครบถ้วนแล้ว" : "ไม่อนุมัติ"}
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

  // Clear Data State
  const [isClearConfirmOpen, setIsClearConfirmOpen] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)

  // Fetch all requests for monitoring
  React.useEffect(() => {
    if (isUserLoading || !user || !db) return

    setIsDataLoading(true)
    const q = query(
      collection(db, "vehicleRequests"), 
      orderBy("createdAt", "desc")
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const results = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))
      setMyRequests(results)
      setIsDataLoading(false)
    }, (error) => {
      console.error("Firestore error in RequestsPage:", error)
      setIsDataLoading(false)
    })

    return () => unsubscribe()
  }, [user, isUserLoading, db])

  // Automatically switch tabs when a new request is detected
  const prevCount = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (myRequests && prevCount.current !== null && myRequests.length > prevCount.current) {
      setActiveTab("list")
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    if (myRequests) {
      prevCount.current = myRequests.length
    }
  }, [myRequests])

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

      {/* Global Admin Confirmation Dialog */}
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
                <Card key={req.id} className="border-border/50 hover:border-accent/30 transition-all overflow-hidden group">
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row">
                      <div className={cn(
                        "w-full sm:w-1.5 h-1.5 sm:h-auto shrink-0",
                        req.status === "pending" ? "bg-yellow-500" :
                        req.status === "partial" ? "bg-blue-500" :
                        req.status === "approved" ? "bg-green-500" : "bg-red-500"
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
                                <Calendar className="h-3.5 w-3.5" /> {req.requestDate}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5" /> {req.requestTime}
                              </div>
                              <div className="flex items-center gap-1.5 text-foreground font-medium">
                                <MapPin className="h-3.5 w-3.5 text-accent" /> {req.destinations?.length || 0} จุดหมาย
                              </div>
                              <div className="flex items-center gap-1.5">
                                <UserIcon className="h-3.5 w-3.5" /> {req.requestedBy}
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0">
                            {req.status === "pending" ? <AlertCircle className="h-5 w-5 text-yellow-500" /> :
                             req.status === "partial" ? <Clock className="h-5 w-5 text-blue-400" /> :
                             req.status === "approved" ? <CheckCircle2 className="h-5 w-5 text-green-500" /> :
                             <XCircle className="h-5 w-5 text-red-500" />}
                          </div>
                        </div>

                        <Separator className="bg-border/50" />

                        <div className="grid grid-cols-1 gap-3">
                          {req.destinations?.map((dest: any, idx: number) => {
                            const isAssigned = (req.assignedDestinations || []).includes(idx);
                            return (
                              <div key={idx} className={cn("flex gap-3 text-sm", isAssigned && "opacity-50")}>
                                <div className={cn("font-bold min-w-[20px]", isAssigned ? "text-green-500" : "text-accent")}>
                                  {isAssigned ? <Check className="h-4 w-4" /> : `${idx + 1}.`}
                                </div>
                                <div className="space-y-0.5">
                                  <p className="font-semibold text-foreground">{dest.siteName}</p>
                                  <p className="text-xs text-muted-foreground">{dest.jobDescription || "ไม่ได้ระบุลักษณะงาน"}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {req.status === "approved" && req.tripId && (
                          <div className="bg-green-500/5 border border-green-500/20 p-3 rounded-lg flex items-center justify-between animate-in zoom-in-95">
                            <p className="text-xs text-green-500 font-medium">จัดสรรงานครบถ้วนแล้ว</p>
                            <Badge className="bg-green-600 text-white border-transparent">
                              Trip ID: {req.tripId}
                            </Badge>
                          </div>
                        )}

                        {req.status === "partial" && (
                          <div className="bg-blue-500/5 border border-blue-500/20 p-3 rounded-lg flex items-center justify-between animate-in slide-in-from-left-2">
                            <p className="text-xs text-blue-400 font-medium">จัดรถแล้วบางจุด รอจุดที่เหลือ...</p>
                            <Badge variant="outline" className="border-blue-500/50 text-blue-400">
                              สถานะ: กึ่งสำเร็จ
                            </Badge>
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
            <InlineRequestManager userRole={profile?.role} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
