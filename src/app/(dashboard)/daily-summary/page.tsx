"use client"

import * as React from "react"
import { useFirestore, useCollection, useMemoFirebase, useUser, updateDocumentNonBlocking, errorEmitter, FirestorePermissionError } from "@/firebase"
import { collection, query, where, orderBy, getDocs, doc, onSnapshot, serverTimestamp } from "firebase/firestore"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  FileText, 
  Printer, 
  Search, 
  Loader2, 
  Calendar as CalendarIcon, 
  AlertCircle,
  Truck,
  User as UserIcon,
  MapPin,
  Send,
  Copy,
  Check,
  QrCode,
  ImageIcon,
  ClipboardList,
  Phone,
  Info,
  RefreshCcw,
  MousePointerClick,
  CheckCircle2,
  ArrowRightLeft,
  CalendarClock,
  Ban,
  ListChecks
} from "lucide-react"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Trip, Driver, TripStop, StopOutcome } from "@/types/models"
import { computeOutcomeStats } from "@/lib/calculations"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"

export default function DailySummaryPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()

  // Set initial selected date to empty to force user to click
  const [selectedDate, setSelectedDate] = React.useState<string>("")
  const [trips, setTrips] = React.useState<Trip[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [isSavingImage, setIsSavingImage] = React.useState(false)
  const [isSendingLine, setIsSendingLine] = React.useState(false)
  
  // State for dates that have work (trips or requests) to highlight on calendar
  const [datesWithWork, setDatesWithWork] = React.useState<Set<string>>(new Set())
  const datesWithWorkRef = React.useRef<Set<string>>(new Set())

  // Drivers data for phone numbers
  const driversRef = useMemoFirebase(() => collection(db, "drivers"), [db])
  const { data: driversData } = useCollection<Driver>(driversRef)

  // Share Modal State
  const [selectedTripForShare, setSelectedTripForShare] = React.useState<Trip | null>(null)
  const [copied, setCopied] = React.useState(false)

  // Listen for all work dates to highlight them with orange dots
  React.useEffect(() => {
    if (!db) return
    
    const today = new Date()
    const minDate = new Date()
    minDate.setDate(today.getDate() - 7)
    const maxDate = new Date()
    maxDate.setDate(today.getDate() + 7)
    
    const minDateStr = format(minDate, "yyyy-MM-dd")
    const maxDateStr = format(maxDate, "yyyy-MM-dd")

    let tripDates: string[] = []
    let vrDates: string[] = []

    const updateAllDates = () => {
      const newSet = new Set([...tripDates, ...vrDates])
      datesWithWorkRef.current = newSet
      setDatesWithWork(newSet)
    }

    // 1. Listen for Trip dates in range
    const qTrips = query(
      collection(db, "trips"),
      where("tripDate", ">=", minDateStr),
      where("tripDate", "<=", maxDateStr)
    )

    const unsubscribeTrips = onSnapshot(
      qTrips,
      (snapshot) => {
        tripDates = snapshot.docs
          .filter(doc => doc.data().status !== 'Cancelled')
          .map(doc => {
            const data = doc.data()
            return data.tripDate || data.date
          }).filter(Boolean)
        updateAllDates()
      },
      async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: 'trips',
          operation: 'list'
        }))
      }
    )

    // 2. Listen for Vehicle Request dates in range
    const qVRs = query(
      collection(db, "vehicleRequests"),
      where("requestDate", ">=", minDateStr),
      where("requestDate", "<=", maxDateStr)
    )

    const unsubscribeVRs = onSnapshot(
      qVRs,
      (vrSnapshot) => {
        vrDates = vrSnapshot.docs
          .filter(doc => doc.data().status !== 'cancelled')
          .map(doc => doc.data().requestDate).filter(Boolean)
        updateAllDates()
      },
      async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: 'vehicleRequests',
          operation: 'list'
        }))
      }
    )

    return () => {
      unsubscribeTrips()
      unsubscribeVRs()
    }
  }, [db])

  const fetchTrips = async (dateStr?: string) => {
    const targetDate = dateStr || selectedDate
    if (!targetDate) return

    setIsLoading(true)
    try {
      const q1 = query(collection(db, "trips"), where("tripDate", "==", targetDate))
      const q2 = query(collection(db, "trips"), where("date", "==", targetDate))

      const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)])

      const seen = new Set<string>()
      const results = [...snap1.docs, ...snap2.docs]
        .map(doc => ({ ...doc.data(), id: doc.id } as Trip))
        .filter(trip => {
          if (seen.has(trip.id)) return false
          seen.add(trip.id)
          return trip.status !== 'Cancelled'
        })
        .sort((a, b) => {
          const timeA = (a.stops?.[0] as any)?.requestTime || (a as any).departureTime || "08:30"
          const timeB = (b.stops?.[0] as any)?.requestTime || (b as any).departureTime || "08:30"
          return timeA.localeCompare(timeB)
        })

      setTrips(results)
    } catch (error) {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: 'trips',
        operation: 'list'
      }))
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถโหลดข้อมูลได้", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  // Auto load when date changes
  React.useEffect(() => {
    if (selectedDate) {
      fetchTrips(selectedDate)
    }
  }, [selectedDate])

  const formatThaiDate = (dateStr: string) => {
    if (!dateStr) return ""
    if (dateStr.includes('-')) {
      const [y, m, d] = dateStr.split('-')
      return `${d}/${m}/${y}`
    }
    const d = new Date(dateStr)
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    return `${day}/${month}/${year}`
  }

  const handlePrint = () => {
    if (trips.length === 0) {
      toast({ title: "ไม่มีข้อมูล", description: "กรุณาโหลดข้อมูลก่อนทำการพิมพ์", variant: "destructive" })
      return
    }
    window.print()
  }

  const handleSaveImage = async () => {
    if (trips.length === 0) return
    setIsSavingImage(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const element = document.getElementById('summary-report')
      if (!element) return

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      })

      const image = canvas.toDataURL('image/jpeg', 0.95)
      const link = document.createElement('a')
      link.download = `คิวรถประจำวัน_${selectedDate}.jpg`
      link.href = image
      link.click()
      
      toast({ title: "สำเร็จ", description: "บันทึกเป็นรูปภาพเรียบร้อยแล้ว" })
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถบันทึกรูปภาพได้", variant: "destructive" })
    } finally {
      setIsSavingImage(false)
    }
  }

  const handleSendLine = async () => {
    if (trips.length === 0) return
    setIsSendingLine(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const element = document.getElementById('summary-report')
      if (!element) return

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      })
      const imageBase64 = canvas.toDataURL('image/jpeg', 0.95)

      const tripData = trips.map((trip: any) => ({
        driverName: trip.driverName,
        vehiclePlate: trip.vehiclePlate,
        driverUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://lotus-eme-transport-system.vercel.app'}/driver/${trip.tripId}`
      }))

      const res = await fetch('/api/line/send-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          imageBase64, 
          trips: tripData,
          dateStr: formatThaiDate(selectedDate),
          selectedDate: selectedDate
        })
      })

      if (res.ok) {
        toast({ title: "สำเร็จ", description: "ส่งเข้า LINE กลุ่มเรียบร้อยแล้ว!" })
      } else {
        toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถส่งข้อมูลเข้า LINE ได้", variant: "destructive" })
      }
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถส่งข้อมูลเข้า LINE ได้", variant: "destructive" })
    } finally {
      setIsSendingLine(false)
    }
  }

  const handleShareClick = (trip: Trip) => {
    setSelectedTripForShare(trip)
  }

  const handleCopyLink = () => {
    if (!selectedTripForShare) return
    const url = `${process.env.NEXT_PUBLIC_APP_URL || 'https://lotus-eme-transport-system.vercel.app'}/driver/${selectedTripForShare.tripId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "คัดลอกลิงก์แล้ว", description: "ส่งลิงก์ให้คนขับได้เลย" });
  };

  const getDriverPhone = (driverId: string) => {
    return driversData?.find(d => d.id === driverId)?.phoneNumber || ""
  }

  const totalDistance = trips.reduce((sum, t) => sum + (t.totalDistanceKm || 0), 0)

  // --- Actual-outcome reconciliation (after the report is posted to LINE) ---
  const recordedBy = user?.displayName || user?.email || ""

  // Strip every outcome-related key so a stop can be reset cleanly back to "as planned".
  // (Firestore rejects `undefined` values, so we omit keys rather than set them.)
  const stripOutcome = (s: TripStop): TripStop => {
    const {
      outcome, outcomeReason, reassignedToTripId, reassignedToVehiclePlate,
      reassignedToDriverName, outcomeRecordedBy, outcomeAt, ...base
    } = s as any
    return base
  }

  // Persist a trip's stops array (optimistic local update + non-blocking write).
  const applyStops = (tripId: string, newStops: TripStop[], persist = true) => {
    setTrips(prev => prev.map(t => (t.id === tripId ? { ...t, stops: newStops } : t)))
    if (persist && db) {
      updateDocumentNonBlocking(doc(db, "trips", tripId), {
        stops: newStops,
        updatedAt: serverTimestamp(),
      })
    }
  }

  // Replace a single stop within a trip, returning the new stops array.
  const buildStops = (trip: Trip, stopIdx: number, mut: (s: TripStop) => TripStop): TripStop[] =>
    (trip.stops || []).map((s, i) => (i === stopIdx ? mut({ ...s }) : s))

  const chooseOutcome = (trip: Trip, stopIdx: number, outcome: StopOutcome) => {
    const newStops = buildStops(trip, stopIdx, (s) => {
      const base = stripOutcome(s)
      if (outcome === 'delivered') return base // back to "as planned"
      return { ...base, outcome, outcomeRecordedBy: recordedBy, outcomeAt: new Date().toISOString() }
    })
    applyStops(trip.id, newStops, true)
  }

  const setReassignTarget = (trip: Trip, stopIdx: number, targetTripId: string) => {
    const target = trips.find(t => t.id === targetTripId)
    const newStops = buildStops(trip, stopIdx, (s) => {
      if (!target) {
        const { reassignedToTripId, reassignedToVehiclePlate, reassignedToDriverName, ...rest } = s as any
        return rest
      }
      return {
        ...s,
        reassignedToTripId: target.id,
        reassignedToVehiclePlate: target.vehiclePlate,
        reassignedToDriverName: target.driverName,
      }
    })
    applyStops(trip.id, newStops, true)
  }

  // Reason text: update locally on every keystroke, persist on blur.
  const setRefuseReason = (trip: Trip, stopIdx: number, reason: string, persist: boolean) => {
    const newStops = buildStops(trip, stopIdx, (s) => ({ ...s, outcomeReason: reason }))
    applyStops(trip.id, newStops, persist)
  }

  const outcomeStats = computeOutcomeStats(trips as any)

  const renderStopRow = (trip: Trip, stop: TripStop, sIdx: number) => {
    const current: StopOutcome = stop.outcome || 'delivered'
    const inputClass = "w-full h-9 rounded-md bg-background border border-border/50 text-sm px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
    const btn = (key: StopOutcome, label: string, Icon: any, activeClass: string) => (
      <button
        type="button"
        onClick={() => chooseOutcome(trip, sIdx, key)}
        className={cn(
          "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
          current === key ? activeClass : "border-border/50 text-muted-foreground hover:bg-secondary/40"
        )}
      >
        <Icon className="h-3 w-3" /> {label}
      </button>
    )

    return (
      <div key={`${trip.id}-${sIdx}`} className="flex flex-col gap-2 rounded-md bg-secondary/20 p-2.5">
        <span className="text-sm font-medium text-white">{sIdx + 1}. {stop.siteName}</span>
        <div className="flex flex-wrap gap-1.5">
          {btn('delivered', 'ตามแผน', CheckCircle2, 'border-green-500/60 bg-green-500/10 text-green-400')}
          {btn('reassigned', 'สลับ', ArrowRightLeft, 'border-blue-500/60 bg-blue-500/10 text-blue-400')}
          {btn('postponed', 'เลื่อน', CalendarClock, 'border-amber-500/60 bg-amber-500/10 text-amber-400')}
          {btn('driver-refused', 'ไม่รับงาน', Ban, 'border-red-500/60 bg-red-500/10 text-red-400')}
        </div>
        {current === 'reassigned' && (
          <select
            value={stop.reassignedToTripId || ''}
            onChange={(e) => setReassignTarget(trip, sIdx, e.target.value)}
            className={cn(inputClass, "cursor-pointer")}
          >
            <option value="">-- เลือกคันที่รับงานไปทำ (กม. ลงคันนั้น) --</option>
            {trips.filter(t => t.id !== trip.id).map(t => (
              <option key={t.id} value={t.id}>{t.driverName} • {t.vehiclePlate}</option>
            ))}
          </select>
        )}
        {current === 'driver-refused' && (
          <input
            type="text"
            value={stop.outcomeReason || ''}
            placeholder="เหตุผลสั้น ๆ (เช่น บอกไกล ไม่คุ้ม)"
            onChange={(e) => setRefuseReason(trip, sIdx, e.target.value, false)}
            onBlur={(e) => setRefuseReason(trip, sIdx, e.target.value, true)}
            className={inputClass}
          />
        )}
      </div>
    )
  }

  const shareUrl = selectedTripForShare
    ? `${process.env.NEXT_PUBLIC_APP_URL || 'https://lotus-eme-transport-system.vercel.app'}/driver/${selectedTripForShare.tripId}`
    : '';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">สรุปคิวรถประจำวัน</h2>
          <p className="text-sm md:text-base text-muted-foreground">ตรวจสอบตารางวิ่งรถและพิมพ์รายงานใบงานประจำวัน</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Controls */}
        <div className="lg:col-span-4 space-y-6 no-print">
          <Card className="border-accent/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarIcon className="h-5 w-5 text-accent" /> เลือกวันที่
              </CardTitle>
              <CardDescription>แสดงเฉพาะวันที่มีคิวงานในระบบ</CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full h-11 rounded-lg bg-background border border-border/50 text-sm px-3 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">-- เลือกวันที่ --</option>
                {Array.from(datesWithWork)
                  .sort()
                  .map(date => {
                    const [y, m, d] = date.split('-')
                    const dateObj = new Date(date + 'T00:00:00')
                    const dayName = dateObj.toLocaleDateString('th-TH', { weekday: 'long' })
                    return (
                      <option key={date} value={date}>
                        📅 {d}/{m}/{y} ({dayName})
                      </option>
                    )
                  })}
              </select>
              {datesWithWork.size === 0 && (
                <p className="text-xs text-muted-foreground mt-2 text-center">ไม่มีคิวงานในระบบ</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-secondary/20">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>จัดการรายงาน</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-accent" onClick={() => fetchTrips()}>
                  <RefreshCcw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedDate ? (
                <div className="flex items-center gap-2 text-sm mb-2 text-accent font-bold bg-accent/5 p-2 rounded border border-accent/20">
                  <Info className="h-4 w-4" />
                  <span>กำลังแสดงผลวันที่: {formatThaiDate(selectedDate)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs mb-2 text-muted-foreground bg-secondary/30 p-2 rounded border border-dashed border-border/50">
                  <MousePointerClick className="h-3 w-3" />
                  <span>ยังไม่ได้เลือกวันที่</span>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-3">
                <Button 
                  variant="outline"
                  className="border-accent text-accent hover:bg-accent/10 h-11"
                  onClick={handlePrint}
                  disabled={trips.length === 0 || isLoading || !selectedDate}
                >
                  <Printer className="mr-2 h-4 w-4" /> พิมพ์/PDF
                </Button>
                <Button 
                  variant="outline"
                  className="border-green-600 text-green-500 hover:bg-green-600/10 h-11"
                  onClick={handleSaveImage}
                  disabled={trips.length === 0 || isSavingImage || isLoading || !selectedDate}
                >
                  {isSavingImage ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="mr-2 h-4 w-4" />
                  )}
                  {isSavingImage ? "รอสักครู่..." : "รูปภาพ"}
                </Button>
              </div>

              <Button 
                variant="outline" 
                className="bg-green-600 hover:bg-green-700 text-white h-11 w-full border-transparent font-bold"
                onClick={handleSendLine}
                disabled={trips.length === 0 || isSendingLine || isLoading || !selectedDate}
              >
                {isSendingLine ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {isSendingLine ? "กำลังส่ง..." : "ส่งเข้า LINE กลุ่ม"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: Preview Area */}
        <div className="lg:col-span-8 space-y-4 min-h-[500px]">
          <div className="no-print bg-secondary/10 border border-dashed rounded-xl p-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertCircle className="h-3 w-3" />}
            {isLoading ? "กำลังโหลดข้อมูล..." : "ตัวอย่างใบงาน (Preview) สำหรับพิมพ์ลงกระดาษ A4"}
          </div>

          <Card className={cn(
            "overflow-hidden transition-all",
            (!selectedDate || trips.length === 0 || isLoading) && "opacity-40 grayscale"
          )}>
            <CardContent className="p-0 bg-white text-black min-h-[600px] overflow-x-auto relative">
              {isLoading && (
                <div className="absolute inset-0 z-10 bg-white/60 flex items-center justify-center">
                  <Loader2 className="h-10 w-10 animate-spin text-accent" />
                </div>
              )}

              {selectedDate ? (
                trips.length > 0 ? (
                  <div className="w-full min-w-[800px] p-8 print:p-0 bg-white" id="summary-report">
                    <div className="text-center mb-6 space-y-1">
                      <h1 className="text-xl font-bold uppercase underline decoration-2 underline-offset-4">บันทึกใช้รถยนต์ประจำวัน</h1>
                      <h2 className="text-lg font-bold">LOTUS GROUP / LOTUS EME</h2>
                      <p className="text-sm font-semibold">วันที่ {formatThaiDate(selectedDate)} (ค.ศ.)</p>
                    </div>

                    <table className="w-full border-collapse border-2 border-black text-[12px]">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border border-black p-2 w-[12%] text-center">วัน เดือน ปี<br/>ที่ใช้รถ</th>
                          <th className="border border-black p-2 w-[8%] text-center">เวลา</th>
                          <th className="border border-black p-2 w-[55%] text-center">รายละเอียดของงานที่ปฏิบัติ<br/><span className="font-normal text-[10px]">ลักษณะงาน (แยกเป็นข้อ ๆ) และ สถานที่</span></th>
                          <th className="border border-black p-2 w-[25%] text-left">ผู้ปฏิบัติงาน / ทะเบียนรถ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trips.flatMap((trip) => {
                          const stops = trip.stops || [];
                          if (stops.length === 0) return [];

                          const driverPhone = getDriverPhone(trip.driverId);

                          return stops.map((stop, sIdx) => {
                            const locationText = (stop as any).address || (stop as any).zone || "";
                            const stopRequester = stop.requestedBy || (trip as any).requestedBy || "";
                            const requesterPhone = (stop as any).requestedByPhone || "";
                            
                            const requesterNote = (stop as any).note || (stop as any).notes || "";
                            const stopDispatcherNote = (trip as any).stopNotes?.[`stop_${sIdx}`] || (stop as any).dispatcherNote;
                            const stopTime = (stop as any).requestTime;

                            return (
                              <tr key={`${trip.id}-${sIdx}`}>
                                {sIdx === 0 && (
                                  <td className="border border-black p-2 text-center align-top" rowSpan={stops.length}>
                                    {formatThaiDate((trip as any).tripDate || (trip as any).date || "")}
                                  </td>
                                )}
                                <td className="border border-black p-2 text-center align-top font-bold">
                                  {stopTime || "08:30"} น.
                                </td>
                                <td className="border border-black p-2 align-top">
                                  <div className="space-y-1">
                                    <div className="flex gap-1.5 font-bold">
                                      {trip.stops.length > 1 && <span>{sIdx + 1}.</span>}
                                      <span>{stop.siteName}</span>
                                    </div>
                                    <div className="pl-5 space-y-0.5">
                                      <div className="flex gap-2">
                                        <span className="shrink-0">-</span>
                                        <span className="italic" style={{ whiteSpace: 'pre-wrap' }}>{stop.cargoDetails || "ส่งวัสดุ/ปฏิบัติงานตามแผน"}</span>
                                      </div>

                                      {stop.outcome && stop.outcome !== 'delivered' && (
                                        <div
                                          style={{
                                            marginTop: '4px',
                                            display: 'inline-block',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                            ...(stop.outcome === 'reassigned'
                                              ? { background: '#dbeafe', color: '#1e40af' }
                                              : { background: '#fef3c7', color: '#92400e' }),
                                          }}
                                        >
                                          {stop.outcome === 'reassigned'
                                            ? `🔄 สลับไปทะเบียน ${stop.reassignedToVehiclePlate || '-'}`
                                            : stop.outcome === 'postponed'
                                            ? '⏭️ เลื่อนวัน'
                                            : '⏭️ ไม่ได้ดำเนินการ'}
                                        </div>
                                      )}

                                      {stopDispatcherNote && (
                                        <div style={{
                                          marginTop: '4px',
                                          paddingLeft: '8px',
                                          borderLeft: '2px solid #3b82f6',
                                          fontSize: '12px',
                                          color: '#1e40af',
                                          whiteSpace: 'pre-line'
                                        }}>
                                          ✏️ {stopDispatcherNote}
                                        </div>
                                      )}

                                      {locationText && (
                                        <div className="pl-3 text-[10px] text-gray-600">
                                          {locationText}
                                        </div>
                                      )}
                                      {stopRequester && (
                                        <div className="pl-3 text-[10px] text-gray-500 italic flex items-center gap-1 mt-0.5">
                                          <ClipboardList className="h-2.5 w-2.5" />
                                          <span>ผู้ขอ: {stopRequester} {requesterPhone && <span className="font-bold text-gray-700 ml-1">📞 {requesterPhone}</span>}</span>
                                        </div>
                                      )}

                                      {requesterNote && requesterNote.trim() !== '' && (
                                        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }} className="pl-3">
                                          📌 หมายเหตุผู้ขอ: {requesterNote}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                {sIdx === 0 && (
                                  <td className="border border-black p-2 align-top" rowSpan={stops.length}>
                                    <div className="flex justify-between items-start">
                                      <div className="space-y-2">
                                        <div>
                                          <p className="font-bold">คนขับ: {trip.driverName}</p>
                                          {driverPhone && <p className="text-[11px] font-bold text-blue-800">📞 {driverPhone}</p>}
                                          <p className="font-bold">ทะเบียน: {trip.vehiclePlate}</p>
                                        </div>
                                      </div>
                                      <Button 
                                        variant="outline" 
                                        size="icon" 
                                        className="no-print h-8 w-8 shrink-0 border-blue-500 text-blue-600 hover:bg-blue-50"
                                        onClick={() => handleShareClick(trip)}
                                        title="ส่งใบงานให้คนขับ"
                                      >
                                        <Send className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>

                    <div className="mt-8 flex justify-between text-sm">
                      <div className="space-y-1 font-bold">
                        <p>รวม: {trips.length} เที่ยว</p>
                        <p>ระยะทางรวม: {totalDistance.toFixed(1)} กม.</p>
                      </div>
                      <div className="flex gap-12">
                        <div className="text-center w-48">
                          <div className="h-10 border-b border-black mb-2"></div>
                          <p>ลายเซ็นผู้อนุมัติ</p>
                          <p className="text-xs">วันที่ ______/______/______</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-32 text-gray-400">
                    <FileText className="h-16 w-16 mb-4 opacity-20" />
                    <p className="text-lg font-medium">ไม่มีข้อมูลเที่ยววิ่งสำหรับวันที่เลือก</p>
                    <p className="text-sm">กรุณาเลือกวันที่มีสัญลักษณ์แจ้งเตือนบนปฏิทิน</p>
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center py-32 text-gray-400">
                  <CalendarIcon className="h-16 w-16 mb-4 opacity-20" />
                  <p className="text-lg font-medium">กรุณาเลือกวันที่บนปฏิทิน</p>
                  <p className="text-sm">เพื่อแสดงบันทึกการใช้รถยนต์ประจำวัน</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reconcile actual outcomes (does NOT appear in the printed/JPEG report) */}
      {selectedDate && trips.length > 0 && !isLoading && (
        <Card className="no-print border-accent/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-white">
              <ListChecks className="h-5 w-5 text-accent" /> ปิดผลงานจริง (หลังส่ง LINE)
            </CardTitle>
            <CardDescription>
              คนขับตอบในกลุ่มแล้ว แตะเฉพาะจุดที่ “ผิดแผน” — ที่เหลือถือว่าทำตามแผนอัตโนมัติ
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary chips */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className="rounded-full bg-green-500/10 text-green-400 border border-green-500/30 px-3 py-1">
                ✅ ตามแผน {outcomeStats.counts.delivered}
              </span>
              <span className="rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 px-3 py-1">
                🔄 สลับ {outcomeStats.counts.reassigned}
              </span>
              <span className="rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 px-3 py-1">
                ⏭️ เลื่อน {outcomeStats.counts.postponed}
              </span>
              <span className="rounded-full bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-1">
                🚫 ไม่รับงาน {outcomeStats.counts.refused}
              </span>
              <span className="ml-auto rounded-full bg-secondary/40 text-muted-foreground border border-border/50 px-3 py-1">
                กม.จริง <span className="text-white">{outcomeStats.totalActualKm.toFixed(1)}</span> / แผน {outcomeStats.totalPlannedKm.toFixed(1)}
              </span>
            </div>

            {/* Per-trip outcome editor */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {trips.map((trip) => {
                const actualKm = outcomeStats.actualKmByTrip[trip.id] || 0
                const plannedKm = outcomeStats.plannedKmByTrip[trip.id] || 0
                const kmShifted = Math.abs(actualKm - plannedKm) > 0.05
                return (
                  <div key={trip.id} className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-bold text-white">
                        <Truck className="h-4 w-4 text-accent" />
                        {trip.driverName} • {trip.vehiclePlate}
                      </div>
                      <div className={cn("text-xs font-bold", kmShifted ? "text-amber-400" : "text-muted-foreground")}>
                        {actualKm.toFixed(1)} / {plannedKm.toFixed(1)} กม.
                      </div>
                    </div>
                    <div className="space-y-2">
                      {(trip.stops || []).map((stop, sIdx) => renderStopRow(trip, stop, sIdx))}
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
              <Info className="h-3 w-3" />
              บันทึกอัตโนมัติทันทีที่แตะ — “สลับ/เลื่อน” จะแสดงในใบงานเวอร์ชันใหม่ ส่วน “ไม่รับงาน” เก็บไว้ดูเงียบ ๆ ไม่ขึ้นในรูปที่ส่งกลุ่ม
            </p>
          </CardContent>
        </Card>
      )}

      {/* Share Dialog */}
      <Dialog open={!!selectedTripForShare} onOpenChange={(open) => !open && setSelectedTripForShare(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-500" /> ส่งใบงานให้คนขับ
            </DialogTitle>
            <DialogDescription>
              Trip ID: <span className="font-bold text-gray-900">{selectedTripForShare?.tripId}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Link สำหรับคนขับ</p>
              <div className="flex items-center gap-2 p-3 bg-secondary/30 rounded-xl border border-border/50">
                <p className="text-sm font-medium truncate flex-1 text-blue-400">{shareUrl}</p>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 hover:bg-blue-500/10" onClick={handleCopyLink}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-blue-500" />}
                </Button>
              </div>
            </div>

            <div className="flex flex-col items-center gap-4 py-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">QR Code</p>
              <div className="bg-white p-4 rounded-2xl shadow-inner border border-gray-100">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`}
                  alt="Trip QR Code"
                  className="w-40 h-40"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="w-full h-11" onClick={() => setSelectedTripForShare(null)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm 15mm 10mm 15mm;
          }
          body {
            background-color: white !important;
            color: black !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .card {
            border: none !important;
            box-shadow: none !important;
          }
          #summary-report {
            padding: 0 !important;
            min-width: 100% !important;
          }
          table {
            width: 100% !important;
            table-layout: fixed;
          }
        }
      `}</style>
    </div>
  )
}
