"use client"

import * as React from "react"
import { useFirestore, useCollection, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, setDoc, serverTimestamp, getDocs, query, where } from "firebase/firestore"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { 
  Plus, 
  MapPin, 
  ExternalLink, 
  Loader2, 
  Send,
  Building2,
  Store,
  Landmark,
  Briefcase,
  Search,
  Calendar as CalendarIcon,
  Trash2,
  Info,
  Sparkles
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Site, UserProfile } from "@/types/models"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"
import { intelligentCargoDescriptionAssistant } from "@/ai/flows/cargo-description-assistant-flow"

interface DestinationRequest {
  id: string;
  category: "all" | "site" | "store" | "bank" | "company" | "custom";
  searchTerm: string;
  siteId: string;
  siteName: string;
  customName: string;
  coordinates: string;
  jobDescription: string;
  saveAsSite: boolean;
  locationType: string;
  requestTime: string;
}

const CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด', icon: Search, types: [] },
  { id: 'site', label: 'ไซต์งาน', icon: Building2, types: ['ไซต์งาน', 'ไซน์งาน', 'Electrical', 'Plumbing', 'HVAC', 'Mixed'] },
  { id: 'store', label: 'ร้านค้า', icon: Store, types: ['ร้านค้า / ซัพพลายเออร์'] },
  { id: 'bank', label: 'ธนาคาร', icon: Landmark, types: ['ธนาคาร'] },
  { id: 'company', label: 'บริษัท', icon: Briefcase, types: ['บริษัท / หน่วยงานราชการ'] },
  { id: 'custom', label: 'กำหนดเอง', icon: MapPin, types: [] },
] as const;

export function RequestForm() {
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()
  
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile } = useDoc<UserProfile>(userProfileRef)

  const sitesRef = useMemoFirebase(() => db ? collection(db, "sites") : null, [db])
  const { data: sites } = useCollection<Site>(sitesRef)

  const settingsRef = useMemoFirebase(() => db ? doc(db, "companySettings", "default") : null, [db])
  const { data: settings } = useDoc<any>(settingsRef)

  const role = profile?.role?.toLowerCase() || ''
  const isViewer = role !== 'admin' && role !== 'dispatcher'

  const [activeSuggestId, setActiveSuggestId] = React.useState<string | null>(null)

  // Real-time urgent request status
  const urgentRequestRef = useMemoFirebase(() => {
    if (!db || !user || !isViewer) return null
    const bangkokNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
    bangkokNow.setUTCDate(bangkokNow.getUTCDate() + 1)
    const y = bangkokNow.getUTCFullYear()
    const m = String(bangkokNow.getUTCMonth() + 1).padStart(2, '0')
    const d = String(bangkokNow.getUTCDate()).padStart(2, '0')
    const tomorrowStr = `${y}-${m}-${d}`
    return query(
      collection(db, "urgentRequests"),
      where("userId", "==", user.uid),
      where("requestedDate", "==", tomorrowStr)
    )
  }, [db, user, isViewer])

  const { data: urgentRequests } = useCollection<any>(urgentRequestRef)

  const urgentStatus = React.useMemo(() => {
    if (!urgentRequests || urgentRequests.length === 0) return null
    const latest = [...urgentRequests].sort((a: any, b: any) => 
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
    )[0]
    return latest?.status || null
  }, [urgentRequests])

  const minDateStr = React.useMemo(() => {
    const bangkokNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
    const closeHour = Number(settings?.requestCloseTime?.split(':')?.[0] || 16)
    const openHour = Number(settings?.requestOpenTime?.split(':')?.[0] || 8)
    const currentHour = bangkokNow.getUTCHours()
    const daysToAdd = !isViewer ? 1 : (currentHour >= closeHour || currentHour < openHour) ? 2 : 1
    bangkokNow.setUTCDate(bangkokNow.getUTCDate() + daysToAdd)
    return `${bangkokNow.getUTCFullYear()}-${String(bangkokNow.getUTCMonth() + 1).padStart(2, '0')}-${String(bangkokNow.getUTCDate()).padStart(2, '0')}`
  }, [settings, isViewer])

  const tomorrowStr = React.useMemo(() => {
    const bangkokNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
    bangkokNow.setUTCDate(bangkokNow.getUTCDate() + 1)
    const y = bangkokNow.getUTCFullYear()
    const m = String(bangkokNow.getUTCMonth() + 1).padStart(2, '0')
    const d = String(bangkokNow.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }, [])

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [urgentApprovalRequested, setUrgentApprovalRequested] = React.useState(false)
  const [isSendingUrgent, setIsSendingUrgent] = React.useState(false)
  const [requestedBy, setRequestedBy] = React.useState("")
  const [selectedDate, setSelectedDate] = React.useState("")
  const [isCalendarOpen, setIsCalendarOpen] = React.useState(false)
  const [note, setNote] = React.useState("")
  const [destinations, setDestinations] = React.useState<DestinationRequest[]>([
    { id: "1", category: "all", searchTerm: "", siteId: "", siteName: "", customName: "", coordinates: "", jobDescription: "", saveAsSite: false, locationType: "ไซต์งาน", requestTime: "08:30" }
  ])

  const bangkokHour = new Date(new Date().getTime() + 7 * 60 * 60 * 1000).getUTCHours();
  const isOutsideHours = bangkokHour >= (Number(settings?.requestCloseTime?.split(':')?.[0]) || 16) || 
                        bangkokHour < (Number(settings?.requestOpenTime?.split(':')?.[0]) || 8);
  
  const isSelectingTomorrow = selectedDate === tomorrowStr
  const isBlockedByUrgent = isViewer && isOutsideHours && isSelectingTomorrow && urgentStatus !== 'approved'

  React.useEffect(() => {
    if (profile) {
      if (!selectedDate || selectedDate < tomorrowStr) {
        setSelectedDate(minDateStr)
      }
    }
  }, [profile?.role, settings, minDateStr, tomorrowStr, selectedDate])

  React.useEffect(() => {
    if (profile) {
      setRequestedBy(profile.name || user?.displayName || "")
    }
  }, [profile, user])

  const handleRequestUrgentApproval = async () => {
    if (!user || !selectedDate) return

    if (urgentStatus === 'pending') {
      toast({ title: "รออนุมัติอยู่", description: "Dispatcher กำลังพิจารณาคำขอของคุณครับ" })
      return
    }
    if (urgentStatus === 'approved') {
      toast({ title: "ได้รับอนุมัติแล้ว", description: "กรอกใบขอรถได้เลยครับ" })
      return
    }

    setIsSendingUrgent(true)
    try {
      const urgentRef = doc(collection(db, "urgentRequests"))
      await setDoc(urgentRef, {
        id: urgentRef.id,
        requestedBy: requestedBy || profile?.name || user.email,
        requestedByEmail: user.email,
        userId: user.uid,
        requestedDate: selectedDate,
        status: "pending",
        createdAt: serverTimestamp()
      })
      setUrgentApprovalRequested(true)
      toast({ 
        title: "ส่งคำขออนุมัติแล้ว", 
        description: "รอ Dispatcher อนุมัติก่อนกรอกใบขอรถครับ" 
      })
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    } finally {
      setIsSendingUrgent(false)
    }
  }

  const updateDest = (id: string, updates: Partial<DestinationRequest>) => {
    setDestinations(prev => prev.map(d => {
      if (d.id === id) {
        let updated = { ...d, ...updates };
        
        if (updates.siteId !== undefined && updated.category !== "custom") {
          const site = sites?.find(s => s.id === updates.siteId);
          if (site) {
            updated.siteName = site.name;
            updated.coordinates = site.latitude && site.longitude ? `${site.latitude}, ${site.longitude}` : "";
          }
        }
        return updated;
      }
      return d;
    }))
  }

  const handleAiDescription = async (destId: string, currentDescription: string) => {
    if (!currentDescription) {
      toast({ title: "แจ้งเตือน", description: "กรุณาระบุลักษณะงานเบื้องต้น", variant: "destructive" })
      return
    }
    toast({ title: "กำลังประมวลผล", description: "AI กำลังช่วยคุณแยกรายการสินค้า..." })
    try {
      const result = await intelligentCargoDescriptionAssistant({ highLevelDescription: currentDescription })
      updateDest(destId, { jobDescription: result.detailedDescription })
      toast({ title: "สำเร็จ", description: "AI แยกรายการสินค้าให้เรียบร้อยแล้ว" })
    } catch (error) {
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถเรียกใช้งาน AI ได้ในขณะนี้", variant: "destructive" })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDate || !user) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุวันที่", variant: "destructive" })
      return
    }

    if (isViewer) {
      const bangkokSubmitTime = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
      const closeHour = Number(settings?.requestCloseTime?.split(':')?.[0] || 16)
      const openHour = Number(settings?.requestOpenTime?.split(':')?.[0] || 8)
      const currentBangkokHour = bangkokSubmitTime.getUTCHours()
      const isNowOutsideHours = currentBangkokHour >= closeHour || currentBangkokHour < openHour
      const daysToAdd = isNowOutsideHours ? 2 : 1
      bangkokSubmitTime.setUTCDate(bangkokSubmitTime.getUTCDate() + daysToAdd)
      const currentMinStr = `${bangkokSubmitTime.getUTCFullYear()}-${String(bangkokSubmitTime.getUTCMonth() + 1).padStart(2, '0')}-${String(bangkokSubmitTime.getUTCDate()).padStart(2, '0')}`
      if (selectedDate < currentMinStr) {
        // ตรวจสอบอนุมัติเร่งด่วนกรณีจะจองวันพรุ่งนี้
        const tomorrowStrInside = (() => {
          const dNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
          dNow.setUTCDate(dNow.getUTCDate() + 1)
          return `${dNow.getUTCFullYear()}-${String(dNow.getUTCMonth() + 1).padStart(2, '0')}-${String(dNow.getUTCDate()).padStart(2, '0')}`
        })()
        
        if (selectedDate === tomorrowStrInside) {
          const urgentSnap = await getDocs(query(
            collection(db, "urgentRequests"),
            where("userId", "==", user.uid),
            where("requestedDate", "==", selectedDate),
            where("status", "==", "approved")
          ))
          
          if (urgentSnap.empty) {
            toast({ title: "ไม่สามารถส่งคำขอได้", description: "กรุณาขออนุมัติจาก Dispatcher ก่อนจึงจะขอรถพรุ่งนี้ได้", variant: "destructive" })
            return
          }
        } else {
          toast({ title: "ไม่สามารถส่งคำขอได้", description: "วันที่เลือกไม่ถูกต้อง กรุณาเลือกวันใหม่", variant: "destructive" })
          return
        }
      }
    }

    if (isBlockedByUrgent) {
      toast({ 
        title: "ยังไม่ได้รับอนุมัติ", 
        description: "กรุณารอการอนุมัติเร่งด่วนจาก Dispatcher ก่อนครับ", 
        variant: "destructive" 
      })
      return
    }

    const validDestinations = destinations.filter(d => 
      (d.category !== "custom" && d.siteId) || (d.category === "custom" && d.customName)
    )

    if (validDestinations.length === 0) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุจุดหมายอย่างน้อย 1 จุดพร้อมพิกัด", variant: "destructive" })
      return
    }

    setIsSubmitting(true)
    try {
      const [year, month, day] = selectedDate.split('-');
      const datePrefix = `VR-${day}${month}`;
      const qRequests = query(collection(db, "vehicleRequests"), where("requestDate", "==", selectedDate));
      const snapRequests = await getDocs(qRequests);
      const sequence = String(snapRequests.size + 1).padStart(3, '0');
      const safety = Math.floor(Math.random() * 10);
      const requestId = `${datePrefix}-${sequence}${safety}`;

      const requestRef = doc(db, "vehicleRequests", requestId)
      const parsedDestinations = []

      for (const d of validDestinations) {
        const [lat, lng] = d.coordinates.split(',').map(s => parseFloat(s.trim()))
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
          jobDescription: d.jobDescription,
          requestTime: d.requestTime || "08:30"
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
        }
      }

      const requestData = {
        id: requestId,
        requestId,
        requestDate: selectedDate,
        requestTime: destinations[0]?.requestTime || "08:30",
        requestedBy: requestedBy || profile?.name || user?.displayName || user?.email || "Unknown",
        requestedByEmail: user.email,
        requestedByPhone: (profile as any)?.phone || "",
        userId: user.uid,
        userEmail: user.email,
        destinations: parsedDestinations,
        note,
        status: "pending",
        createdAt: serverTimestamp(),
      }

      await setDoc(requestRef, requestData)
      toast({ title: "ส่งคำขอรถสำเร็จ", description: `รหัสอ้างอิง: ${requestId}` })
      
      setNote("")
      setDestinations([{ id: "1", category: "all", searchTerm: "", siteId: "", siteName: "", customName: "", coordinates: "", jobDescription: "", saveAsSite: false, locationType: "ไซต์งาน", requestTime: "08:30" }])
    } catch (error) {
      console.error("Error saving request:", error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถส่งคำขอได้ในขณะนี้", variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card className="border-accent/20 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-accent" /> ข้อมูลการขอใช้รถ
          </CardTitle>
          <CardDescription>กรอกรายละเอียดเพื่อขอรับบริการรถรับ-ส่งหรืองานขนส่ง</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="requestedBy">ชื่อผู้ขอใช้รถ</Label>
                <Input
                  id="requestedBy"
                  placeholder="ชื่อผู้ขอใช้รถ"
                  className="h-11 bg-background/50"
                  value={requestedBy}
                  onChange={(e) => setRequestedBy(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>วันที่ต้องการรถ</Label>
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full h-11 justify-start text-left font-normal bg-background",
                        !selectedDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 text-accent" />
                      {selectedDate ? format(new Date(selectedDate + 'T00:00:00'), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate ? new Date(selectedDate + 'T00:00:00') : undefined}
                      fromDate={new Date(tomorrowStr + 'T00:00:00')}
                      disabled={(date) => {
                        const dateStr = format(date, "yyyy-MM-dd")
                        return dateStr < tomorrowStr
                      }}
                      onSelect={(date) => {
                        if (!date) return
                        const dateStr = format(date, "yyyy-MM-dd")
                        if (dateStr < tomorrowStr) return
                        setSelectedDate(dateStr)
                        setIsCalendarOpen(false)
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {isViewer && isOutsideHours && (
                  <div className="mt-2 space-y-2">
                    {isSelectingTomorrow ? (
                      <div className={`p-3 rounded-lg border space-y-2 ${
                        urgentStatus === 'approved' ? 'bg-green-500/10 border-green-500/30' :
                        urgentStatus === 'rejected' ? 'bg-red-500/10 border-red-500/30' :
                        urgentStatus === 'pending' ? 'bg-orange-500/10 border-orange-500/30' :
                        'bg-red-500/10 border-red-500/30'
                      }`}>
                        {urgentStatus === 'approved' && (
                          <p className="text-xs text-green-400 font-bold flex items-center gap-1">
                            ✅ ได้รับอนุมัติแล้ว — กรอกใบขอรถได้เลยครับ
                          </p>
                        )}
                        {urgentStatus === 'rejected' && (
                          <div className="space-y-1">
                            <p className="text-xs text-red-400 font-bold flex items-center gap-1">
                              ❌ คำขอถูกปฏิเสธ — กรุณาเลือกวันอื่น
                            </p>
                            {urgentRequests?.[0]?.rejectReason && (
                              <p className="text-[10px] text-muted-foreground italic">
                                เหตุผล: {urgentRequests[0].rejectReason}
                              </p>
                            )}
                          </div>
                        )}
                        {urgentStatus === 'pending' && (
                          <p className="text-xs text-orange-400 font-bold flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            รอ Dispatcher อนุมัติอยู่...
                          </p>
                        )}
                        {!urgentStatus && (
                          <>
                            <p className="text-xs text-red-400 font-bold flex items-center gap-1">
                              🚫 เกินเวลารับคำขอ — ต้องขออนุมัติก่อน
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white w-full"
                              onClick={handleRequestUrgentApproval}
                              disabled={isSendingUrgent}
                            >
                              {isSendingUrgent ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : "🔔"}
                              ขออนุมัติพิเศษจาก Dispatcher
                            </Button>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="text-[10px] text-amber-400 flex items-center gap-1">
                        <Info className="h-3 w-3 shrink-0" />
                        นอกเวลารับคำขอ — จองล่วงหน้าได้ตั้งแต่วันที่ {format(new Date(minDateStr + 'T00:00:00'), "dd/MM/yyyy")} เป็นต้นไป
                      </div>
                    )}
                  </div>
                )}
                {!isViewer && (
                  <div className="text-[10px] text-blue-400 mt-1 leading-tight">
                    <div className="flex items-center gap-1">
                      <Info className="h-3 w-3 shrink-0" />
                      โหมดผู้ดูแล — สามารถลงคิวงานล่วงหน้าได้ทุกวัน
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-bold">จุดหมายปลายทาง</Label>
              </div>

              <div className="space-y-0">
                {destinations.map((dest, index) => {
                  const category = CATEGORIES.find(c => c.id === dest.category);
                  const filteredSites = sites?.filter(s => {
                    if (dest.category === 'custom') return false;
                    const matchesType = dest.category === 'all' ? true : category?.types.includes(s.projectTypeTag);
                    const matchesSearch = s.name.toLowerCase().includes(dest.searchTerm.toLowerCase()) || 
                                         (s.address || "").toLowerCase().includes(dest.searchTerm.toLowerCase());
                    return matchesType && matchesSearch;
                  }) || [];

                  return (
                    <Card key={dest.id} className="bg-secondary/20 border-accent/60 relative overflow-hidden mb-4 border-2 shadow-sm">
                      <div className="absolute top-0 left-0 w-1 h-full bg-accent" />
                      <CardContent className="p-4 md:p-6 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex flex-wrap gap-1.5 p-1 bg-background/50 rounded-lg">
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
                                  updateDest(dest.id, {
                                    category: cat.id,
                                    siteId: "",
                                    siteName: "",
                                    customName: "",
                                    coordinates: "",
                                    searchTerm: ""
                                  });
                                }}
                              >
                                <cat.icon className="h-3.5 w-3.5" />
                                {cat.label}
                              </Button>
                            ))}
                          </div>
                          {/* Single destination mode */}
                        </div>

                        {dest.category !== "custom" ? (
                          <div className="space-y-4">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input 
                                placeholder="พิมพ์เพื่อค้นหาชื่อสถานที่ หรือ ที่อยู่..." 
                                className="h-11 pl-10 text-sm bg-background/50"
                                value={dest.searchTerm}
                                onChange={(e) => updateDest(dest.id, { searchTerm: e.target.value })}
                              />
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between min-h-[24px]">
                                  <Label>เลือก{category?.label}</Label>
                                </div>
                                <Select value={dest.siteId} onValueChange={(val) => updateDest(dest.id, { siteId: val })}>
                                  <SelectTrigger className="h-11">
                                    <SelectValue placeholder={dest.searchTerm ? `พบผลลัพธ์ ${filteredSites.length} รายการ` : `เลือก${category?.label}...`} />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-64">
                                    {filteredSites.length > 0 ? filteredSites.map(s => (
                                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                    )) : (
                                      <div className="p-4 text-center text-xs text-muted-foreground">ไม่พบสถานที่ในหมวดหมู่นี้</div>
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between min-h-[24px]">
                                  <Label>พิกัด (ดึงข้อมูลอัตโนมัติ)</Label>
                                  {dest.coordinates && (
                                    <Button
                                      type="button"
                                      variant="link"
                                      className="h-auto p-0 text-[10px] text-accent"
                                      onClick={() => {
                                        const [lat, lng] = dest.coordinates.split(',').map(s => s.trim());
                                        if (lat && lng) {
                                          window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
                                        }
                                      }}
                                    >
                                      🗺️ ตรวจสอบตำแหน่ง
                                    </Button>
                                  )}
                                </div>
                                <Input className="h-11 bg-muted/30" value={dest.coordinates} readOnly />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between min-h-[24px]">
                                <Label>ชื่อสถานที่</Label>
                              </div>
                              <div className="relative">
                                <Input 
                                  placeholder="พิมพ์เพื่อค้นหาหรือกำหนดเอง..." 
                                  className="h-11"
                                  value={dest.customName}
                                  onChange={(e) => {
                                    updateDest(dest.id, { customName: e.target.value, siteId: "", coordinates: "" })
                                    setActiveSuggestId(dest.id)
                                  }}
                                  onBlur={() => setTimeout(() => setActiveSuggestId(null), 200)}
                                  onFocus={() => setActiveSuggestId(dest.id)}
                                  autoComplete="off"
                                />
                                {dest.customName && activeSuggestId === dest.id && (() => {
                                  const matched = sites?.filter(s => 
                                    s.name.toLowerCase().includes(dest.customName.toLowerCase()) && 
                                    dest.customName.length >= 2
                                  ).slice(0, 5) || []
                                  
                                  if (matched.length === 0) return null
                                  
                                  return (
                                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                                      <p className="text-[10px] text-muted-foreground px-3 py-1.5 bg-secondary/30 border-b border-border">
                                        🔍 พบสถานที่ที่มีอยู่แล้ว — เลือกเพื่อใช้พิกัดเดิม
                                      </p>
                                      {matched.map(s => (
                                        <button
                                          key={s.id}
                                          type="button"
                                          className="w-full text-left px-3 py-2.5 hover:bg-accent/10 transition-colors flex flex-col gap-0.5 border-b border-border/30 last:border-0"
                                          onClick={() => {
                                            updateDest(dest.id, {
                                              customName: s.name,
                                              siteId: s.id,
                                              coordinates: s.latitude && s.longitude ? `${s.latitude}, ${s.longitude}` : ""
                                            })
                                            setActiveSuggestId(null)
                                          }}
                                        >
                                          <span className="text-sm font-medium text-white">{s.name}</span>
                                          <span className="text-[10px] text-muted-foreground">
                                            {s.latitude ? `📍 ${s.latitude?.toFixed(4)}, ${s.longitude?.toFixed(4)}` : "ไม่มีพิกัด"}
                                            {s.projectTypeTag && ` • ${s.projectTypeTag}`}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )
                                })()}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between min-h-[24px]">
                                <Label>พิกัด (lat, lng)</Label>
                                <div className="flex items-center gap-2">
                                  {dest.coordinates && (
                                    <Button
                                      type="button"
                                      variant="link"
                                      className="h-auto p-0 text-[10px] text-accent"
                                      onClick={() => {
                                        const [lat, lng] = dest.coordinates.split(',').map(s => s.trim());
                                        if (lat && lng) {
                                          window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
                                        }
                                      }}
                                    >
                                      🗺️ ตรวจสอบตำแหน่ง
                                    </Button>
                                  )}
                                  <Button 
                                    type="button" 
                                    variant="link" 
                                    className="h-auto p-0 text-[10px] text-accent"
                                    onClick={() => window.open('https://maps.google.com', '_blank')}
                                  >
                                    <ExternalLink className="mr-1 h-3 w-3" /> เปิด Google Maps
                                  </Button>
                                </div>
                              </div>
                              <Input 
                                placeholder="14.0815, 100.7129" 
                                className="h-11"
                                value={dest.coordinates}
                                onChange={(e) => updateDest(dest.id, { coordinates: e.target.value })}
                              />
                              <p className="text-[10px] text-muted-foreground mt-1">
                                คัดลอกจาก Google Maps → คลิกขวาบนจุดที่ต้องการ → คัดลอกพิกัด{" "}
                                <a 
                                  href="https://youtube.com/shorts/OruuVo7xZig?si=YIEFf6bMD0GwKZ6y" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-accent underline font-bold"
                                >
                                  🎬 ดูวิธีทำ
                                </a>
                              </p>
                              {!dest.coordinates && (
                                <p className="text-[10px] text-amber-400 flex items-center gap-1 mt-1">
                                  <Info className="h-3 w-3 shrink-0" />
                                  ถ้าไม่รู้พิกัด ทีมจัดรถจะช่วยเพิ่มให้
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>ลักษณะงานที่ต้องทำ</Label>
                            <Button 
                              type="button"
                              variant="ghost" 
                              size="sm" 
                              className="h-7 text-[10px] text-accent hover:bg-accent/10 gap-1.5"
                              onClick={() => handleAiDescription(dest.id, dest.jobDescription)}
                              disabled={!dest.jobDescription}
                            >
                              <Sparkles className="h-3 w-3" /> ให้ AI ช่วยแยกรายการ
                            </Button>
                          </div>
                          <Textarea 
                            placeholder="รายละเอียดงาน เช่น ส่งอุปกรณ์ไฟฟ้า, รับตัวอย่างวัสดุ" 
                            className="min-h-[80px] bg-background/30"
                            style={{ resize: 'vertical' }}
                            value={dest.jobDescription}
                            onChange={(e) => updateDest(dest.id, { jobDescription: e.target.value })}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>เวลาที่ต้องการ (จุดนี้)</Label>
                          <div className="relative w-40">
                            <Input
                              placeholder="08:30"
                              className="h-11 pr-8"
                              value={dest.requestTime}
                              onChange={(e) => updateDest(dest.id, { requestTime: e.target.value })}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none font-bold">
                              น.
                            </span>
                          </div>
                        </div>

                        {dest.category === "custom" && (
                          <div className="space-y-4 pt-4 border-t border-border/30">
                            <div className="flex items-center space-x-2">
                              <Checkbox 
                                id={`save-site-${dest.id}`} 
                              checked={dest.saveAsSite}
                                onCheckedChange={(val) => updateDest(dest.id, { saveAsSite: !!val })}
                              />
                              <Label htmlFor={`save-site-${dest.id}`} className="text-sm font-bold text-accent cursor-pointer">
                                บันทึกสถานที่นี้เพื่อใช้ครั้งต่อไป
                              </Label>
                            </div>

                            {dest.saveAsSite && (
                              <div className="space-y-2 animate-in slide-in-from-top-1">
                                <Label>ประเภทสถานที่</Label>
                                <Select 
                                  value={dest.locationType} 
                                  onValueChange={(val) => updateDest(dest.id, { locationType: val })}
                                >
                                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="ไซต์งาน">ไซต์งาน</SelectItem>
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
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">หมายเหตุเพิ่มเติม</Label>
              <Textarea 
                id="note"
                placeholder="ระบุรถที่เหมาะสม ช่วงเวลา ข้อมูลสำคัญที่อยากแจ้งเพิ่มเติมให้ผู้จัดคิวและคนขับรถ" 
                className="min-h-[100px] bg-background/30"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 bg-accent hover:bg-accent/90 shadow-lg shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed" 
              disabled={isSubmitting || isBlockedByUrgent}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              ส่งคำขอรถ
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
