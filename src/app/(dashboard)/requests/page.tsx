"use client"

import * as React from "react"
import { RequestForm } from "@/components/requests/RequestForm"
import { RequestManager } from "@/components/requests/RequestManager"
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
  Truck
} from "lucide-react"
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from "@/firebase"
import { doc, collection, query, orderBy, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore"
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
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Inline modified RequestManager to support "Manage Vehicle" flow
function InlineRequestManager() {
  const { toast } = useToast()
  const db = useFirestore()
  const router = useRouter()
  const { user } = useUser()
  
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

  const filteredRequests = requests?.filter(req => 
    req.requestId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    req.requestedBy.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  const handleManageVehicle = () => {
    if (!selectedReq) return
    
    const pendingVR = {
      vrId: selectedReq.requestId,
      docId: selectedReq.id,
      requestDate: selectedReq.requestDate,
      requestTime: selectedReq.requestTime,
      requestedBy: selectedReq.requestedBy,
      destinations: selectedReq.destinations
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">รอดำเนินการ</Badge>
      case "approved": return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">อนุมัติแล้ว</Badge>
      case "rejected": return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">ไม่อนุมัติ</Badge>
      default: return null
    }
  }

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="ค้นหาด้วยรหัส VR หรือชื่อผู้ขอ..." 
          className="pl-10 bg-secondary/20 h-11"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredRequests.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRequests.map((req) => (
            <Card 
              key={req.id} 
              className={cn(
                "border-border/50 hover:border-accent/30 transition-all cursor-pointer group relative overflow-hidden",
                req.status === "pending" && "border-yellow-500/30 bg-yellow-500/5 shadow-lg shadow-yellow-500/5"
              )}
              onClick={() => {
                setSelectedReq(req)
                setIsDetailOpen(true)
              }}
            >
              {req.status === "pending" && (
                <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500" />
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

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-accent" /> รายละเอียดคำขอ {selectedReq?.requestId}
            </DialogTitle>
            <DialogDescription>
              ตรวจสอบข้อมูลพิกัดและรายละเอียดงานเพื่อดำเนินการจัดรถ
            </DialogDescription>
          </DialogHeader>

          {selectedReq && (
            <div className="space-y-6 py-4">
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
                <p className="text-sm font-bold flex items-center gap-2 text-white">
                  <MapPin className="h-4 w-4 text-accent" /> จุดหมายปลายทาง ({selectedReq.destinations.length})
                </p>
                <div className="space-y-3">
                  {selectedReq.destinations.map((dest: any, idx: number) => (
                    <div key={idx} className="bg-background/50 border border-border/50 p-4 rounded-xl relative overflow-hidden group/item">
                      <div className="absolute left-0 top-0 w-1 h-full bg-accent" />
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-accent group-hover/item:text-white transition-colors">{dest.siteName}</p>
                          <div className="mt-2 bg-secondary/20 p-2 rounded text-xs text-muted-foreground border border-dashed">
                            <span className="font-bold text-foreground text-[10px] block mb-1">รายละเอียดงาน:</span>
                            {dest.jobDescription || "ไม่ได้ระบุลักษณะงาน"}
                          </div>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-9 w-9 p-0 border-accent/30 text-accent hover:bg-accent hover:text-white"
                          onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${dest.lat},${dest.lng}`, '_blank')}
                          title="ดูพิกัดบน Google Maps"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
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

              {selectedReq.status === "pending" ? (
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
                      จัดรถสำหรับคำขอนี้
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
                    {selectedReq.status === "approved" ? "จัดรถเรียบร้อยแล้ว" : "ไม่อนุมัติ"}
                  </div>
                  {selectedReq.tripId && (
                    <Badge variant="outline" className="bg-green-500 text-white border-transparent">
                      Trip ID: {selectedReq.tripId}
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
  const [activeTab, setActiveTab] = React.useState("form")
  const [myRequests, setMyRequests] = React.useState<any[] | null>(null)
  const [isDataLoading, setIsDataLoading] = React.useState(false)
  
  const userProfileRef = useMemoFirebase(() => (db && user) ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef)

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
      console.log('Requests found:', results.length)
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

  if (isUserLoading || isProfileLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-accent" />
      </div>
    )
  }

  const isStaff = profile?.role === 'admin' || profile?.role === 'dispatcher'

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">รอดำเนินการ</Badge>
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
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">ระบบขอใช้รถ</h2>
        <p className="text-sm md:text-base text-muted-foreground">ส่งคำขอและจัดการการขอใช้รถสำหรับงานขนส่งและก่อสร้าง</p>
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
              myRequests.map((req: any) => (
                <Card key={req.id} className="border-border/50 hover:border-accent/30 transition-all overflow-hidden group">
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row">
                      <div className={cn(
                        "w-full sm:w-1.5 h-1.5 sm:h-auto shrink-0",
                        req.status === "pending" ? "bg-yellow-500" :
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
                             req.status === "approved" ? <CheckCircle2 className="h-5 w-5 text-green-500" /> :
                             <XCircle className="h-5 w-5 text-red-500" />}
                          </div>
                        </div>

                        <Separator className="bg-border/50" />

                        <div className="grid grid-cols-1 gap-3">
                          {req.destinations?.map((dest: any, idx: number) => (
                            <div key={idx} className="flex gap-3 text-sm">
                              <div className="font-bold text-accent min-w-[20px]">{idx + 1}.</div>
                              <div className="space-y-0.5">
                                <p className="font-semibold text-foreground">{dest.siteName}</p>
                                <p className="text-xs text-muted-foreground">{dest.jobDescription || "ไม่ได้ระบุลักษณะงาน"}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {req.status === "approved" && req.tripId && (
                          <div className="bg-green-500/5 border border-green-500/20 p-3 rounded-lg flex items-center justify-between animate-in zoom-in-95">
                            <p className="text-xs text-green-500 font-medium">จัดสรรงานแล้ว</p>
                            <Badge className="bg-green-600 text-white border-transparent">
                              Trip ID: {req.tripId}
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
            <InlineRequestManager />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
