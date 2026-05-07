
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
  ChevronRight
} from "lucide-react"
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from "@/firebase"
import { doc, collection, query, where, orderBy } from "firebase/firestore"
import { UserProfile } from "@/types/models"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export default function RequestsPage() {
  const { user } = useUser()
  const db = useFirestore()
  const [activeTab, setActiveTab] = React.useState("form")
  
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef)

  // Fetch My Requests for the "My Requests" tab logic
  const myRequestsQuery = useMemoFirebase(() => (db && user) ? 
    query(
      collection(db, "vehicleRequests"), 
      where("requestedByEmail", "==", user.email),
      orderBy("createdAt", "desc")
    ) : null, 
  [db, user])

  const { data: myRequests, isLoading: isLoadingRequests } = useCollection(myRequestsQuery)

  // Auto-switch to "list" tab when a new request is detected
  const prevCount = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (myRequests && prevCount.current !== null && myRequests.length > prevCount.current) {
      setActiveTab("list")
    }
    if (myRequests) {
      prevCount.current = myRequests.length
    }
  }, [myRequests])

  if (isProfileLoading) {
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
        return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">อนุมัติแล้ว</Badge>
      case "rejected":
        return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">ไม่อนุมัติ</Badge>
      default:
        return null
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending": return <AlertCircle className="h-5 w-5 text-yellow-500" />
      case "approved": return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case "rejected": return <XCircle className="h-5 w-5 text-red-500" />
      default: return null
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
            {isLoadingRequests ? (
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
                            {getStatusIcon(req.status)}
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
                  <History className="h-8 w-8 text-muted-foreground" />
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
            <RequestManager />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
