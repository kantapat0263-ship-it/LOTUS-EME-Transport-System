
"use client"

import * as React from "react"
import { useFirestore, useCollection, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, orderBy, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  XCircle,
  User as UserIcon,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Search
} from "lucide-react"
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
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

interface VehicleRequest {
  id: string;
  requestId: string;
  requestDate: string;
  requestTime: string;
  requestedBy: string;
  requestedByEmail: string;
  destinations: any[];
  status: "pending" | "approved" | "rejected";
  createdAt: any;
  tripId?: string;
  rejectReason?: string;
  note?: string;
}

export function RequestManager() {
  const { toast } = useToast()
  const db = useFirestore()
  
  const requestsRef = useMemoFirebase(() => query(
    collection(db, "vehicleRequests"), 
    orderBy("createdAt", "desc")
  ), [db])

  const { data: requests, isLoading } = useCollection<VehicleRequest>(requestsRef)

  const [selectedReq, setSelectedReq] = React.useState<VehicleRequest | null>(null)
  const [isDetailOpen, setIsDetailOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [tripId, setTripId] = React.useState("")
  const [isProcessing, setIsStaffProcessing] = React.useState(false)
  const [searchTerm, setSearchTerm] = React.useState("")

  const filteredRequests = requests?.filter(req => 
    req.requestId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    req.requestedBy.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  const handleUpdateStatus = async (status: "approved" | "rejected") => {
    if (!selectedReq) return
    
    if (status === "rejected" && !rejectReason.trim()) {
      toast({ title: "ระบุเหตุผล", description: "กรุณาระบุเหตุผลที่ไม่นุมัติ", variant: "destructive" })
      return
    }

    setIsStaffProcessing(true)
    try {
      const ref = doc(db, "vehicleRequests", selectedReq.id)
      await updateDoc(ref, {
        status,
        rejectReason: status === "rejected" ? rejectReason : null,
        tripId: status === "approved" ? (tripId || null) : null,
        updatedAt: serverTimestamp()
      })
      toast({ title: "ดำเนินการสำเร็จ", description: `คำขอ ${selectedReq.requestId} ถูก ${status === "approved" ? 'อนุมัติ' : 'ปฏิเสธ'} แล้ว` })
      setIsDetailOpen(false)
      setSelectedReq(null)
      setRejectReason("")
      setTripId("")
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
          className="pl-10 bg-secondary/20"
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
              ตรวจสอบข้อมูลพิกัดและรายละเอียดงานเพื่อดำเนินการอนุมัติ
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
                      <Label className="text-xs font-bold uppercase tracking-wider">รหัส Trip ID (ถ้ามี)</Label>
                      <Input 
                        placeholder="เช่น T-1234 (สำหรับเชื่อมโยงแผนงาน)"
                        className="bg-secondary/20 h-11"
                        value={tripId}
                        onChange={(e) => setTripId(e.target.value)}
                      />
                    </div>
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
                      onClick={() => handleUpdateStatus("rejected")}
                      disabled={isProcessing}
                    >
                      <XCircle className="mr-2 h-4 w-4" /> ปฏิเสธคำขอ
                    </Button>
                    <Button 
                      className="flex-[2] h-12 bg-green-600 hover:bg-green-700 shadow-lg shadow-green-900/20" 
                      onClick={() => handleUpdateStatus("approved")}
                      disabled={isProcessing}
                    >
                      {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      อนุมัติคำขอรถ
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
                    {selectedReq.status === "approved" ? "อนุมัติแล้ว" : "ไม่อนุมัติ"}
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
