
"use client"

import * as React from "react"
import { useFirestore, useCollection, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy } from "firebase/firestore"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  XCircle,
  ExternalLink
} from "lucide-react"
import { cn } from "@/lib/utils"

interface RequestDestination {
  type: string;
  siteName: string;
  jobDescription: string;
}

interface VehicleRequest {
  id: string;
  requestId: string;
  requestDate: string;
  requestTime: string;
  requestedBy: string;
  requestedByEmail: string;
  destinations: RequestDestination[];
  status: "pending" | "approved" | "rejected";
  createdAt: any;
  tripId?: string;
  rejectReason?: string;
}

export function RequestList() {
  const db = useFirestore()
  const { user } = useUser()

  // Filter by current user's email for "My Requests"
  const requestsRef = useMemoFirebase(() => (db && user) ? 
    query(
      collection(db, "vehicleRequests"), 
      where("requestedByEmail", "==", user.email),
      orderBy("createdAt", "desc")
    ) : null, 
  [db, user])

  const { data: requests, isLoading } = useCollection<VehicleRequest>(requestsRef)

  const getStatusBadge = (status: VehicleRequest["status"]) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">รอดำเนินการ</Badge>
      case "approved":
        return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">อนุมัติแล้ว</Badge>
      case "rejected":
        return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">ไม่อนุมัติ</Badge>
    }
  }

  const getStatusIcon = (status: VehicleRequest["status"]) => {
    switch (status) {
      case "pending":
        return <AlertCircle className="h-5 w-5 text-yellow-500" />
      case "approved":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case "rejected":
        return <XCircle className="h-5 w-5 text-red-500" />
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {requests && requests.length > 0 ? (
        requests.map((req) => (
          <Card key={req.id} className="border-border/50 hover:border-accent/30 transition-all overflow-hidden group">
            <CardContent className="p-0">
              <div className="flex flex-col sm:flex-row">
                {/* Side Status Bar */}
                <div className={cn(
                  "w-full sm:w-1.5 h-1.5 sm:h-auto",
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
                          <Calendar className="h-3 w-3" /> {req.requestDate}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3" /> {req.requestTime}
                        </div>
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                          {req.destinations.length} จุดหมาย
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(req.status)}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {req.destinations.slice(0, 2).map((dest, idx) => (
                      <div key={idx} className="bg-secondary/20 p-3 rounded-lg flex gap-3">
                        <MapPin className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                        <div className="overflow-hidden">
                          <p className="text-sm font-semibold truncate">{dest.siteName}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{dest.jobDescription || "ไม่ได้ระบุลักษณะงาน"}</p>
                        </div>
                      </div>
                    ))}
                    {req.destinations.length > 2 && (
                      <div className="col-span-full text-[10px] text-center text-muted-foreground">
                        + และอีก {req.destinations.length - 2} จุดหมาย
                      </div>
                    )}
                  </div>

                  {req.status === "approved" && req.tripId && (
                    <div className="bg-green-500/5 border border-green-500/20 p-3 rounded-lg flex items-center justify-between">
                      <p className="text-xs text-green-500 font-medium">เที่ยววิ่งได้รับการจัดสรรแล้ว</p>
                      <Badge variant="outline" className="bg-green-500 text-white border-transparent">
                        Trip ID: {req.tripId}
                      </Badge>
                    </div>
                  )}

                  {req.status === "rejected" && req.rejectReason && (
                    <div className="bg-red-500/5 border border-red-500/20 p-3 rounded-lg">
                      <p className="text-xs text-red-500 font-bold mb-1">เหตุผลที่ไม่นุมัติ:</p>
                      <p className="text-xs text-muted-foreground">"{req.rejectReason}"</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        <div className="text-center py-12 space-y-4 bg-secondary/10 rounded-xl border border-dashed border-border/50">
          <div className="bg-secondary/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
            <ClipboardList className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-foreground font-semibold">ไม่พบรายการคำขอ</p>
            <p className="text-xs text-muted-foreground">เริ่มส่งคำขอใช้รถใหม่ได้ที่แท็บ "ใบขอใช้รถ"</p>
          </div>
        </div>
      )}
    </div>
  )
}
