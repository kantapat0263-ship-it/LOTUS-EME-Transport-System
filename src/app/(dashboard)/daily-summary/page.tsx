"use client"

import * as React from "react"
import { useFirestore, useCollection, useMemoFirebase, useUser, updateDocumentNonBlocking, errorEmitter, FirestorePermissionError } from "@/firebase"
import { collection, query, where, orderBy, getDocs, getDoc, doc, onSnapshot, serverTimestamp, setDoc, deleteDoc } from "firebase/firestore"
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
import { computeOutcomeStats, computeDriverLeaderboard, monthRange, incomingStopsForTrip, type DriverStat } from "@/lib/calculations"
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

  // Top 3 drivers of the selected date's month (by actual km) — shown on the A4
  const [topDrivers, setTopDrivers] = React.useState<DriverStat[]>([])

  // Drivers data for phone numbers
  const driversRef = useMemoFirebase(() => collection(db, "drivers"), [db])
  const { data: driversData } = useCollection<Driver>(driversRef)

  // Share Modal State
  const [selectedTripForShare, setSelectedTripForShare] = React.useState<Trip | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [copiedMsg, setCopiedMsg] = React.useState(false)

  // "เลื่อนงาน" dialog — เลือกวันใหม่แล้วสร้างใบขอรถ rescheduled ให้ไปโผล่ในกองจัดเที่ยววิ่งวันนั้น
  // #5 เก็บแค่ tripId + stopIdx (ไม่ snapshot ทั้ง trip) → ตอนยืนยันค่อยหยิบทริปสดล่าสุด
  //     กันเคสเปิด dialog ค้างแล้วไปแก้จุดอื่น แล้วถูกเขียนทับด้วย stops ก้อนเก่า
  const [postponeDialog, setPostponeDialog] = React.useState<{ tripId: string; stopIdx: number } | null>(null)
  const [postponeDateStr, setPostponeDateStr] = React.useState<string>("")
  const [isPostponing, setIsPostponing] = React.useState(false)
  const [postponeWarn, setPostponeWarn] = React.useState<string>("")

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

  // Top 3 drivers of the selected month (by actual km driven) for the A4 footer
  React.useEffect(() => {
    if (!selectedDate || !db) {
      setTopDrivers([])
      return
    }
    let active = true
    ;(async () => {
      const { start, end } = monthRange(selectedDate)
      const snap = await getDocs(query(
        collection(db, "trips"),
        where("tripDate", ">=", start),
        where("tripDate", "<=", end),
      ))
      if (!active) return
      // #3 ไม่นับทริปที่ยกเลิก (Cancelled) เข้าอันดับ — query ตาม tripDate range กรอง status ไม่ได้
      const monthTrips = snap.docs
        .map(d => ({ ...d.data(), id: d.id }) as any)
        .filter(t => t.status !== 'Cancelled')
      setTopDrivers(computeDriverLeaderboard(monthTrips).slice(0, 3))
    })().catch(() => { if (active) setTopDrivers([]) })
    return () => { active = false }
  }, [selectedDate, db])

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
      // หมายเหตุ: ไม่แคป/ไม่ส่งรูป A4 แล้ว — server (/api/line/send-summary) ส่งแต่ข้อความ
      // ไม่เคยใช้ imageBase64 เลย การส่ง base64 หลาย MB เสี่ยงชนลิมิต body ของ Vercel (~4.5MB)
      // ทำปุ่มพังทั้งปุ่มในวันที่ทริปเยอะ + ทำให้กดส่งช้าโดยไม่จำเป็น
      const tripData = trips.map((trip: any) => {
        const incoming = incomingStopsForTrip(trips as any, trip.id)
        // public-safe: งานที่คันนี้ "โยกไปให้" คันอื่น (gate เดียวกับ badge ในใบสรุป)
        const outgoing = (trip.stops || []).filter((s: any) => s.reassignedToVehiclePlate && s.outcome && s.outcome !== 'delivered')
        return {
          // คนขับจริง (ขับแทน) มีผลในข้อความ LINE ด้วย — โชว์คนที่ขับจริง
          driverName: trip.actualDriverName
            ? `${trip.actualDriverName} (ขับแทน ${trip.driverName})`
            : trip.driverName,
          vehiclePlate: trip.vehiclePlate,
          driverUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://lotus-eme-transport-system.vercel.app'}/driver/${trip.tripId}`,
          // public-safe: บอกแค่ว่ามีงาน "รับต่อ" เพิ่ม — ไม่มีคำว่าปฏิเสธ
          incomingCount: incoming.length,
          incomingFrom: Array.from(new Set(incoming.map((j) => j.fromVehiclePlate).filter(Boolean))),
          outgoingCount: outgoing.length,
          outgoingTo: Array.from(new Set(outgoing.map((s: any) =>
            s.reassignedToDriverName ? `${s.reassignedToDriverName} (${s.reassignedToVehiclePlate})` : s.reassignedToVehiclePlate
          ).filter(Boolean))),
        }
      })

      const res = await fetch('/api/line/send-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
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

  // สร้างข้อความสรุปแบบเดียวกับที่บอทส่ง (ใช้สำหรับปุ่ม "คัดลอกข้อความ")
  // ต้องให้ตรงกับ format ใน src/app/api/line/send-summary/route.ts
  // วันที่แบบไทยยาว (พ.ศ.) ให้เหมือนข้อความบอทเป๊ะ — logic เดียวกับ route.ts
  const thaiLongDate = (dateStr: string) => {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split('-')
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    })
  }

  const buildSummaryText = () => {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://lotus-eme-transport-system.vercel.app'
    const driverLinks = trips.map((trip: any) => {
      const incoming = incomingStopsForTrip(trips as any, trip.id)
      const incomingFrom = Array.from(new Set(incoming.map((j) => j.fromVehiclePlate).filter(Boolean)))
      // public-safe: งานที่คันนี้ "โยกไปให้" คันอื่น (gate เดียวกับ badge ในใบสรุป)
      const outgoing = (trip.stops || []).filter((s: any) => s.reassignedToVehiclePlate && s.outcome && s.outcome !== 'delivered')
      const outgoingTo = Array.from(new Set(outgoing.map((s: any) =>
        s.reassignedToDriverName ? `${s.reassignedToDriverName} (${s.reassignedToVehiclePlate})` : s.reassignedToVehiclePlate
      ).filter(Boolean)))
      const shownDriver = trip.actualDriverName
        ? `${trip.actualDriverName} (ขับแทน ${trip.driverName})`
        : trip.driverName
      let line = `🚛 ${shownDriver} (${trip.vehiclePlate})`
      // public-safe: บอกแค่ว่ามีงาน "รับต่อ" เพิ่ม — ไม่มีคำว่าปฏิเสธ
      if (incoming.length > 0) {
        const from = incomingFrom.length > 0 ? ` (จาก ${incomingFrom.join(', ')})` : ''
        line += `\n🔄 รับโยกงานต่อเพิ่ม ${incoming.length} จุด${from}`
      }
      if (outgoing.length > 0) {
        const to = outgoingTo.length > 0 ? ` (ให้ ${outgoingTo.join(', ')})` : ''
        line += `\n🔁 โยกงานไปให้ ${outgoing.length} จุด${to}`
      }
      return `${line}\n🔗 ${base}/driver/${trip.tripId}`
    }).join('\n\n')
    return `📋 ใบคิวรถประจำวัน LOTUS GROUP\n📅 วันที่ปฏิบัติงาน: ${thaiLongDate(selectedDate)}\n\n🔗 รายการลิงก์ใบงานดิจิทัลสำหรับคนขับ:\n\n${driverLinks}`
  }

  // คัดลอกข้อความเข้า clipboard → คนจัดรถไปวางในกลุ่ม LINE เอง (ไม่กินโควตา OA)
  const handleCopyMessage = async () => {
    if (trips.length === 0) return
    try {
      await navigator.clipboard.writeText(buildSummaryText())
      setCopiedMsg(true)
      setTimeout(() => setCopiedMsg(false), 2500)
      toast({ title: "คัดลอกข้อความแล้ว ✅", description: "เปิดกลุ่ม LINE แล้ววาง (Paste) ส่งได้เลย — ไม่กินโควตา" })
    } catch (e) {
      toast({ title: "คัดลอกไม่สำเร็จ", description: "เบราว์เซอร์ไม่อนุญาตให้คัดลอก ลองกดใหม่อีกครั้ง", variant: "destructive" })
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

  // ระยะทางรวม + ค่าน้ำมัน "ที่วิ่งจริง" — งานที่โยก/ปฏิเสธไม่มีคนรับจะไม่ถูกนับ (ตามงานจริง)
  // resolve ค่าน้ำมันต่อทริปแบบเดียวกับหน้า report: ใช้ fuelCost ที่ freeze ไว้ ไม่งั้นคำนวณจากอัตรา/ราคาที่ทริปเก็บไว้
  const resolveTripFuel = (t: any) =>
    (typeof t.fuelCost === 'number' && t.fuelCost > 0)
      ? t.fuelCost
      : ((t.totalDistanceKm || 0) / (t.fuelRateUsed || 10)) * (t.dieselPriceUsed || 32.5)
  const dayOutcome = computeOutcomeStats(trips.map((t: any) => ({ ...t, fuelCost: resolveTripFuel(t) })) as any)
  const totalDistance = dayOutcome.totalActualKm
  const totalFuelCost = dayOutcome.totalActualCost

  // --- Actual-outcome reconciliation (after the report is posted to LINE) ---
  const recordedBy = user?.displayName || user?.email || ""

  // Strip every outcome-related key so a stop can be reset cleanly back to "as planned".
  // (Firestore rejects `undefined` values, so we omit keys rather than set them.)
  const stripOutcome = (s: TripStop): TripStop => {
    const {
      outcome, outcomeReason, reassignedToTripId, reassignedToVehiclePlate,
      reassignedToDriverName, outcomeRecordedBy, outcomeAt,
      postponedToDate, postponedRequestId, ...base
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

  // ระบุ "คนขับจริง (ขับแทน)" ของทริป — driverId ว่าง = กลับไปใช้คนขับประจำ
  // เก็บเป็น "" (ไม่ใช่ลบ field) เพราะ credit logic ใช้ actualDriverId || driverId อยู่แล้ว
  const setActualDriver = (tripId: string, driverId: string) => {
    const name = driverId ? (driversData?.find(d => d.id === driverId)?.name || "") : ""
    const target = trips.find(t => t.id === tripId)
    const prevActualDriverId = target?.actualDriverId // อ่านก่อนเขียนทับ (ใช้ตอน revert)
    setTrips(prev => prev.map(t => (t.id === tripId ? { ...t, actualDriverId: driverId, actualDriverName: name } : t)))
    if (db) {
      updateDocumentNonBlocking(doc(db, "trips", tripId), {
        actualDriverId: driverId,
        actualDriverName: name,
        updatedAt: serverTimestamp(),
      })
    }

    // ---- ลิงก์อัตโนมัติ: คนขับแทนมีทริปของตัวเองวันเดียวกัน = ขับสองคันพร้อมกันไม่ได้ ----
    if (driverId && target) {
      // งานของคนขับแทนที่ยัง "ตามแผน" → เสนอโยกมาลงรถคันนี้ทั้งหมดในคลิกเดียว
      for (const own of trips.filter(t => t.id !== tripId && t.driverId === driverId)) {
        const movable = (own.stops || []).filter(s => !s.outcome || s.outcome === 'delivered')
        if (movable.length === 0) continue
        const ok = window.confirm(
          `${name} มีงานของตัวเอง ${movable.length} จุด บนรถ ${own.vehiclePlate}\n` +
          `โยกงานทั้งหมดมาลงรถ ${target.vehiclePlate} อัตโนมัติเลยไหม?\n\n` +
          `(กม./เครดิตจะย้ายตามมาให้ ${name} เอง — กด Cancel ถ้ารถ ${own.vehiclePlate} มีคนอื่นขับ)`
        )
        if (!ok) continue
        const nowIso = new Date().toISOString()
        applyStops(own.id, (own.stops || []).map(s =>
          (!s.outcome || s.outcome === 'delivered')
            ? {
                ...stripOutcome(s),
                outcome: 'reassigned' as StopOutcome,
                reassignedToTripId: target.id,
                reassignedToVehiclePlate: target.vehiclePlate,
                reassignedToDriverName: name,
                outcomeRecordedBy: recordedBy,
                outcomeAt: nowIso,
              }
            : s
        ))
        toast({ title: "🔗 โยกงานให้อัตโนมัติแล้ว", description: `${movable.length} จุดของ ${name} ย้ายมาลงรถ ${target.vehiclePlate}` })
      }
    }

    // ---- ยกเลิกขับแทน → เสนอเอางานที่เคยโยกมาอัตโนมัติ กลับคืนทริปเดิม ----
    if (!driverId && prevActualDriverId) {
      for (const own of trips.filter(t => t.id !== tripId && t.driverId === prevActualDriverId)) {
        const moved = (own.stops || []).filter(s => s.outcome === 'reassigned' && s.reassignedToTripId === tripId)
        if (moved.length === 0) continue
        const ok = window.confirm(`เอางาน ${moved.length} จุดของ ${own.driverName} ที่โยกมาลงรถคันนี้ กลับคืนทริปเดิม (${own.vehiclePlate}) ด้วยไหม?`)
        if (!ok) continue
        applyStops(own.id, (own.stops || []).map(s =>
          (s.outcome === 'reassigned' && s.reassignedToTripId === tripId) ? stripOutcome(s) : s
        ))
        toast({ title: "↩️ คืนงานกลับทริปเดิมแล้ว", description: `${moved.length} จุดกลับไปที่รถ ${own.vehiclePlate}` })
      }
    }
  }

  // Replace a single stop within a trip, returning the new stops array.
  const buildStops = (trip: Trip, stopIdx: number, mut: (s: TripStop) => TripStop): TripStop[] =>
    (trip.stops || []).map((s, i) => (i === stopIdx ? mut({ ...s }) : s))

  // #2 กัน "งานผี": ใบที่เลื่อนถูกจัดเข้าเที่ยววิ่งแล้วหรือยัง (approved/partial = จัดแล้ว → ห้ามลบเงียบ ๆ)
  const isPostponedReqGrouped = async (reqId: string): Promise<boolean> => {
    if (!db) return false
    try {
      const s = await getDoc(doc(db, "vehicleRequests", reqId))
      if (!s.exists()) return false // หายไปแล้ว = ลบได้ปลอดภัย
      const st = (s.data() as any).status
      return st === 'approved' || st === 'partial'
    } catch { return false }
  }

  // #6 กันเลข VR ชน: setDoc เขียนทับ doc เดิมได้ถ้า id ซ้ำ → หา id ที่ยังว่างจริงก่อนเขียน
  const genUniqueRequestId = async (dateStr: string): Promise<string> => {
    const [, m, d] = dateStr.split('-')
    const prefix = `VR-${d}${m}`
    const snap = await getDocs(query(collection(db, "vehicleRequests"), where("requestDate", "==", dateStr)))
    let seq = snap.size + 1
    for (let i = 0; i < 50; i++) {
      const safety = Math.floor(Math.random() * 10)
      const id = `${prefix}-${String(seq).padStart(3, '0')}${safety}`
      const exists = await getDoc(doc(db, "vehicleRequests", id))
      if (!exists.exists()) return id
      seq++
    }
    return `${prefix}-${String(seq).padStart(3, '0')}${Math.floor(Math.random() * 10)}z`
  }

  const chooseOutcome = async (trip: Trip, stopIdx: number, outcome: StopOutcome) => {
    // "เลื่อน" ไม่ได้แค่ติดป้าย — ต้องเลือกวันใหม่ก่อน (เปิด dialog) แล้วสร้างใบขอรถจริง
    if (outcome === 'postponed') {
      openPostponeDialog(trip, stopIdx)
      return
    }
    // ถ้าจุดนี้เคยถูกเลื่อน (มีใบที่สร้างไว้) แล้วเปลี่ยนเป็นผลอื่น → ลบใบที่เลื่อนทิ้ง กันงานงอกค้างในวันใหม่
    const prev = trip.stops?.[stopIdx] as any
    if (prev?.postponedRequestId && db) {
      // #2 ถ้าใบถูกจัดเข้าเที่ยววิ่งวันใหม่ไปแล้ว อย่าลบเงียบ ๆ (จะเหลือ "จุดผี" ในทริปวันนั้น)
      if (await isPostponedReqGrouped(prev.postponedRequestId)) {
        toast({
          title: "เปลี่ยนผลไม่ได้",
          description: `งานนี้ถูกจัดเข้าเที่ยววิ่งวันที่ ${prev.postponedToDate ? formatThaiDate(prev.postponedToDate) : 'ใหม่'} ไปแล้ว — ต้องไปลบจุดออกจากทริปวันนั้นก่อน แล้วค่อยเปลี่ยนผลตรงนี้`,
          variant: "destructive",
        })
        return
      }
      await deleteDoc(doc(db, "vehicleRequests", prev.postponedRequestId)).catch(() => {})
    }
    const newStops = buildStops(trip, stopIdx, (s) => {
      const base = stripOutcome(s)
      if (outcome === 'delivered') return base // back to "as planned"
      return { ...base, outcome, outcomeRecordedBy: recordedBy, outcomeAt: new Date().toISOString() }
    })
    applyStops(trip.id, newStops, true)
  }

  const tomorrowStr = () => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return format(d, "yyyy-MM-dd")
  }

  const openPostponeDialog = (trip: Trip, stopIdx: number) => {
    setPostponeDialog({ tripId: trip.id, stopIdx })
    setPostponeDateStr(tomorrowStr())
    setPostponeWarn("")
  }

  // เลื่อนจริง: (1) สร้างใบขอรถ rescheduled วันใหม่ให้สำเร็จก่อน → (2) ค่อยติดป้าย postponed
  // (ลำดับสำคัญ: สร้างก่อนติดป้าย ถ้า network หลุดตอนสร้าง งานจะไม่หายจากวันเดิม)
  const handlePostpone = async () => {
    if (!postponeDialog || !db) return
    const { tripId, stopIdx } = postponeDialog
    // #5 หยิบทริปสดล่าสุดจาก state (ไม่ใช้ snapshot ตอนเปิด dialog) กันเขียนทับการแก้จุดอื่น
    const trip = trips.find(t => t.id === tripId)
    if (!trip) { setPostponeDialog(null); return }
    const stop = trip.stops?.[stopIdx]
    if (!stop) return
    const newDate = postponeDateStr
    if (!newDate || newDate <= format(new Date(), "yyyy-MM-dd")) {
      toast({ title: "เลือกวันไม่ถูกต้อง", description: "ต้องเลื่อนไปวันถัดจากวันนี้เป็นต้นไป", variant: "destructive" })
      return
    }
    setIsPostponing(true)
    try {
      // ถ้าเคยเลื่อนจุดนี้ไว้แล้ว (เปลี่ยนวัน) → ลบใบเก่าทิ้งก่อน กันใบซ้ำ
      const existingReqId = (stop as any).postponedRequestId
      if (existingReqId) {
        // #2 ถ้าใบเดิมถูกจัดเข้าเที่ยววิ่งไปแล้ว เปลี่ยนวันไม่ได้ (จะเหลือจุดผีในทริปนั้น)
        if (await isPostponedReqGrouped(existingReqId)) {
          toast({ title: "เลื่อนซ้ำไม่ได้", description: "งานนี้ถูกจัดเข้าเที่ยววิ่งวันก่อนหน้าไปแล้ว — ต้องไปลบจุดออกจากทริปนั้นก่อน", variant: "destructive" })
          setIsPostponing(false)
          return
        }
        await deleteDoc(doc(db, "vehicleRequests", existingReqId)).catch(() => {})
      }

      // #6 gen requestId แบบกันชน (setDoc เขียนทับ doc เดิมได้ถ้า id ซ้ำ)
      const requestId = await genUniqueRequestId(newDate)

      await setDoc(doc(db, "vehicleRequests", requestId), {
        id: requestId,
        requestId,
        requestDate: newDate,
        requestTime: stop.requestTime || "08:30",
        requestedBy: stop.requestedBy || "",
        requestedByPhone: stop.requestedByPhone || "",
        requestedByEmail: "",
        userId: user?.uid || null,
        userEmail: user?.email || "",
        destinations: [{
          type: stop.siteId ? "site" : "other",
          siteId: stop.siteId || null,
          siteName: stop.siteName,
          customName: stop.siteId ? null : stop.siteName,
          lat: stop.lat ?? 0,
          lng: stop.lng ?? 0,
          jobDescription: stop.cargoDetails || "",
          requestTime: stop.requestTime || "08:30",
        }],
        note: stop.note || "",
        status: "rescheduled", // ← ต้องเป็น rescheduled ถึงจะโผล่ในกองจัดเที่ยววิ่ง (pending ถูกตัดออก)
        rescheduledFromDate: trip.tripDate,
        rescheduledFromTripId: trip.tripId,
        createdAt: serverTimestamp(),
      })

      // ติดป้าย postponed ที่จุดเดิม + เก็บ link ไว้ (audit + ใช้ลบใบถ้าเปลี่ยนใจ)
      const newStops = buildStops(trip, stopIdx, (s) => {
        const base = stripOutcome(s)
        return {
          ...base,
          outcome: 'postponed' as StopOutcome,
          outcomeRecordedBy: recordedBy,
          outcomeAt: new Date().toISOString(),
          postponedToDate: newDate,
          postponedRequestId: requestId,
        }
      })
      applyStops(trip.id, newStops, true)

      toast({ title: "เลื่อนงานแล้ว ✅", description: `ย้ายไป ${formatThaiDate(newDate)} — เข้ากองจัดเที่ยววิ่งวันนั้นเรียบร้อย` })
      setPostponeDialog(null)
    } catch (e) {
      console.error(e)
      toast({ title: "เลื่อนไม่สำเร็จ", description: "ลองใหม่อีกครั้ง (งานยังอยู่ที่เดิม ไม่หาย)", variant: "destructive" })
    } finally {
      setIsPostponing(false)
    }
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

  // guard 4: เตือน (ไม่ห้าม) ถ้าวันที่เลือกเลื่อนไปมีเที่ยววิ่งจัดไว้แล้ว
  React.useEffect(() => {
    if (!postponeDialog || !postponeDateStr || !db) { setPostponeWarn(""); return }
    let active = true
    getDocs(query(collection(db, "trips"), where("tripDate", "==", postponeDateStr)))
      .then(snap => {
        if (!active) return
        const n = snap.docs.filter(d => (d.data() as any).status !== 'Cancelled').length
        setPostponeWarn(n > 0
          ? `วันนี้มีเที่ยววิ่งจัดไว้แล้ว ${n} ทริป — ใบที่เลื่อนจะไปรอในกองจัด ต้องเข้าไปจัดเพิ่มเอง`
          : "")
      })
      .catch(() => { if (active) setPostponeWarn("") })
    return () => { active = false }
  }, [postponeDialog, postponeDateStr, db])

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
          {btn('reassigned', 'โยกงาน', ArrowRightLeft, 'border-blue-500/60 bg-blue-500/10 text-blue-400')}
          {btn('postponed', 'เลื่อน', CalendarClock, 'border-amber-500/60 bg-amber-500/10 text-amber-400')}
          {btn('driver-refused', 'คนขับปฏิเสธ', Ban, 'border-red-500/60 bg-red-500/10 text-red-400')}
        </div>
        {current === 'driver-refused' && (
          <input
            type="text"
            value={stop.outcomeReason || ''}
            placeholder="เหตุผลที่ปฏิเสธ (เช่น บอกไกล ไม่คุ้ม)"
            onChange={(e) => setRefuseReason(trip, sIdx, e.target.value, false)}
            onBlur={(e) => setRefuseReason(trip, sIdx, e.target.value, true)}
            className={inputClass}
          />
        )}
        {current === 'postponed' && stop.postponedToDate && (
          <p className="text-[11px] text-amber-400/90 flex items-center gap-1">
            <CalendarClock className="h-3 w-3" />
            เลื่อนไป {formatThaiDate(stop.postponedToDate)} — เข้ากองจัดเที่ยววิ่งวันนั้นแล้ว
          </p>
        )}
        {(current === 'reassigned' || current === 'driver-refused') && (
          <select
            value={stop.reassignedToTripId || ''}
            onChange={(e) => setReassignTarget(trip, sIdx, e.target.value)}
            className={cn(inputClass, "cursor-pointer")}
          >
            <option value="">
              {current === 'driver-refused'
                ? '-- มีคันรับไปทำแทนไหม? (กม. ลงคันนั้น) --'
                : '-- เลือกคันที่รับงานไปทำ (กม. ลงคันนั้น) --'}
            </option>
            {trips.filter(t => t.id !== trip.id).map(t => (
              <option key={t.id} value={t.id}>{t.driverName} • {t.vehiclePlate}</option>
            ))}
          </select>
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

              {/* ทางเลือกฟรี: คัดลอกข้อความไปวางในกลุ่มเอง (ไม่กินโควตา LINE) — ใช้ตอนโควตาบอทเต็ม */}
              <Button
                variant="outline"
                className="h-11 w-full font-bold"
                onClick={handleCopyMessage}
                disabled={trips.length === 0 || isLoading || !selectedDate}
              >
                {copiedMsg ? <Check className="mr-2 h-4 w-4 text-green-600" /> : <Copy className="mr-2 h-4 w-4" />}
                {copiedMsg ? "คัดลอกแล้ว — ไปวางในกลุ่ม LINE" : "คัดลอกข้อความ (ไม่กินโควตา)"}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center leading-snug">
                โควตาบอทเต็ม? กดคัดลอกแล้วเปิดกลุ่ม LINE → วาง (Paste) → ส่งเอง · ฟรีไม่จำกัด
              </p>
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

                          // คนขับจริง (ขับแทน) มีผลทั้งชื่อ+เบอร์ในใบสรุป
                          const actualDriver = (trip as any).actualDriverName as string | undefined;
                          const driverPhone = getDriverPhone((trip as any).actualDriverId || trip.driverId);
                          // Jobs moved *into* this truck — the destination half, so this
                          // driver/sheet (and the LINE image) actually shows the handover.
                          const incoming = incomingStopsForTrip(trips as any, trip.id);
                          const totalRows = stops.length + incoming.length;

                          const stopRows = stops.map((stop, sIdx) => {
                            const locationText = (stop as any).address || (stop as any).zone || "";
                            const stopRequester = stop.requestedBy || (trip as any).requestedBy || "";
                            const requesterPhone = (stop as any).requestedByPhone || "";
                            
                            const requesterNote = (stop as any).note || (stop as any).notes || "";
                            const stopDispatcherNote = (trip as any).stopNotes?.[`stop_${sIdx}`] || (stop as any).dispatcherNote;
                            // ชื่อคนจัดรถ: per-stop map ก่อน แล้ว fallback ไปชื่อที่พกมากับ stop ตอนสร้างทริป (โน้ตที่เซฟก่อนจัดกลุ่ม)
                            const stopDispatcherBy = (trip as any).stopNoteAuthors?.[`stop_${sIdx}`] || (stop as any).dispatcherName;
                            const stopTime = (stop as any).requestTime;
                            // Public-safe: if the job was picked up by another truck (โยก, or a
                            // refusal someone took over) we only reveal where it went — never "ปฏิเสธ".
                            const movedToPlate = (stop as any).reassignedToVehiclePlate;
                            const movedToDriver = (stop as any).reassignedToDriverName;

                            return (
                              <tr key={`${trip.id}-${sIdx}`}>
                                {sIdx === 0 && (
                                  <td className="border border-black p-2 text-center align-top" rowSpan={totalRows}>
                                    {formatThaiDate((trip as any).tripDate || (trip as any).date || "")}
                                  </td>
                                )}
                                <td className="border border-black p-2 text-center align-top font-bold whitespace-nowrap">
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
                                            ...(movedToPlate
                                              ? { background: '#dbeafe', color: '#1e40af' }
                                              : { background: '#fef3c7', color: '#92400e' }),
                                          }}
                                        >
                                          {movedToPlate
                                            ? `🔄 โยกไปให้ ${movedToDriver ? movedToDriver + ' ' : ''}(${movedToPlate})`
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
                                          ✏️ {stopDispatcherNote}{stopDispatcherBy ? ` (โดย ${stopDispatcherBy})` : ''}
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
                                  <td className="border border-black p-2 align-top" rowSpan={totalRows}>
                                    <div className="flex justify-between items-start">
                                      <div className="space-y-2">
                                        <div>
                                          <p className="font-bold">คนขับ: {actualDriver || trip.driverName}</p>
                                          {actualDriver && (
                                            <p className="text-[11px] font-bold text-orange-700">🔁 ขับแทน {trip.driverName}</p>
                                          )}
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

                          // Extra rows for jobs reassigned INTO this truck (public-safe: รับงานต่อ)
                          const incomingRows = incoming.map((job, i) => (
                            <tr key={`${trip.id}-inc-${i}`} className="bg-blue-50">
                              <td className="border border-black p-2 text-center align-top font-bold">—</td>
                              <td className="border border-black p-2 align-top">
                                <div className="space-y-1">
                                  <div className="flex gap-1.5 font-bold items-center flex-wrap">
                                    <span>{stops.length + i + 1}.</span>
                                    <span>{job.siteName || "ไม่ระบุสถานที่"}</span>
                                    <span style={{
                                      fontSize: '11px', fontWeight: 700, padding: '1px 6px',
                                      borderRadius: '4px', background: '#dbeafe', color: '#1e40af',
                                    }}>
                                      🔄 รับโยกงานต่อ
                                    </span>
                                  </div>
                                  <div className="pl-5 space-y-0.5">
                                    {job.cargoDetails && (
                                      <div className="flex gap-2">
                                        <span className="shrink-0">-</span>
                                        <span className="italic" style={{ whiteSpace: 'pre-wrap' }}>{job.cargoDetails}</span>
                                      </div>
                                    )}
                                    {(job.fromVehiclePlate || job.fromDriverName) && (
                                      <div className="pl-3 text-[10px] text-gray-600">
                                        โยกมาจาก {job.fromVehiclePlate}{job.fromDriverName ? ` (${job.fromDriverName})` : ""}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ));

                          return [...stopRows, ...incomingRows];
                        })}
                      </tbody>
                    </table>

                    <div className="mt-8 flex justify-between text-sm">
                      <div className="space-y-1 font-bold">
                        <p>รวม: {trips.length} เที่ยว</p>
                        <p>ระยะทางรวม (วิ่งจริง): {totalDistance.toFixed(1)} กม.</p>
                        <p>ค่าน้ำมันโดยประมาณ: {totalFuelCost.toLocaleString('th-TH', { maximumFractionDigits: 0 })} บาท</p>
                      </div>
                      <div className="flex gap-12">
                        <div className="text-center w-48">
                          <div className="h-10 border-b border-black mb-2"></div>
                          <p>ลายเซ็นผู้อนุมัติ</p>
                          <p className="text-xs">วันที่ ______/______/______</p>
                        </div>
                      </div>
                    </div>

                    {topDrivers.length > 0 && (
                      <div className="mt-6 border-2 border-gray-400 rounded-lg p-3">
                        <p className="font-bold text-center mb-3 text-[14px]">
                          🏆 สุดยอดนักขับประจำเดือน{new Date(selectedDate + 'T00:00:00').toLocaleDateString('th-TH', { month: 'long' })}
                        </p>
                        <div className="flex justify-center gap-10">
                          {topDrivers.map((d, i) => (
                            <div key={d.driverId} className="text-center">
                              <div className="text-2xl leading-none">{['🥇', '🥈', '🥉'][i]}</div>
                              <div className="font-bold mt-1">{d.driverName}</div>
                              <div className="text-gray-600 text-[12px]">{Math.round(d.actualKm).toLocaleString()} กม.</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                🔄 โยกงาน {outcomeStats.counts.reassigned}
              </span>
              <span className="rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 px-3 py-1">
                ⏭️ เลื่อน {outcomeStats.counts.postponed}
              </span>
              <span className="rounded-full bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-1">
                🚫 คนขับปฏิเสธ {outcomeStats.counts.refused}
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
                    {/* คนขับจริง (ขับแทน) — เมื่อคนขับประจำลา ให้เลือกคนที่ขับจริง เครดิต กม./อันดับจะไปหาคนนั้น */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">ขับแทนโดย:</span>
                      <select
                        value={trip.actualDriverId || ""}
                        onChange={(e) => setActualDriver(trip.id, e.target.value)}
                        className="flex-1 min-w-0 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                      >
                        <option value="">— คนขับประจำ ({trip.driverName}) —</option>
                        {(driversData || [])
                          .filter((d) => d.id !== trip.driverId)
                          .map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                      </select>
                    </div>
                    {trip.actualDriverId && (
                      <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400">
                        🔁 วันนี้ <b>{trip.actualDriverName}</b> ขับแทน {trip.driverName} — เครดิต กม./อันดับ นับให้ {trip.actualDriverName}
                      </p>
                    )}
                    <div className="space-y-2">
                      {(trip.stops || []).map((stop, sIdx) => renderStopRow(trip, stop, sIdx))}
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
              <Info className="h-3 w-3" />
              บันทึกอัตโนมัติทันทีที่แตะ — งานที่ถูกโยก/เลื่อนจะแสดงในใบงานเวอร์ชันใหม่ ส่วน “คนขับปฏิเสธ” เก็บไว้ดูเงียบ ๆ ไม่ขึ้นในรูปที่ส่งกลุ่ม (ในกลุ่มเห็นแค่ว่าโยกไปคันไหน)
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

      {/* เลื่อนงาน: เลือกวันใหม่ → สร้างใบขอรถ rescheduled เข้ากองจัดเที่ยววิ่งวันนั้น */}
      <Dialog open={!!postponeDialog} onOpenChange={(open) => { if (!open && !isPostponing) setPostponeDialog(null) }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-amber-400" /> เลื่อนงานไปวันใหม่
            </DialogTitle>
            <DialogDescription>
              {postponeDialog
                ? `จุด: ${trips.find(t => t.id === postponeDialog.tripId)?.stops?.[postponeDialog.stopIdx]?.siteName || ''} — ระบบจะดึงจุดนี้ออกจากใบสรุป แล้วสร้างเป็นงานใหม่รอจัดในวันที่เลือก`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <label className="text-sm font-medium text-foreground">เลื่อนไปวันที่</label>
            <input
              type="date"
              value={postponeDateStr}
              min={tomorrowStr()}
              onChange={(e) => setPostponeDateStr(e.target.value)}
              className="w-full h-11 rounded-lg bg-background border border-border/50 text-sm px-3 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {postponeWarn && (
              <p className="text-[12px] text-amber-400 flex items-start gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 p-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {postponeWarn}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPostponeDialog(null)} disabled={isPostponing}>ยกเลิก</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
              onClick={handlePostpone}
              disabled={isPostponing || !postponeDateStr}
            >
              {isPostponing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
              {isPostponing ? "กำลังเลื่อน..." : "ยืนยันเลื่อน"}
            </Button>
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
