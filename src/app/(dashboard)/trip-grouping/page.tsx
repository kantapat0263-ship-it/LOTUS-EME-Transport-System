"use client"

import * as React from "react"
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, serverTimestamp, setDoc, updateDoc, arrayUnion, getDocs, getDoc } from "firebase/firestore"
import { Vehicle, Driver, Site, CompanySetting, Trip } from "@/types/models"
import { GroupingMap } from "@/components/trip-grouping/GroupingMap"
import { DestinationCard } from "@/components/trip-grouping/DestinationCard"
import { TripControlPanel } from "@/components/trip-grouping/TripControlPanel"
import { Loader2, Inbox, AlertTriangle, ListOrdered, Trash2, RotateCcw, Zap, CheckCircle2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"

type GroupingMode = 'auto' | 'manual';

export default function TripGroupingPage() {
  const { user } = useUser()
  const db = useFirestore()
  const { toast } = useToast()

  // States
  const [mode, setMode] = React.useState<GroupingMode>('auto')
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [manualOrder, setManualOrder] = React.useState<string[]>([])
  const [optimizedOrder, setOptimizedOrder] = React.useState<string[]>([])
  const [selectedDateFilter, setSelectedDateFilter] = React.useState<string>("all")
  // ย้ายวันใช้รถของใบขอ (คนจัดเลื่อนงานเองได้ เช่น พรุ่งนี้ → วันนี้ เพราะคนขับว่าง)
  const [moveDialog, setMoveDialog] = React.useState<{ vrDocId: string; vrId: string; siteName: string; currentDate: string } | null>(null)
  const [moveDate, setMoveDate] = React.useState("")
  const [isMovingDate, setIsMovingDate] = React.useState(false)
  // ยกเลิกใบขอ (ปฏิเสธ) จากในกองจัดคิว
  const [cancelDialog, setCancelDialog] = React.useState<{ vrDocId: string; vrId: string; siteName: string } | null>(null)
  const [cancelReason, setCancelReason] = React.useState("")
  const [isCancelling, setIsCancelling] = React.useState(false)
  const [hoveredDestId, setHoveredDestId] = React.useState<string | null>(null)
  
  const [vehicleId, setVehicleId] = React.useState("")
  const [driverId, setDriverId] = React.useState("")
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false)
  const [isProcessing, setIsProcessing] = React.useState(false)

  // Merge Dialog State
  const [mergeDialog, setMergeDialog] = React.useState<{
    show: boolean;
    existingTrip?: any;
    newStops?: any[];
  }>({ show: false })

  // Base Data Fetching
  const vRef = useMemoFirebase(() => collection(db, "vehicles"), [db])
  const dRef = useMemoFirebase(() => collection(db, "drivers"), [db])
  // Updated query to exclude 'pending' - only show jobs acknowledged or partially assigned
  const vrRef = useMemoFirebase(() => query(
    collection(db, "vehicleRequests"), 
    where("status", "in", ["in_progress", "partial", "rescheduled"])
  ), [db])
  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])

  const { data: vehicles, isLoading: loadingVehicles } = useCollection<Vehicle>(vRef)
  const { data: drivers, isLoading: loadingDrivers } = useCollection<Driver>(dRef)
  const { data: requests, isLoading: loadingRequests } = useCollection<any>(vrRef)
  const { data: settings } = useDoc<CompanySetting>(settingsRef)

  // Flatten destinations from VRs
  const availableDestinations = React.useMemo(() => {
    if (!requests) return []
    const list: any[] = []
    requests.forEach(req => {
      const assigned = req.assignedDestinations || []
      req.destinations.forEach((dest: any, idx: number) => {
        if (!assigned.includes(idx)) {
          list.push({
            ...dest,
            id: `${req.id}-${idx}`,
            vrId: req.requestId,
            vrDocId: req.id,
            destIndex: idx,
            requestedBy: req.requestedBy,
            requestedByPhone: req.requestedByPhone || "",
            // เวลาส่งคำขอ (ms) — ติดไปกับ stop ตอนจัดรถ ให้คนจัดคิวดูย้อนหลังได้ว่าส่งมากี่โมง
            requestedAt: req.createdAt?.toMillis?.() ?? null,
            requestDate: req.requestDate,
            requestTime: dest.requestTime || req.requestTime || "08:30",
            note: req.note || req.notes || "",
            dispatcherNote: req.stopNotes?.[`stop_${idx}`] || "",
            // ชื่อคนจัดรถต่อจุด (map ใหม่) ก่อน — ฟิลด์เก่าเป็นชื่อคนเซฟล่าสุดทั้งใบ ใช้เป็น fallback
            dispatcherName: req.stopNoteAuthors?.[`stop_${idx}`] || req.stopNotesUpdatedBy || ""
          })
        }
      })
    })
    return list
  }, [requests])

  // Dynamic Data Fetching based on selected date
  const targetDateStr = React.useMemo(() => {
    if (selectedDateFilter !== 'all') return selectedDateFilter
    if (availableDestinations.length > 0) {
      return availableDestinations[0]?.requestDate || new Date().toISOString().split('T')[0]
    }
    return new Date().toISOString().split('T')[0]
  }, [selectedDateFilter, availableDestinations])

  const tripsTodayRef = useMemoFirebase(() => query(
    collection(db, "trips"),
    where("tripDate", "==", targetDateStr)
  ), [db, targetDateStr])

  const { data: tripsToday } = useCollection<any>(tripsTodayRef)

  const availableDates = React.useMemo(() => {
    const dateMap: Record<string, number> = {}
    availableDestinations.forEach(dest => {
      const d = dest.requestDate || ""
      if (d) dateMap[d] = (dateMap[d] || 0) + 1
    })
    return Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }))
  }, [availableDestinations])

  // ออปชัน A: ค่าเริ่มต้นเลือก "วันแรกที่มีงาน" อัตโนมัติ (แทน "ทั้งหมด")
  // กันเจ้าหน้าที่เผลอเลือกการ์ดข้ามวันตั้งแต่ตอนเลือก — ยังกด "ทั้งหมด" เองได้ถ้าต้องการ
  const didAutoPickDate = React.useRef(false)
  React.useEffect(() => {
    if (didAutoPickDate.current) return
    if (availableDates.length > 0) {
      setSelectedDateFilter(availableDates[0].date)
      didAutoPickDate.current = true
    }
  }, [availableDates])

  const filteredDestinations = React.useMemo(() => {
    if (selectedDateFilter === "all") return availableDestinations
    return availableDestinations.filter(d => d.requestDate === selectedDateFilter)
  }, [availableDestinations, selectedDateFilter])

  const currentOrderedIds = React.useMemo(() => {
    if (mode === 'manual') return manualOrder;
    return optimizedOrder.filter(id => selectedIds.has(id));
  }, [mode, manualOrder, optimizedOrder, selectedIds]);

  const selectedDestinations = React.useMemo(() => {
    const ids = mode === 'manual' ? manualOrder : currentOrderedIds;
    const items = ids.map(id => availableDestinations.find(d => d.id === id)).filter(Boolean);
    
    if (mode === 'auto') {
      const remaining = availableDestinations.filter(d => selectedIds.has(d.id) && !ids.includes(d.id));
      return [...items, ...remaining];
    }
    return items;
  }, [availableDestinations, selectedIds, manualOrder, currentOrderedIds, mode])

  const selectedVehicle = React.useMemo(() => 
    vehicles?.find(v => v.id === vehicleId), 
    [vehicles, vehicleId]
  )

  const handleToggleSelect = React.useCallback((id: string) => {
    if (mode === 'manual') {
      setManualOrder(prev => {
        if (prev.includes(id)) {
          return prev.filter(i => i !== id)
        }
        return [...prev, id]
      })
    } else {
      setSelectedIds(prev => {
        const newSet = new Set(prev)
        if (newSet.has(id)) newSet.delete(id)
        else newSet.add(id)
        return newSet
      })
    }
  }, [mode])

  // งานที่ต้องใช้รถมากกว่า 1 คัน: เพิ่ม "คันคู่" = ต่อท้ายสำเนา destination ในใบขอเดิม
  // (เก็บลงใบขอจริง → refresh ไม่หาย, มี index ของตัวเอง → ไม่แตะกลไก assignment เลย)
  // วันนี้ตามเวลาไทย (โค้ดหน้านี้เดิมใช้ UTC หลายจุด — ปุ่มย้ายวันยึดเวลาไทยให้ถูกต้อง)
  const thaiTodayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0]

  const openMoveDialog = (dest: any) => {
    setMoveDate(dest.requestDate || thaiTodayStr)
    setMoveDialog({ vrDocId: dest.vrDocId, vrId: dest.vrId, siteName: dest.siteName || dest.customName || "", currentDate: dest.requestDate || "" })
  }

  const confirmMoveDate = async () => {
    if (!moveDialog || !moveDate) return
    if (moveDate < thaiTodayStr) { toast({ title: "ย้ายไม่ได้", description: "เลือกวันย้อนหลังไม่ได้ — ได้ตั้งแต่วันนี้เป็นต้นไป", variant: "destructive" }); return }
    if (new Date(moveDate + 'T00:00:00').getDay() === 0) { toast({ title: "ย้ายไม่ได้", description: "วันอาทิตย์ไม่มีรอบวิ่ง — เลือกวันจันทร์–เสาร์", variant: "destructive" }); return }
    if (moveDate === moveDialog.currentDate) { setMoveDialog(null); return }
    setIsMovingDate(true)
    try {
      // อ่านสดกันเคสเพิ่งถูกจัดไประหว่างเปิด dialog — ใบที่มีจุดถูกจัดเข้าทริปแล้ว ย้ายไม่ได้ (ทริปอ้าง index อยู่)
      const snap = await getDoc(doc(db, "vehicleRequests", moveDialog.vrDocId))
      const fresh = snap.data() as any
      if (!fresh) throw new Error("request missing")
      if ((fresh.assignedDestinations || []).length > 0) {
        toast({ title: "ย้ายไม่ได้", description: "ใบขอนี้มีจุดที่ถูกจัดเข้าทริปแล้ว — ต้องจัดการที่ทริปแทน", variant: "destructive" })
        return
      }
      await updateDoc(doc(db, "vehicleRequests", moveDialog.vrDocId), {
        requestDate: moveDate,
        movedDateFrom: moveDialog.currentDate, // เก็บวันเดิมไว้ audit
        movedDateBy: user?.displayName || user?.email || "dispatcher",
        updatedAt: serverTimestamp(),
      })
      toast({ title: "ย้ายวันแล้ว 📅", description: `"${moveDialog.siteName}" ย้ายไปวันที่ ${moveDate.split('-').reverse().join('/')} — ไปโผล่ในกองของวันนั้นแล้ว` })
      setMoveDialog(null)
    } catch (e) {
      console.error(e)
      toast({ title: "ย้ายวันไม่สำเร็จ", variant: "destructive" })
    } finally {
      setIsMovingDate(false)
    }
  }

  const openCancelDialog = (dest: any) => {
    setCancelReason("")
    setCancelDialog({ vrDocId: dest.vrDocId, vrId: dest.vrId, siteName: dest.siteName || dest.customName || "" })
  }

  const confirmCancel = async () => {
    if (!cancelDialog) return
    const reason = cancelReason.trim()
    if (!reason) { toast({ title: "ระบุเหตุผล", description: "ช่วยระบุเหตุผลที่ยกเลิก เพื่อให้ผู้ขอทราบ", variant: "destructive" }); return }
    setIsCancelling(true)
    try {
      // ใบที่มีจุดถูกจัดเข้าทริปแล้ว ยกเลิกจากตรงนี้ไม่ได้ (ทริปยังอ้างอยู่) — อ่านสดกัน race
      const snap = await getDoc(doc(db, "vehicleRequests", cancelDialog.vrDocId))
      const fresh = snap.data() as any
      if (!fresh) throw new Error("request missing")
      if ((fresh.assignedDestinations || []).length > 0) {
        toast({ title: "ยกเลิกไม่ได้", description: "ใบขอนี้มีจุดที่ถูกจัดเข้าทริปแล้ว — ต้องจัดการที่ทริปแทน", variant: "destructive" })
        return
      }
      await updateDoc(doc(db, "vehicleRequests", cancelDialog.vrDocId), {
        status: "rejected",
        rejectReason: reason,
        rejectedBy: user?.displayName || user?.email || "Dispatcher",
        rejectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast({ title: "ยกเลิกใบขอแล้ว", description: `"${cancelDialog.siteName}" (${cancelDialog.vrId}) — ผู้ขอจะเห็นสถานะพร้อมเหตุผล` })
      setSelectedIds(prev => { const n = new Set(prev); [...prev].forEach(id => { if (id.startsWith(cancelDialog.vrDocId + "-")) n.delete(id) }); return n })
      setCancelDialog(null)
    } catch (e) {
      console.error(e)
      toast({ title: "ยกเลิกไม่สำเร็จ", variant: "destructive" })
    } finally {
      setIsCancelling(false)
    }
  }

  const duplicateDestination = async (dest: any) => {
    const req = requests?.find(r => r.id === dest.vrDocId)
    const orig = req?.destinations?.[dest.destIndex]
    if (!req || !orig) { toast({ title: "ไม่พบจุดต้นฉบับ", variant: "destructive" }); return }
    // สำเนา = ข้อมูลเดิมทั้งหมด (ตัด field ที่เป็น undefined — Firestore reject ทั้งก้อน)
    const copy: Record<string, any> = Object.fromEntries(
      Object.entries(orig).filter(([k, v]) => v !== undefined && k !== "pairedCopy" && k !== "pairedFromIndex")
    )
    copy.pairedCopy = true
    copy.pairedFromIndex = dest.destIndex
    try {
      await updateDoc(doc(db, "vehicleRequests", dest.vrDocId), {
        destinations: [...req.destinations, copy],
        updatedAt: serverTimestamp(),
      })
      toast({ title: "เพิ่มคันคู่แล้ว 🚛🚛", description: `"${dest.siteName}" มีสำเนาในกองอีก 1 ใบ — หยิบไปจัดให้อีกคันได้เลย` })
    } catch (e) {
      console.error(e)
      toast({ title: "เพิ่มคันคู่ไม่สำเร็จ", variant: "destructive" })
    }
  }

  // ถอนสำเนาคันคู่ — เฉพาะยังไม่ถูกจัด และต้องไม่มีจุดที่ "ถูกจัดแล้ว" อยู่หลังตำแหน่งนี้
  // (ลบ element กลาง array จะทำให้ index ของ assignedDestinations ที่ตามมาเพี้ยน)
  const removeDuplicate = async (dest: any) => {
    const req = requests?.find(r => r.id === dest.vrDocId)
    if (!req?.destinations?.[dest.destIndex]?.pairedCopy) return
    const assigned: number[] = req.assignedDestinations || []
    if (assigned.includes(dest.destIndex)) { toast({ title: "ถอนไม่ได้", description: "สำเนานี้ถูกจัดเข้าทริปแล้ว", variant: "destructive" }); return }
    if (assigned.some(i => i > dest.destIndex)) {
      toast({ title: "ถอนไม่ได้", description: "มีจุดที่ถูกจัดแล้วอยู่ถัดจากสำเนานี้ — ลบแล้วลำดับจะเพี้ยน", variant: "destructive" })
      return
    }
    if (!window.confirm(`ถอนคันคู่ "${dest.siteName}" ออกจากกอง?`)) return
    try {
      await updateDoc(doc(db, "vehicleRequests", dest.vrDocId), {
        destinations: req.destinations.filter((_: any, i: number) => i !== dest.destIndex),
        updatedAt: serverTimestamp(),
      })
      setSelectedIds(prev => { const n = new Set(prev); n.delete(dest.id); return n })
      toast({ title: "ถอนคันคู่แล้ว", description: `เอาสำเนา "${dest.siteName}" ออกจากกองเรียบร้อย` })
    } catch (e) {
      console.error(e)
      toast({ title: "ถอนไม่สำเร็จ", variant: "destructive" })
    }
  }

  const handleCreateTrip = React.useCallback(async () => {
    const count = mode === 'manual' ? manualOrder.length : selectedIds.size
    if (count === 0) {
      toast({ title: "ข้อมูลไม่ครบ", description: mode === 'manual' ? "กรุณาเลือกจุดหมายบน Map" : "กรุณาเลือกอย่างน้อย 1 จุดหมาย", variant: "destructive" })
      return
    }
    if (!vehicleId || !driverId) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาเลือกคนขับและรถที่จะใช้", variant: "destructive" })
      return
    }

    // งานคันคู่: ต้นฉบับ+สำเนาจุดเดียวกัน ไม่ควรอยู่คันเดียวกัน (ผิดจุดประสงค์ "รถหลายคัน")
    const pairConflict = selectedDestinations.some((a: any) =>
      selectedDestinations.some((b: any) =>
        a !== b && a.vrDocId === b.vrDocId && (
          (b.pairedCopy && b.pairedFromIndex === a.destIndex) ||
          (a.pairedCopy && b.pairedCopy && a.pairedFromIndex === b.pairedFromIndex && a.destIndex < b.destIndex)
        )
      )
    )
    if (pairConflict && !window.confirm(
      "มีจุด 'คันคู่' (ต้นฉบับ + สำเนา) ถูกเลือกเข้าคันเดียวกัน — ปกติควรแยกคนละคัน\nยืนยันจัดเข้าคันเดียวกัน?"
    )) return

    const uniqueDates = Array.from(new Set(selectedDestinations.map(d => d.requestDate).filter(Boolean)))
    if (uniqueDates.length > 1) {
      const formatted = uniqueDates.map(ds => {
        const [y, m, d] = ds.split('-')
        return `${d}/${m}/${y}`
      }).join(', ')
      toast({
        title: "เลือกข้ามวันไม่ได้",
        description: `จุดที่เลือกมาจากหลายวัน (${formatted}) กรุณาจัดเที่ยวแยกตามวัน`,
        variant: "destructive"
      })
      return
    }

    // Check if driver already has a trip on the target date
    const targetDateStrForCheck = selectedDestinations[0]?.requestDate || new Date().toISOString().split('T')[0];
    const tripsOnTargetDate = await getDocs(query(collection(db, "trips"), where("tripDate", "==", targetDateStrForCheck), where("driverId", "==", driverId)));
    const existingTrip = tripsOnTargetDate.docs.map(d => ({...d.data(), id: d.id})).find((t: any) => t.status !== 'Cancelled');

    if (existingTrip) {
      setMergeDialog({
        show: true,
        existingTrip,
        newStops: selectedDestinations
      })
      return
    }

    setIsConfirmOpen(true)
  }, [selectedIds.size, manualOrder.length, vehicleId, driverId, mode, toast, selectedDestinations, db])

  const confirmCreateTrip = async () => {
    setIsProcessing(true)
    try {
      // ด่าน 2: re-read สถานะใบสดๆ ก่อนเขียน — กันจัดทับ/ฟื้นใบที่เพิ่งถูกยกเลิก (race / un-reject)
      const GROUPABLE = ["pending", "in_progress", "partial", "rescheduled"]
      const vrDocIds = Array.from(new Set(selectedDestinations.map(d => d.vrDocId)))
      const freshStatus: Record<string, string> = {}
      await Promise.all(vrDocIds.map(async (id) => {
        const snap = await getDoc(doc(db, "vehicleRequests", id))
        freshStatus[id] = snap.exists() ? (snap.data().status as string) : "missing"
      }))
      const dests = selectedDestinations.filter(d => GROUPABLE.includes(freshStatus[d.vrDocId]))
      if (dests.length === 0) {
        toast({ title: "จัดไม่ได้", description: "ใบคำขอที่เลือกถูกยกเลิก/เปลี่ยนสถานะไปแล้ว — รีเฟรชแล้วเลือกใหม่", variant: "destructive" })
        return
      }
      if (dests.length < selectedDestinations.length) {
        toast({ title: "ข้ามบางจุด", description: `ข้าม ${selectedDestinations.length - dests.length} จุด เพราะใบถูกยกเลิกระหว่างจัด` })
      }

      const selectedDriver = drivers?.find(d => d.id === driverId)
      const now = new Date();
      const tripDateStr = dests[0]?.requestDate || now.toISOString().split('T')[0];
      const tripDateObj = new Date(tripDateStr + 'T00:00:00');
      const d = String(tripDateObj.getDate()).padStart(2, '0');
      const m = String(tripDateObj.getMonth() + 1).padStart(2, '0');
      const datePrefix = `T-${d}${m}`;
      const qTrips = query(collection(db, "trips"), where("tripDate", "==", tripDateStr));
      const snapTrips = await getDocs(qTrips);
      const sequence = String(snapTrips.size + 1).padStart(3, '0');
      const safety = Math.floor(Math.random() * 10);
      const tripId = `${datePrefix}-${sequence}${safety}`;
      
      const lastStats = (window as any).__lastTripStats || { distance: 0, duration: 0, fuelCost: 0 }
      const warehousePos = { 
        lat: settings?.warehouseLatitude || 14.0815, 
        lng: settings?.warehouseLongitude || 100.7129 
      }

      await setDoc(doc(db, "trips", tripId), {
        id: tripId,
        tripId,
        tripDate: tripDateStr,
        vehicleId,
        vehiclePlate: selectedVehicle?.licensePlate || "",
        vehicleType: selectedVehicle?.type || "",
        driverId,
        driverName: selectedDriver?.name || "",
        status: "Planned",
        sourceVRIds: Array.from(new Set(dests.map(d => d.vrId))),
        totalDistanceKm: lastStats.distance || 0,
        totalEstimatedTimeMinutes: lastStats.duration || 0,
        fuelCost: lastStats.fuelCost || 0,
        // freeze ราคาน้ำมัน + อัตราสิ้นเปลืองที่ใช้ตอนสร้างทริป เพื่อให้ต้นทุนย้อนหลังไม่เปลี่ยนเวลาแก้ราคาใน settings
        dieselPriceUsed: lastStats.dieselPrice || settings?.dieselPrice || 32.5,
        fuelRateUsed: lastStats.fuelRate || settings?.defaultFuelRate || 10,
        createdAt: serverTimestamp(),
        departurePoint: settings?.warehouseName || "คลังสินค้า LOTUS EME",
        originLat: warehousePos.lat,
        originLng: warehousePos.lng,
        stops: dests.map((d, index) => ({
          order: index + 1,
          siteId: d.siteId || null,
          siteName: d.siteName || d.customName,
          lat: d.lat,
          lng: d.lng,
          cargoDetails: d.jobDescription || '',
          requestedBy: d.requestedBy || '',
          requestedByPhone: d.requestedByPhone || '',
          ...(d.requestedAt != null ? { requestedAt: d.requestedAt } : {}), // ห้ามใส่ undefined ลง Firestore
          requestTime: d.requestTime || '',
          address: d.address || '',
          note: d.note || "",
          dispatcherNote: d.dispatcherNote || "",
          dispatcherName: d.dispatcherName || ""
        }))
      })

      const vrGroups: Record<string, number[]> = {}
      dests.forEach(d => {
        if (!vrGroups[d.vrDocId]) vrGroups[d.vrDocId] = []
        vrGroups[d.vrDocId].push(d.destIndex)
      })

      // Update every source vehicle request in parallel instead of
      // awaiting them one-by-one (previously O(n) sequential round-trips).
      await Promise.all(
        Object.entries(vrGroups).map(([docId, indexes]) => {
          const vr = requests?.find(r => r.id === docId)
          if (!vr) return null
          const newAssigned = [...(vr.assignedDestinations || []), ...indexes]
          const isComplete = newAssigned.length === vr.destinations.length
          return updateDoc(doc(db, "vehicleRequests", docId), {
            assignedDestinations: arrayUnion(...indexes),
            status: isComplete ? "approved" : "partial",
            tripId: isComplete ? tripId : vr.tripId || null,
            updatedAt: serverTimestamp()
          })
        })
      )

      toast({ title: "สำเร็จ", description: `สร้างเที่ยววิ่ง ${tripId} เรียบร้อยแล้ว` })
      resetAll()
    } catch (e) {
      console.error(e)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถสร้างเที่ยววิ่งได้", variant: "destructive" })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleMergeTrip = async () => {
    setIsProcessing(true)
    try {
      const { existingTrip, newStops } = mergeDialog
      if (!existingTrip || !newStops) return

      // ด่าน 2: re-read สถานะใบสดๆ ก่อนรวม — กันยัดจุด/ฟื้นใบที่เพิ่งถูกยกเลิก (dialog ค้างเปิด/race)
      const GROUPABLE = ["pending", "in_progress", "partial", "rescheduled"]
      const vrDocIds = Array.from(new Set(newStops.map(d => d.vrDocId)))
      const freshStatus: Record<string, string> = {}
      await Promise.all(vrDocIds.map(async (id) => {
        const snap = await getDoc(doc(db, "vehicleRequests", id))
        freshStatus[id] = snap.exists() ? (snap.data().status as string) : "missing"
      }))
      const validNewStops = newStops.filter(d => GROUPABLE.includes(freshStatus[d.vrDocId]))
      if (validNewStops.length === 0) {
        toast({ title: "รวมไม่ได้", description: "ใบคำขอที่เลือกถูกยกเลิก/เปลี่ยนสถานะไปแล้ว — รีเฟรชแล้วเลือกใหม่", variant: "destructive" })
        return
      }
      if (validNewStops.length < newStops.length) {
        toast({ title: "ข้ามบางจุด", description: `ข้าม ${newStops.length - validNewStops.length} จุด เพราะใบถูกยกเลิกระหว่างจัด` })
      }

      const currentStops = existingTrip.stops || []
      const lastOrder = currentStops.length > 0 
        ? Math.max(...currentStops.map((s: any) => s.order || 0))
        : 0

      const addedStops = validNewStops.map((d, index) => ({
        order: lastOrder + index + 1,
        siteId: d.siteId || null,
        siteName: d.siteName || d.customName,
        lat: d.lat,
        lng: d.lng,
        cargoDetails: d.jobDescription || '',
        requestedBy: d.requestedBy || '',
        requestedByPhone: d.requestedByPhone || '',
        ...(d.requestedAt != null ? { requestedAt: d.requestedAt } : {}),
        requestTime: d.requestTime || '',
        address: d.address || '',
        note: d.note || "",
        dispatcherNote: d.dispatcherNote || "",
        dispatcherName: d.dispatcherName || ""
      }))

      const mergedStops = [...currentStops, ...addedStops]
      const sourceVRIds = Array.from(new Set([
        ...(existingTrip.sourceVRIds || []),
        ...validNewStops.map(d => d.vrId)
      ]))

      await updateDoc(doc(db, "trips", existingTrip.id), {
        stops: mergedStops,
        sourceVRIds,
        updatedAt: serverTimestamp()
      })

      const vrGroups: Record<string, number[]> = {}
      validNewStops.forEach(d => {
        if (!vrGroups[d.vrDocId]) vrGroups[d.vrDocId] = []
        vrGroups[d.vrDocId].push(d.destIndex)
      })

      for (const [docId, indexes] of Object.entries(vrGroups)) {
        const vr = requests?.find(r => r.id === docId)
        if (vr) {
          const newAssigned = [...(vr.assignedDestinations || []), ...indexes]
          const isComplete = newAssigned.length === vr.destinations.length
          await updateDoc(doc(db, "vehicleRequests", docId), {
            assignedDestinations: arrayUnion(...indexes),
            status: isComplete ? "approved" : "partial",
            tripId: isComplete ? existingTrip.id : vr.tripId || null,
            updatedAt: serverTimestamp()
          })
        }
      }

      toast({ title: "สำเร็จ", description: `รวมจุดใหม่เข้า Trip ${existingTrip.tripId} ของ ${existingTrip.driverName} แล้ว` })
      resetAll()
    } catch (e) {
      console.error(e)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถรวม Trip ได้", variant: "destructive" })
    } finally {
      setIsProcessing(false)
    }
  }

  const resetAll = () => {
    setSelectedIds(new Set())
    setManualOrder([])
    setOptimizedOrder([])
    setVehicleId("")
    setDriverId("")
    setIsConfirmOpen(false)
    setMergeDialog({ show: false })
    // กลับไปเริ่มที่ "วันแรกที่มีงาน" อัตโนมัติอีกครั้ง (ออปชัน A) ไม่เด้งกลับเป็น "ทั้งหมด"
    didAutoPickDate.current = false
    setSelectedDateFilter(availableDates[0]?.date || "all")
    setHoveredDestId(null)
    sessionStorage.removeItem("pendingVR")
  }

  const handleModeChange = (newMode: GroupingMode) => {
    if (newMode === 'manual') {
      setManualOrder([]);
      setSelectedIds(new Set());
      setOptimizedOrder([]);
      if (typeof window !== 'undefined') {
        (window as any).__lastTripStats = { distance: 0, fuelCost: 0 };
      }
      toast({ title: "โหมดจัดลำดับเอง", description: "กรุณาเลือกจุดหมายบนแผนที่ตามลำดับที่ต้องการ" });
    }
    setMode(newMode);
  }

  if (loadingRequests) {
    return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-accent" /></div>
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-in fade-in duration-500 gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight text-white">จัดกลุ่มเที่ยววิ่ง</h2>
        <p className="text-sm text-muted-foreground">รวมจุดส่งจากใบขอใช้รถที่ค้างอยู่เป็นเที่ยววิ่งเดียว</p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden min-h-0">
        <div className="lg:col-span-5 flex flex-col gap-3 overflow-y-auto pr-2 custom-scrollbar">
          {mode === 'manual' ? (
            <div className="space-y-3">
              <div className="bg-accent/10 p-4 rounded-xl border border-accent/30 sticky top-0 z-10 backdrop-blur flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-2 text-accent uppercase tracking-wider">
                    <ListOrdered className="h-4 w-4" /> ลำดับการส่ง (จัดเอง)
                  </h3>
                </div>
                <Button variant="outline" size="sm" onClick={() => setManualOrder([])} className="h-8 text-[10px] border-accent/40 text-accent">
                  <RotateCcw className="h-3 w-3 mr-1" /> ล้างลำดับ
                </Button>
              </div>

              {manualOrder.length > 0 ? (
                <div className="space-y-3 animate-in fade-in duration-300">
                  {selectedDestinations.map((dest, idx) => (
                    <DestinationCard key={dest.id} dest={dest} onMoveDate={!dest.pairedCopy ? () => openMoveDialog(dest) : undefined} onCancel={!dest.pairedCopy ? () => openCancelDialog(dest) : undefined} isSelected={true} onToggle={() => handleToggleSelect(dest.id)} manualIndex={idx + 1} onHover={setHoveredDestId} />
                  ))}
                  {filteredDestinations.length > manualOrder.length && (
                    <div className="pt-4 pb-2 border-t border-border/30">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase px-2 mb-3">ยังไม่ได้เลือก</p>
                      <div className="space-y-3 opacity-60 grayscale-[0.5]">
                        {filteredDestinations.filter(d => !manualOrder.includes(d.id)).map(dest => (
                          <DestinationCard key={dest.id} dest={dest} onMoveDate={!dest.pairedCopy ? () => openMoveDialog(dest) : undefined} onCancel={!dest.pairedCopy ? () => openCancelDialog(dest) : undefined} isSelected={false} onToggle={() => handleToggleSelect(dest.id)} onHover={setHoveredDestId} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-center py-6 bg-secondary/10 rounded-2xl border border-dashed flex flex-col items-center gap-2">
                    <ListOrdered className="h-8 w-8 text-muted-foreground opacity-30" />
                    <p className="text-sm font-medium text-muted-foreground">แตะที่หมุดบนแผนที่เพื่อเริ่มจัดลำดับ</p>
                  </div>
                  <div className="space-y-3 opacity-80">
                    {filteredDestinations.map(dest => (
                      <DestinationCard key={dest.id} dest={dest} onMoveDate={!dest.pairedCopy ? () => openMoveDialog(dest) : undefined} onCancel={!dest.pairedCopy ? () => openCancelDialog(dest) : undefined} isSelected={false} onToggle={() => handleToggleSelect(dest.id)} onHover={setHoveredDestId}
                        onDuplicate={!dest.pairedCopy ? () => duplicateDestination(dest) : undefined}
                        onRemoveDup={dest.pairedCopy ? () => removeDuplicate(dest) : undefined} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-secondary/30 p-3 rounded-xl border border-border/50 sticky top-0 z-10 backdrop-blur space-y-2">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-accent" /> งานที่ค้างอยู่ในระบบ ({availableDestinations.length})
                </h3>
                <select
                  value={selectedDateFilter}
                  onChange={(e) => setSelectedDateFilter(e.target.value)}
                  className="w-full h-9 rounded-lg bg-background/80 border border-border/50 text-sm px-3 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="all">📋 ทั้งหมด ({availableDestinations.length} งาน)</option>
                  {availableDates.map(({ date, count }) => {
                    const [y, m, d] = date.split('-')
                    return (
                      <option key={date} value={date}>
                        📅 {d}/{m}/{y} ({count} งาน)
                      </option>
                    )
                  })}
                </select>
              </div>
              {filteredDestinations.length > 0 ? (
                <div className="space-y-3 pb-24">
                  {selectedDestinations.map((dest, idx) => (
                    <DestinationCard key={dest.id} dest={dest} onMoveDate={!dest.pairedCopy ? () => openMoveDialog(dest) : undefined} onCancel={!dest.pairedCopy ? () => openCancelDialog(dest) : undefined} isSelected={true} onToggle={() => handleToggleSelect(dest.id)} manualIndex={selectedIds.size > 1 ? idx + 1 : undefined} onHover={setHoveredDestId}
                      onDuplicate={!dest.pairedCopy ? () => duplicateDestination(dest) : undefined}
                      onRemoveDup={dest.pairedCopy ? () => removeDuplicate(dest) : undefined} />
                  ))}
                  {filteredDestinations.length > selectedIds.size && selectedIds.size > 0 && <div className="pt-4 border-t border-border/20" />}
                  {filteredDestinations.filter(d => !selectedIds.has(d.id)).map(dest => (
                    <DestinationCard key={dest.id} dest={dest} onMoveDate={!dest.pairedCopy ? () => openMoveDialog(dest) : undefined} onCancel={!dest.pairedCopy ? () => openCancelDialog(dest) : undefined} isSelected={false} onToggle={() => handleToggleSelect(dest.id)} onHover={setHoveredDestId}
                      onDuplicate={!dest.pairedCopy ? () => duplicateDestination(dest) : undefined}
                      onRemoveDup={dest.pairedCopy ? () => removeDuplicate(dest) : undefined} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 bg-secondary/10 rounded-2xl border border-dashed flex flex-col items-center gap-3">
                  <AlertTriangle className="h-10 w-10 text-muted-foreground opacity-50" />
                  <p className="text-sm font-medium text-muted-foreground">ไม่มีงานค้างในระบบ</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-7 rounded-xl overflow-hidden border border-border bg-card h-full min-h-[300px]">
          <GroupingMap 
            destinations={filteredDestinations} selectedIds={selectedIds} onSelect={handleToggleSelect} 
            selectedVehicleRate={selectedVehicle?.fuelRate} mode={mode} setMode={handleModeChange} 
            manualOrder={manualOrder} onOptimizedOrderChange={setOptimizedOrder}
            hoveredId={hoveredDestId}
          />
        </div>
      </div>

      <TripControlPanel 
        selectedCount={mode === 'manual' ? manualOrder.length : selectedIds.size}
        vehicles={vehicles || []} drivers={drivers || []} tripsToday={tripsToday || []}
        vehicleId={vehicleId} driverId={driverId} setVehicleId={setVehicleId} setDriverId={setDriverId}
        onCreate={handleCreateTrip} isProcessing={isProcessing} mode={mode}
      />

      {/* Confirmation Dialog */}
      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent className="max-w-md rounded-xl border-accent/20 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold text-accent">ยืนยันสร้างเที่ยววิ่ง</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm py-2 text-foreground/90 space-y-3">
                <div className="p-3 bg-secondary/50 rounded-lg space-y-1 border border-border">
                  <p>• โหมด: <span className="font-bold text-white">{mode === 'manual' ? "จัดลำดับเอง" : "อัตโนมัติ"}</span></p>
                  <p>• จำนวนจุดหมาย: <span className="font-bold text-white">{selectedDestinations.length} จุด</span></p>
                  <p>• ทะเบียนรถ: <span className="font-bold text-white">{selectedVehicle?.licensePlate}</span></p>
                  <p>• คนขับ: <span className="font-bold text-white">{drivers?.find(d => d.id === driverId)?.name}</span></p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 mt-4">
            <AlertDialogCancel className="h-10 text-sm flex-1">ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCreateTrip} className="h-10 text-sm flex-1 bg-accent" disabled={isProcessing}>
              {isProcessing ? "กำลังประมวลผล..." : "ยืนยันสร้างงาน"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ยกเลิกใบขอ (ปฏิเสธ) */}
      <Dialog open={!!cancelDialog} onOpenChange={(open) => !open && setCancelDialog(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2 text-red-400"><AlertTriangle className="h-5 w-5" /> ยกเลิกใบขอ</DialogTitle>
            <DialogDescription>
              ยกเลิก "{cancelDialog?.siteName}" ({cancelDialog?.vrId})? งานจะออกจากกองจัดคิว และผู้ขอจะเห็นสถานะ "ถูกปฏิเสธ" พร้อมเหตุผล
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="เหตุผลที่ยกเลิก (เช่น งานซ้ำ / ผู้ขอแจ้งยกเลิก / เลื่อนไปทำวันอื่นแล้ว)"
            rows={3}
            className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
          />
          <DialogFooter className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setCancelDialog(null)} disabled={isCancelling}>ไม่ยกเลิก</Button>
            <Button onClick={confirmCancel} disabled={isCancelling || !cancelReason.trim()} className="bg-red-600 hover:bg-red-700 font-bold text-white">
              {isCancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} ยืนยันยกเลิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ย้ายวันใช้รถ */}
      <Dialog open={!!moveDialog} onOpenChange={(open) => !open && setMoveDialog(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">📅 ย้ายวันใช้รถ</DialogTitle>
            <DialogDescription>
              "{moveDialog?.siteName}" ({moveDialog?.vrId}) เดิมวันที่ {moveDialog?.currentDate ? moveDialog.currentDate.split('-').reverse().join('/') : '-'}
              {' '}— เลือกวันใหม่ (วันนี้เป็นต้นไป เว้นวันอาทิตย์) ใบขอจะย้ายไปกองของวันนั้น
            </DialogDescription>
          </DialogHeader>
          <input
            type="date"
            value={moveDate}
            min={thaiTodayStr}
            onChange={(e) => setMoveDate(e.target.value)}
            className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
          />
          <DialogFooter className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setMoveDialog(null)} disabled={isMovingDate}>ยกเลิก</Button>
            <Button onClick={confirmMoveDate} disabled={isMovingDate || !moveDate} className="bg-amber-600 hover:bg-amber-700 font-bold text-white">
              {isMovingDate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} ย้ายวัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog open={mergeDialog.show} onOpenChange={(open) => !open && setMergeDialog({ show: false })}>
        <DialogContent className="max-w-md rounded-2xl bg-[#1e293b] border-accent/20">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2 text-orange-500">
              <AlertTriangle className="h-6 w-6" /> {drivers?.find(d => d.id === driverId)?.name} มี Trip แล้ววันนี้
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              Trip เดิม (ID: {mergeDialog.existingTrip?.tripId}) มี {mergeDialog.existingTrip?.stops?.length || 0} จุด ต้องการรวมจุดใหม่เข้า Trip เดิม หรือสร้าง Trip ใหม่?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
            <div className="space-y-2">
              <p className="text-xs font-bold text-white uppercase tracking-wider">จุดที่มีอยู่แล้ว:</p>
              {mergeDialog.existingTrip?.stops?.map((stop: any, i: number) => (
                <div key={i} className="text-xs text-gray-400 flex gap-2">
                  <span className="shrink-0">•</span> <span className="truncate">{stop.siteName}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2 pt-2 border-t border-gray-700">
              <p className="text-xs font-bold text-orange-400 uppercase tracking-wider">จุดใหม่ที่จะเพิ่ม (+{mergeDialog.newStops?.length}):</p>
              {mergeDialog.existingTrip?.newStops?.map((stop: any, i: number) => (
                <div key={i} className="text-xs text-orange-300 flex gap-2">
                  <span className="shrink-0">+</span> <span className="truncate">{stop.siteName}</span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
            <Button onClick={handleMergeTrip} className="bg-orange-600 hover:bg-orange-700 text-white font-bold" disabled={isProcessing}>
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />} รวม Trip เดิม
            </Button>
            <Button onClick={() => { setMergeDialog({ show: false }); setIsConfirmOpen(true); }} variant="secondary" className="bg-slate-700 text-white hover:bg-slate-600">
              ➕ สร้าง Trip ใหม่แยก
            </Button>
            <Button onClick={() => setMergeDialog({ show: false })} variant="ghost" className="col-span-full border border-gray-700 text-gray-400">
              ยกเลิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
