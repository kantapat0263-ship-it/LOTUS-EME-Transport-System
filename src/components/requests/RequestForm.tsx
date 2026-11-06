"use client"

import * as React from "react"
import { useFirestore, useCollection, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, setDoc, serverTimestamp, getDocs, query, where, runTransaction } from "firebase/firestore"
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
Save,
  ArrowUp,
  ArrowDown
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { editCustomDestination, matchCustomSite } from "@/lib/customSite"
import { COORDINATE_EXAMPLE, destinationCoordinateProblem, parseThaiCoordinates } from "@/lib/requestCoordinates"
import { inThailand } from "@/lib/roadFlood"
import { Site, UserProfile } from "@/types/models"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"
import { useContinuousQueues } from "@/hooks/use-continuous-queues"
import { QueueNoticeCard } from "@/components/continuous-queue/QueueNoticeCard"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { isOutsideRequestHours, requestHours } from "@/lib/requestWindow"
import { normalizeRequestTime } from "@/lib/requestTime"
import {
  URGENT_DETAIL_LIMITS, planUrgentCancel, urgentDetailsError, urgentFormStatus, urgentPrefill, urgentRejectReason, type UrgentDetails,
} from "@/lib/urgentRequest"
import { buildDropDescription, samePlace, type TransferRole } from "@/lib/transfer"
import { SEQUENCE_MAX_STOPS, sequenceShapeProblem } from "@/lib/sequence"

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
  allowSeparateSite?: boolean;
  locationType: string;
  requestTime: string;
  /** งานรับของไปส่งต่อ: จุดรับ (หลายจุดได้) + จุดส่ง 1 จุดท้ายใบ · ไม่มี = งานปกติ */
  transferRole?: TransferRole;
  /** งานไปหลายจุดตามลำดับ (lib/sequence) — ตัวบอกในฟอร์มเท่านั้น ลำดับ = ตำแหน่งการ์ด (ส่งเป็น sequenceIndex) */
  inSequence?: true;
}

/** การ์ดจุดหมายเปล่า (โหมดรับของไปส่งต่อ) */
const blankDestination = (transferRole?: TransferRole): DestinationRequest => ({
  id: crypto.randomUUID(), category: "all", searchTerm: "", siteId: "", siteName: "", customName: "", coordinates: "",
  jobDescription: "", saveAsSite: false, locationType: "ไซต์งาน", requestTime: "08:30", ...(transferRole ? { transferRole } : {}),
})
const placeChosen = (d: DestinationRequest) => (d.category !== "custom" && !!d.siteId) || (d.category === "custom" && !!d.customName.trim())
const placeName = (d: DestinationRequest) => (d.category === "custom" ? d.customName : d.siteName).trim()

const CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด', icon: Search, types: [] },
  { id: 'site', label: 'ไซต์งาน', icon: Building2, types: ['ไซต์งาน', 'ไซน์งาน', 'Electrical', 'Plumbing', 'HVAC', 'Mixed'] },
  { id: 'store', label: 'ร้านค้า', icon: Store, types: ['ร้านค้า / ซัพพลายเออร์'] },
  { id: 'bank', label: 'ธนาคาร', icon: Landmark, types: ['ธนาคาร'] },
  { id: 'company', label: 'บริษัท', icon: Briefcase, types: ['บริษัท / หน่วยงานราชการ'] },
  { id: 'custom', label: 'กำหนดเอง', icon: MapPin, types: [] },
] as const;

/**
 * รหัสการส่งใบที่ยังไม่ยืนยันผล ผูกกับ "เนื้อหาที่ส่งจริง" — กดส่งซ้ำด้วยเนื้อหาเดิม (เช่น ครั้งก่อนเน็ตหลุดหลังบันทึกสำเร็จ)
 * ใช้รหัสเดิม server จึงคืนใบเดิม ไม่สร้างใบซ้ำ · เนื้อหาเปลี่ยน (ไม่นับช่องค้นหา) = การส่งใหม่ ได้รหัสใหม่
 * เก็บระดับโมดูล (ไม่ใช่ state ของฟอร์ม) เพราะสลับแท็บ "คำขอของฉัน" แล้วฟอร์มถูกถอด — กรอกเนื้อหาเดิมกลับมาส่งยังได้รหัสเดิม
 */
let pendingOperation: { key: string; id: string } | null = null

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

  // ผลของคำขออนุมัติ "ใบล่าสุด" (ตัวเดียวกับ server) · ผู้ขอยกเลิกแล้ว = เหมือนยังไม่มีคำขอ (ขอใหม่ได้)
  const urgentStatus = React.useMemo(() => urgentFormStatus(urgentRequests), [urgentRequests])
  const rejectReason = React.useMemo(() => urgentRejectReason(urgentRequests), [urgentRequests])

  const minDateStr = React.useMemo(() => {
    const bangkokNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
    const { closeHour, openHour } = requestHours(settings)
    const currentHour = bangkokNow.getUTCHours()
    const daysToAdd = !isViewer ? 1 : (currentHour >= closeHour || currentHour < openHour) ? 2 : 1
    bangkokNow.setUTCDate(bangkokNow.getUTCDate() + daysToAdd)
    // ปิดรับวันอาทิตย์ — ถ้าวันเริ่มต้นตกวันอาทิตย์ ให้เลื่อนเป็นวันจันทร์
    if (bangkokNow.getUTCDay() === 0) bangkokNow.setUTCDate(bangkokNow.getUTCDate() + 1)
    return `${bangkokNow.getUTCFullYear()}-${String(bangkokNow.getUTCMonth() + 1).padStart(2, '0')}-${String(bangkokNow.getUTCDate()).padStart(2, '0')}`
  }, [settings, isViewer])

  /** ปิดรับคำขอวันอาทิตย์ (ไม่มีรอบวิ่ง) */
  const isSundayStr = (s: string) => !!s && new Date(s + 'T00:00:00').getDay() === 0

  const tomorrowStr = React.useMemo(() => {
    const bangkokNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
    bangkokNow.setUTCDate(bangkokNow.getUTCDate() + 1)
    const y = bangkokNow.getUTCFullYear()
    const m = String(bangkokNow.getUTCMonth() + 1).padStart(2, '0')
    const d = String(bangkokNow.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }, [])

  const todayStr = React.useMemo(() => {
    const bangkokNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
    return `${bangkokNow.getUTCFullYear()}-${String(bangkokNow.getUTCMonth() + 1).padStart(2, '0')}-${String(bangkokNow.getUTCDate()).padStart(2, '0')}`
  }, [])

  // วันขั้นต่ำที่เลือกได้ในปฏิทิน — staff (คนจัดคิว) เลือก "วันนี้" ได้ (งานเพิ่มด่วนหน้างาน)
  // ผู้ขอทั่วไป/viewer ยังต้องล่วงหน้าอย่างน้อยพรุ่งนี้เหมือนเดิม
  const calendarMinStr = isViewer ? tomorrowStr : todayStr

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [urgentApprovalRequested, setUrgentApprovalRequested] = React.useState(false)
  const [isSendingUrgent, setIsSendingUrgent] = React.useState(false)
  const [isCancellingUrgent, setIsCancellingUrgent] = React.useState(false)
  // หน้าต่างกรอกรายละเอียดสั้น ๆ ตอนขออนุมัติพิเศษ (null = ปิด)
  const [urgentDetails, setUrgentDetails] = React.useState<UrgentDetails | null>(null)
  const [requestedBy, setRequestedBy] = React.useState("")
  const [selectedDate, setSelectedDate] = React.useState("")
  const continuousQueues = useContinuousQueues(selectedDate)
  const [isCalendarOpen, setIsCalendarOpen] = React.useState(false)
  const [note, setNote] = React.useState("")
  const [destinations, setDestinations] = React.useState<DestinationRequest[]>([
    { id: "1", category: "all", searchTerm: "", siteId: "", siteName: "", customName: "", coordinates: "", jobDescription: "", saveAsSite: false, locationType: "ไซต์งาน", requestTime: "08:30" }
  ])

  const bangkokHour = new Date(new Date().getTime() + 7 * 60 * 60 * 1000).getUTCHours();
  const isOutsideHours = isOutsideRequestHours(bangkokHour, settings)
  
  const isSelectingTomorrow = selectedDate === tomorrowStr
  const isSelectingToday = !isViewer && selectedDate === todayStr
  const isBlockedByUrgent = isViewer && isOutsideHours && isSelectingTomorrow && urgentStatus !== 'approved'

  React.useEffect(() => {
    if (profile) {
      // รีเซ็ตเป็นค่าเริ่มต้น (พรุ่งนี้) ถ้ายังไม่เลือก / เลือกก่อนวันขั้นต่ำ / ตกวันอาทิตย์
      // ใช้ calendarMinStr → staff ที่ตั้งใจเลือก "วันนี้" จะไม่ถูกเด้งกลับ
      if (!selectedDate || selectedDate < calendarMinStr || isSundayStr(selectedDate)) {
        setSelectedDate(minDateStr)
      }
    }
  }, [profile?.role, settings, minDateStr, calendarMinStr, selectedDate])

  React.useEffect(() => {
    if (profile) {
      setRequestedBy(profile.name || user?.displayName || "")
    }
  }, [profile, user])

  const handleRequestUrgentApproval = () => {
    if (!user || !selectedDate) return

    if (urgentStatus === 'pending') {
      toast({ title: "รออนุมัติอยู่", description: "Dispatcher กำลังพิจารณาคำขอของคุณครับ" })
      return
    }
    if (urgentStatus === 'approved') {
      toast({ title: "ได้รับอนุมัติแล้ว", description: "กรอกใบขอรถได้เลยครับ" })
      return
    }
    // ให้คนจัดรถรู้ว่าไปไหน/ทำอะไร และติดต่อกลับได้ — เติมจากที่กรอกในฟอร์มไว้แล้ว
    setUrgentDetails(urgentPrefill(destinations, (profile as any)?.phone))
  }

  const submitUrgentApproval = async () => {
    if (!user || !selectedDate || !urgentDetails) return
    const error = urgentDetailsError(urgentDetails)
    if (error) {
      toast({ title: "ข้อมูลไม่ครบ", description: error, variant: "destructive" })
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
        destination: urgentDetails.destination.trim(),
        jobSummary: urgentDetails.jobSummary.trim(),
        contactPhone: urgentDetails.contactPhone.trim(),
        status: "pending",
        createdAt: serverTimestamp()
      })
      setUrgentDetails(null)
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

  // ผู้ขอยกเลิกคำขออนุมัติที่ยังรออยู่ (เช่น ไม่ต้องใช้รถแล้ว / กรอกผิดอยากขอใหม่) — ยกเลิกแล้วขอใหม่ได้
  // อ่านซ้ำใน transaction: คนจัดรถอาจเพิ่งกดอนุมัติ/ปฏิเสธระหว่างเปิดหน้าต่างยืนยัน → ไม่เขียนทับผลนั้น
  // ยกเลิกทุกใบของวันนั้นที่ยังรออนุมัติ (ส่งซ้ำจาก 2 เครื่องได้) — ไม่ให้ใบเก่าค้างที่การ์ดคนจัดรถ
  const cancelUrgentApproval = async () => {
    const refs = (urgentRequests ?? []).filter((r: any) => r.status === "pending").map((r: any) => doc(db, "urgentRequests", r.id))
    if (refs.length === 0) return
    setIsCancellingUrgent(true)
    try {
      const message = await runTransaction(db, async (t) => {
        const current = await Promise.all(refs.map(async (ref) => ({ ...(await t.get(ref)).data(), id: ref.id })))
        const plan = planUrgentCancel(current)
        for (const ref of refs) {
          if (plan.cancelIds.includes(ref.id)) t.update(ref, { status: "cancelled", cancelledAt: serverTimestamp() })
        }
        return plan.message
      })
      toast({ title: message })
    } catch (e) {
      toast({ title: "เกิดข้อผิดพลาด", variant: "destructive" })
    } finally {
      setIsCancellingUrgent(false)
    }
  }

  const updateDest = (id: string, updates: Partial<DestinationRequest>) => {
    setDestinations(prev => prev.map(d => {
      if (d.id === id) {
        const isCustomEdit = d.category === 'custom' && updates.category === undefined && updates.siteId === undefined &&
          (updates.customName !== undefined || updates.coordinates !== undefined)
        let updated = isCustomEdit ? editCustomDestination(d, updates) : { ...d, ...updates };
        
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

  // จุดที่เลือกจากรายการสถานที่: ใช้พิกัด "สด" ของสถานที่ ไม่ใช่ค่าที่จำไว้ตอนเลือก
  // (ทีมจัดรถเพิ่งเติมพิกัดให้ = ส่งได้ทันที ไม่ต้องเลือกสถานที่ใหม่หรือโหลดหน้าใหม่จนข้อมูลที่กรอกหาย)
  const liveCoordinates = (d: DestinationRequest) => {
    if (d.category === "custom" || !d.siteId) return d.coordinates
    const site = sites?.find(s => s.id === d.siteId)
    if (!site) return d.coordinates
    return site.latitude != null && site.longitude != null ? `${site.latitude}, ${site.longitude}` : ""
  }

  // ---- งานรับของไปส่งต่อ: ใบเดียว รับหลายจุด → ส่งจุดเดียว (เดิมต้องทำใบรับ + ใบส่งแยก 2 ใบ) ----
  const isTransfer = destinations.some(d => d.transferRole)
  const transferPickups = destinations.filter(d => d.transferRole === "pickup")
  /** ชื่อเรียกการ์ดในข้อความเตือน — โหมดรับ-ส่งบอกเป็น "จุดรับของที่ N / จุดส่งของ" ให้ผู้ขอหาเจอ */
  const pointLabel = (d: DestinationRequest) => d.transferRole === "pickup" ? `จุดรับของที่ ${transferPickups.indexOf(d) + 1}`
    : d.transferRole === "drop" ? "จุดส่งของ" : `จุดที่ ${destinations.indexOf(d) + 1}`
  const dropDescription = (extra: string) => buildDropDescription(transferPickups.map(p => ({ name: placeName(p), items: p.jobDescription })), extra)
  const hasContent = (d: DestinationRequest) => placeChosen(d) || !!d.jobDescription.trim() || !!d.coordinates.trim()

  // ---- งานไปหลายจุดตามลำดับ (ไป-กลับ): ใบเดียว รถคันเดียวไปตามลำดับที่กรอก — สถานที่ซ้ำได้ แต่จุดติดกันห้ามที่เดียวกัน ----
  const isSequence = !isTransfer && destinations.some(d => d.inSequence)
  type FormMode = "normal" | "transfer" | "sequence"
  const mode: FormMode = isTransfer ? "transfer" : isSequence ? "sequence" : "normal"
  const MODE_NAMES: Record<FormMode, string> = { normal: "งานปกติ", transfer: "รับของไปส่งต่อ", sequence: "ไปหลายจุดตามลำดับ" }
  /** เปลี่ยนประเภทงาน — การ์ดแรกที่กรอกไว้คงอยู่ (เป็นจุดแรกของแบบใหม่) · การ์ดอื่นหาย (ถามก่อนถ้ากรอกไว้) */
  const switchMode = (target: FormMode) => {
    if (target === mode) return
    if (destinations.slice(1).some(hasContent) && !window.confirm(`เปลี่ยนเป็น${MODE_NAMES[target]} — จะเหลือเฉพาะจุดแรก ข้อมูลจุดอื่นจะหายไป ยืนยัน?`)) return
    setDestinations(prev => {
      const { transferRole: _role, inSequence: _seq, ...first } = prev[0]
      // รับของไปส่งต่อ: การ์ดที่กรอกไว้ = จุดรับของจุดแรก แล้วเพิ่มการ์ดจุดส่งของต่อท้าย
      if (target === "transfer") return [{ ...first, transferRole: "pickup" }, blankDestination("drop")]
      if (target === "sequence") return [{ ...first, inSequence: true }, { ...blankDestination(), inSequence: true, requestTime: first.requestTime }]
      return [first]
    })
  }
  const addSequenceStop = () => setDestinations(prev => prev.length >= SEQUENCE_MAX_STOPS ? prev
    // เวลาเริ่มต้น = เวลาจุดก่อนหน้า (จุดถัดไปไม่ควรเร็วกว่า)
    : [...prev, { ...blankDestination(), inSequence: true, requestTime: prev[prev.length - 1]?.requestTime || "08:30" }])
  const removeSequenceStop = (id: string) => {
    const target = destinations.find(d => d.id === id)
    if (target && hasContent(target) && !window.confirm(`ลบ${pointLabel(target)}${placeName(target) ? ` (${placeName(target)})` : ""}?`)) return
    setDestinations(prev => prev.filter(d => d.id !== id))
  }
  const moveSequenceStop = (index: number, by: -1 | 1) => setDestinations(prev => {
    const to = index + by
    if (to < 0 || to >= prev.length) return prev
    const next = [...prev]
    ;[next[index], next[to]] = [next[to], next[index]]
    return next
  })
  /** ขากลับ: ใช้สถานที่เดียวกับจุดก่อนหน้า (ไม่ต้องค้นหาใหม่) — ไม่บันทึกสถานที่ซ้ำ */
  const copyPlaceFrom = (id: string, from: DestinationRequest) => updateDest(id, {
    category: from.category, searchTerm: "", siteId: from.siteId, siteName: from.siteName, customName: from.customName,
    // สถานที่ใหม่ที่ติ๊กบันทึก: ติ๊กตาม — server จับคู่กับสถานที่ที่กำลังบันทึกในใบนี้ ได้รหัสสถานที่เดียวกัน (ไม่บันทึกซ้ำ)
    coordinates: liveCoordinates(from), locationType: from.locationType, saveAsSite: from.saveAsSite, allowSeparateSite: from.allowSeparateSite ?? false,
  })
  const placeOf = (d: DestinationRequest) => ({ siteId: d.category !== "custom" && d.siteId ? d.siteId : null, ...(parseThaiCoordinates(liveCoordinates(d)) ?? {}) })
  const addPickup = () => setDestinations(prev => {
    const drop = prev.filter(d => d.transferRole === "drop")
    return [...prev.filter(d => d.transferRole !== "drop"), blankDestination("pickup"), ...drop]
  })
  const removePickup = (id: string) => {
    const target = destinations.find(d => d.id === id)
    if (target && hasContent(target) && !window.confirm(`ลบ${pointLabel(target)}${placeName(target) ? ` (${placeName(target)})` : ""}?`)) return
    setDestinations(prev => prev.filter(d => d.id !== id))
  }

const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDate || !user) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุวันที่", variant: "destructive" })
      return
    }
    if (isSundayStr(selectedDate)) {
      toast({ title: "วันอาทิตย์ปิดรับคำขอ", description: "กรุณาเลือกวันจันทร์–เสาร์", variant: "destructive" })
      return
    }
    // กันเลือกวันย้อนหลัง — staff เลือกได้เร็วสุด "วันนี้", viewer เร็วสุด "พรุ่งนี้"
    // คำนวณวันนี้ (เวลาไทย) สดๆ ตอนกดส่ง เพราะ todayStr/tomorrowStr เป็น useMemo ที่ตรึงค่าไว้ตั้งแต่ mount
    // ถ้าเปิดฟอร์มค้างข้ามเที่ยงคืน ค่าเดิมจะกลายเป็นวันย้อนหลังโดยไม่มีใครรู้
    const bangkokDateStr = (daysAhead: number) => {
      const n = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
      n.setUTCDate(n.getUTCDate() + daysAhead)
      return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`
    }
    const submitMinStr = bangkokDateStr(isViewer ? 1 : 0)
    if (selectedDate < submitMinStr) {
      toast({
        title: "วันที่ไม่ถูกต้อง",
        description: isViewer ? "ต้องขอล่วงหน้าอย่างน้อย 1 วัน" : "เลือกวันย้อนหลังไม่ได้",
        variant: "destructive",
      })
      return
    }

    if (isViewer) {
      const bangkokSubmitTime = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
      const { closeHour, openHour } = requestHours(settings)
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
          // ใบล่าสุดต้องอนุมัติ (เหมือน server) — ใบที่ผู้ขอยกเลิก/ถูกปฏิเสธใช้ส่งใบไม่ได้
          const urgentSnap = await getDocs(query(
            collection(db, "urgentRequests"),
            where("userId", "==", user.uid),
            where("requestedDate", "==", selectedDate)
          ))
          
          if (urgentFormStatus(urgentSnap.docs.map(d => d.data())) !== "approved") {
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

    if (isTransfer) {
      // โหมดรับ-ส่ง: ทุกการ์ดต้องเลือกสถานที่ (ไม่ตัดการ์ดว่างทิ้งเงียบ ๆ — จุดรับหายไปจุดเดียวของจะไม่ถูกรับ)
      const noPlace = destinations.find(d => !placeChosen(d))
      if (noPlace) {
        const removable = noPlace.transferRole === "pickup" && transferPickups.length > 1
        toast({ title: "ข้อมูลไม่ครบ", description: `${pointLabel(noPlace)}: ${noPlace.category === "custom" ? "ยังไม่ได้ใส่ชื่อสถานที่" : "ยังไม่ได้เลือกสถานที่"}${removable ? " (ไม่ใช้จุดนี้ให้กด \"ลบจุดนี้\")" : ""}`, variant: "destructive" })
        return
      }
      const noItems = transferPickups.find(d => !d.jobDescription.trim())
      if (noItems) {
        const name = placeName(noItems)
        toast({ title: "ข้อมูลไม่ครบ", description: `${pointLabel(noItems)}${name && name.length <= 80 ? ` (${name})` : ""}: ระบุของที่จะรับ`, variant: "destructive" })
        return
      }
      if (dropDescription(destinations.find(d => d.transferRole === "drop")?.jobDescription ?? "").length > 4000) {
        toast({ title: "รายละเอียดยาวเกิน", description: "รายการของรวมกันยาวเกิน 4,000 ตัวอักษร — ย่อรายการหรือแยกเป็นหลายใบ", variant: "destructive" })
        return
      }
    }

    if (isSequence) {
      // ทุกการ์ดต้องมีสถานที่ + บอกว่าทำอะไร (ไม่ตัดการ์ดว่างทิ้งเงียบ ๆ — จุดกลางหายไปเส้นทางจะผิด)
      const noPlace = destinations.find(d => !placeChosen(d))
      if (noPlace) {
        toast({ title: "ข้อมูลไม่ครบ", description: `${pointLabel(noPlace)}: ${noPlace.category === "custom" ? "ยังไม่ได้ใส่ชื่อสถานที่" : "ยังไม่ได้เลือกสถานที่"}${destinations.length > 2 ? " (ไม่ใช้จุดนี้ให้กด \"ลบจุดนี้\")" : ""}`, variant: "destructive" })
        return
      }
      const noTask = destinations.find(d => !d.jobDescription.trim())
      if (noTask) {
        const name = placeName(noTask)
        toast({ title: "ข้อมูลไม่ครบ", description: `${pointLabel(noTask)}${name && name.length <= 80 ? ` (${name})` : ""}: ระบุว่าทำอะไรที่จุดนี้`, variant: "destructive" })
        return
      }
      const problem = sequenceShapeProblem(destinations.map((_, i) => ({ sequenceIndex: i })), destinations.map(placeOf))
      if (problem) {
        toast({ title: "ลำดับจุดไม่ถูกต้อง", description: problem, variant: "destructive" })
        return
      }
      // สถานที่ใหม่ (กำหนดเอง) ที่ใช้ซ้ำในใบ: ชื่อตรงกันแต่พิกัดไม่ตรง (หรือกลับกัน) — มักเกิดจากแก้จุดต้นทางหลังกด "ใช้สถานที่เดียวกับ..."
      const custom = destinations.map((d, i) => ({ d, i })).filter(({ d }) => d.category === "custom" && d.customName.trim())
      const sameName = (a: DestinationRequest, b: DestinationRequest) => a.customName.trim().replace(/\s+/g, " ").toLowerCase() === b.customName.trim().replace(/\s+/g, " ").toLowerCase()
      for (let x = 0; x < custom.length; x++) for (let y = x + 1; y < custom.length; y++) {
        const a = custom[x], b = custom[y]
        if (sameName(a.d, b.d) !== samePlace(placeOf(a.d), placeOf(b.d))) {
          toast({ title: "สถานที่ไม่ตรงกัน", description: `จุดที่ ${a.i + 1} กับจุดที่ ${b.i + 1} ชื่อหรือพิกัดไม่ตรงกัน — ถ้าเป็นที่เดียวกัน กด "ใช้สถานที่เดียวกับจุดที่ ${a.i + 1}" ที่จุดที่ ${b.i + 1} อีกครั้ง`, variant: "destructive" })
          return
        }
      }
    }

    const validDestinations = destinations.filter(d => 
      (d.category !== "custom" && d.siteId) || (d.category === "custom" && d.customName.trim())
    )

    if (validDestinations.length === 0) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุจุดหมายอย่างน้อย 1 จุดพร้อมพิกัด", variant: "destructive" })
      return
    }

    // ทุกจุดต้องมีพิกัดในไทย (ผู้ใช้กำหนด 2026-10-19 — งานไม่มีพิกัดคิด กม.ไม่ได้) · ชี้จุดที่ผิด ข้อความเดียวกับ server
    const noCoords = validDestinations.find(d => !parseThaiCoordinates(liveCoordinates(d)))
    if (noCoords) {
      const name = (noCoords.category === "custom" ? noCoords.customName : noCoords.siteName).trim()
      const where = `${pointLabel(noCoords)}${name && name.length <= 80 ? ` (${name})` : ""}`
      toast({ title: "ยังไม่มีพิกัด", description: destinationCoordinateProblem({ category: noCoords.category, coordinates: liveCoordinates(noCoords) }, where) ?? "", variant: "destructive" })
      return
    }

    // เวลาแต่ละจุด → "HH:MM" (พิมพ์ "06.30" ได้) · ผิดรูปแบบ = บอกจุดที่ + ค่าที่กรอก ไม่ส่ง
    const badTime = validDestinations.find(d => normalizeRequestTime(d.requestTime) === null)
    if (badTime) {
      // ตัดชื่อ/ค่าที่ยาวมาก ให้ข้อความเตือนไม่ล้นจอ (เกณฑ์เดียวกับ server)
      const name = (badTime.category === "custom" ? badTime.customName : badTime.siteName).trim()
      const shown = badTime.requestTime.length > 20 ? `${badTime.requestTime.slice(0, 20)}…` : badTime.requestTime
      toast({
        title: "เวลาไม่ถูกต้อง",
        description: `${pointLabel(badTime)}${name && name.length <= 80 ? ` (${name})` : ""}: เวลา "${shown}" ไม่ถูกต้อง — ใช้รูปแบบ 08:30`,
        variant: "destructive",
      })
      return
    }
    const timeOf = (d: DestinationRequest) => normalizeRequestTime(d.requestTime) ?? ""

    const payload = {
      requestDate: selectedDate,
      requestTime: (destinations[0] ? normalizeRequestTime(destinations[0].requestTime) : null) || "08:30",
      requestedBy,
      note,
      destinations: validDestinations.map(d => ({
        category: d.category, siteId: d.siteId, siteName: d.siteName, customName: d.customName,
        coordinates: liveCoordinates(d),
        // จุดส่งของ: เขียนรายการจากของที่รับแต่ละจุดให้เอง + งานอื่นที่ผู้ขอพิมพ์เพิ่ม
        jobDescription: d.transferRole === "drop" ? dropDescription(d.jobDescription) : d.jobDescription,
        saveAsSite: d.saveAsSite,
        ...(d.allowSeparateSite === undefined ? {} : { allowSeparateSite: d.allowSeparateSite }),
        locationType: d.locationType, requestTime: timeOf(d),
        ...(d.transferRole ? { transferRole: d.transferRole } : {}),
        // ตรวจแล้วข้างบนว่าทุกการ์ดของใบแบบนี้ผ่าน → ลำดับ = ตำแหน่งการ์ด
        ...(isSequence ? { sequenceIndex: validDestinations.indexOf(d) } : {}),
      })),
    }
    const payloadKey = JSON.stringify(payload)
    if (pendingOperation?.key !== payloadKey) pendingOperation = { key: payloadKey, id: crypto.randomUUID() }
    const operationId = pendingOperation.id

    setIsSubmitting(true)
    let serverMessage = ""
    try {
      // ออกเลข VR + บันทึกใบ + สถานที่ใหม่ ทำที่ server ในธุรกรรมเดียว (api/vehicle-requests)
      // เพราะการนับ/เช็กเลขซ้ำต้องอ่านใบของทุกคนในวันนั้น ซึ่ง client ของผู้ขอทั่วไปอ่านไม่ได้แล้ว
      const response = await fetch("/api/vehicle-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ operationId, ...payload }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        serverMessage = typeof result?.error === "string" ? result.error : ""
        throw new Error(`vehicle-requests ${response.status}`)
      }
      const { requestId, createdNames = [], reusedNames = [], unsavedNames = [] } = result as { requestId: string; createdNames?: string[]; reusedNames?: string[]; unsavedNames?: string[] }
      const siteResults = [
        createdNames.length ? `เพิ่มสถานที่ไว้ใช้ครั้งต่อไป: ${createdNames.join(', ')}` : '',
        reusedNames.length ? `ใช้สถานที่เดิม: ${reusedNames.join(', ')}` : '',
        unsavedNames.length ? `เก็บเฉพาะในใบขอรถ: ${unsavedNames.join(', ')}` : '',
      ].filter(Boolean).join(' · ')
      toast({ title: "ส่งคำขอรถสำเร็จ", description: `รหัสอ้างอิง: ${requestId}${siteResults ? ` · ${siteResults}` : ''}` })
      if (pendingOperation?.id === operationId) pendingOperation = null

      setNote("")
      setDestinations([{ id: "1", category: "all", searchTerm: "", siteId: "", siteName: "", customName: "", coordinates: "", jobDescription: "", saveAsSite: false, locationType: "ไซต์งาน", requestTime: "08:30" }])
    } catch (error) {
      console.error("Error saving request:", error)
      // ข้อมูลในฟอร์มยังอยู่ครบ (การล้างฟอร์มอยู่หลัง await ใน try) — ย้ำให้ผู้ใช้กดส่งซ้ำได้
      toast({
        title: "ส่งคำขอไม่สำเร็จ ❌",
        description: serverMessage || "ยังยืนยันผลการบันทึกไม่ได้ ข้อมูลที่กรอกไว้ยังอยู่ — กดส่งอีกครั้งได้เลย ระบบจะไม่สร้างใบซ้ำ",
        variant: "destructive",
      })
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
                <Label>วันที่ต้องการรถ <span className="text-xs font-normal text-muted-foreground">(ปิดรับวันอาทิตย์)</span></Label>
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
                      fromDate={new Date(calendarMinStr + 'T00:00:00')}
                      disabled={(date) => {
                        const dateStr = format(date, "yyyy-MM-dd")
                        // ก่อนวันขั้นต่ำ (staff=วันนี้ / viewer=พรุ่งนี้) หรือวันอาทิตย์ = กดไม่ได้
                        return dateStr < calendarMinStr || date.getDay() === 0
                      }}
                      onSelect={(date) => {
                        if (!date) return
                        const dateStr = format(date, "yyyy-MM-dd")
                        if (dateStr < calendarMinStr || date.getDay() === 0) return
                        setSelectedDate(dateStr)
                        setIsCalendarOpen(false)
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <QueueNoticeCard date={selectedDate} status={continuousQueues.status} notices={continuousQueues.notices} />
                {isSelectingToday && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-xs text-orange-300">
                    <span className="text-base leading-none">⚠️</span>
                    <span>
                      กำลังจะขอใช้รถ <b>วันนี้ ({format(new Date(todayStr + 'T00:00:00'), "dd/MM/yyyy")})</b> — กรณีพิเศษสำหรับคนจัดรถ
                      <br />ใบนี้จะเข้ากองจัดคิวทันที (ไม่ต้องกดรับเรื่อง) ใช้เมื่อต้องเลือกคนขับ/รถคันใหม่ที่แทรกงานด่วนทำไม่ได้
                    </span>
                  </div>
                )}
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
                            {rejectReason && (
                              <p className="text-[10px] text-muted-foreground italic">
                                เหตุผล: {rejectReason}
                              </p>
                            )}
                          </div>
                        )}
                        {urgentStatus === 'pending' && (
                          <>
                            <p className="text-xs text-orange-400 font-bold flex items-center gap-2">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              รอ Dispatcher อนุมัติอยู่...
                            </p>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs w-full"
                                  disabled={isCancellingUrgent}
                                >
                                  {isCancellingUrgent && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                                  ยกเลิกคำขออนุมัติ
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>ยกเลิกคำขออนุมัติ?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    คนจัดรถจะไม่เห็นคำขอนี้แล้ว — ถ้ายังต้องใช้รถพรุ่งนี้ กดขออนุมัติใหม่ได้
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>ปิด</AlertDialogCancel>
                                  <AlertDialogAction onClick={cancelUrgentApproval} className="bg-red-500 hover:bg-red-600">ยืนยันยกเลิก</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
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
                            <Dialog open={!!urgentDetails} onOpenChange={(open) => { if (!open && !isSendingUrgent) setUrgentDetails(null) }}>
                              <DialogContent className="sm:max-w-md rounded-2xl">
                                <DialogHeader>
                                  <DialogTitle>ขออนุมัติส่งใบขอรถหลังเวลาปิดรับ</DialogTitle>
                                  <DialogDescription>
                                    บอกคนจัดรถสั้น ๆ ว่าจะไปไหน ทำอะไร — ได้รับอนุมัติแล้วค่อยกรอกใบขอรถเต็ม
                                  </DialogDescription>
                                </DialogHeader>
                                {urgentDetails && (
                                  <div className="space-y-3">
                                    <div className="space-y-1">
                                      <Label htmlFor="urgent-destination">ไปที่ไหน</Label>
                                      <Input id="urgent-destination" value={urgentDetails.destination} maxLength={URGENT_DETAIL_LIMITS.destination}
                                        placeholder="เช่น ไซต์งานบางนา" onChange={(e) => setUrgentDetails({ ...urgentDetails, destination: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                      <Label htmlFor="urgent-job">งาน / ของที่จะขน</Label>
                                      <Textarea id="urgent-job" value={urgentDetails.jobSummary} maxLength={URGENT_DETAIL_LIMITS.jobSummary} rows={3}
                                        placeholder="เช่น ส่งท่อ PVC 10 เส้น" onChange={(e) => setUrgentDetails({ ...urgentDetails, jobSummary: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                      <Label htmlFor="urgent-phone">เบอร์ติดต่อ</Label>
                                      <Input id="urgent-phone" type="tel" inputMode="tel" value={urgentDetails.contactPhone} maxLength={URGENT_DETAIL_LIMITS.contactPhone}
                                        placeholder="08x-xxx-xxxx" onChange={(e) => setUrgentDetails({ ...urgentDetails, contactPhone: e.target.value })} />
                                    </div>
                                  </div>
                                )}
                                <DialogFooter className="gap-2">
                                  <Button type="button" variant="outline" onClick={() => setUrgentDetails(null)} disabled={isSendingUrgent}>ยกเลิก</Button>
                                  <Button type="button" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={submitUrgentApproval} disabled={isSendingUrgent}>
                                    {isSendingUrgent ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : "🔔"} ส่งคำขออนุมัติ
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
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
              {/* ประเภทงาน: ปกติ / รับของไปส่งต่อ (ใบเดียวแทนการทำใบรับ + ใบส่งแยก) / ไปหลายจุดตามลำดับ (ไป-กลับ) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="ประเภทงาน">
                <button type="button" role="radio" aria-checked={mode === "normal"} onClick={() => switchMode("normal")}
                  className={cn("rounded-lg border-2 p-3 text-left transition-colors",
                    mode === "normal" ? "border-accent bg-accent/10" : "border-border/50 bg-background/30 hover:bg-secondary/40")}>
                  <span className="block text-sm font-bold">🚚 งานปกติ</span>
                  <span className="block text-[11px] text-muted-foreground">ส่งของ / ไปทำงานที่สถานที่เดียว</span>
                </button>
                <button type="button" role="radio" aria-checked={isTransfer} onClick={() => switchMode("transfer")}
                  className={cn("rounded-lg border-2 p-3 text-left transition-colors",
                    isTransfer ? "border-amber-500 bg-amber-500/10" : "border-border/50 bg-background/30 hover:bg-secondary/40")}>
                  <span className="block text-sm font-bold">📦 รับของไปส่งต่อ</span>
                  <span className="block text-[11px] text-muted-foreground">รับของจากร้าน/ไซต์ (หลายที่ได้) แล้วนำไปส่งอีกที่ — ทำใบเดียวพอ</span>
                </button>
                <button type="button" role="radio" aria-checked={isSequence} onClick={() => switchMode("sequence")}
                  className={cn("rounded-lg border-2 p-3 text-left transition-colors",
                    isSequence ? "border-indigo-500 bg-indigo-500/10" : "border-border/50 bg-background/30 hover:bg-secondary/40")}>
                  <span className="block text-sm font-bold">🔁 ไปหลายจุดตามลำดับ (ไป-กลับ)</span>
                  <span className="block text-[11px] text-muted-foreground">รถคันเดียวไปตามลำดับ เช่น รับคนงานที่ไซต์ → ไปทำเอกสาร → ส่งกลับไซต์</span>
                </button>
              </div>

              <div className="space-y-0">
                {destinations.map((dest, index) => {
                  const category = CATEGORIES.find(c => c.id === dest.category);
                  const siteMatch = dest.category === 'custom' && !dest.siteId && dest.customName.trim() && dest.coordinates.trim()
                    ? matchCustomSite(dest.customName, dest.coordinates, sites || []) : null
                  const filteredSites = sites?.filter(s => {
                    if (dest.category === 'custom') return false;
                    const matchesType = dest.category === 'all' ? true : (category?.types as readonly string[] | undefined)?.includes(s.projectTypeTag);
                    const matchesSearch = s.name.toLowerCase().includes(dest.searchTerm.toLowerCase()) || 
                                         (s.address || "").toLowerCase().includes(dest.searchTerm.toLowerCase());
                    return matchesType && matchesSearch;
                  }) || [];

                  const isPickup = dest.transferRole === "pickup"
                  const isDrop = dest.transferRole === "drop"
                  const isStep = isSequence
                  // ขากลับ: ปุ่มใช้สถานที่ของจุดก่อนหน้า (ข้ามจุดที่ติดกัน — ที่เดียวกันติดกันไม่ได้)
                  // ไม่เสนอที่เดียวกับจุดก่อนหน้า (ติดกันไม่ได้) · ที่เดียวกันหลายจุดเสนอครั้งเดียว
                  const prevPlace = index > 0 ? placeOf(destinations[index - 1]) : null
                  const reusable = isStep ? destinations.slice(0, Math.max(0, index - 1)).filter(placeChosen)
                    .filter(from => !(prevPlace && samePlace(placeOf(from), prevPlace)))
                    .filter((from, k, list) => list.findIndex(o => samePlace(placeOf(o), placeOf(from))) === k) : []
                  return (
                    <React.Fragment key={dest.id}>
                    {isDrop && (
                      <Button type="button" variant="outline" className="w-full h-11 mb-4 border-dashed border-amber-500/60 text-amber-300 hover:bg-amber-500/10" onClick={addPickup}>
                        <Plus className="h-4 w-4 mr-1" /> เพิ่มจุดรับของ (รับหลายร้านไปส่งที่เดียวกัน)
                      </Button>
                    )}
                    <Card className={cn("bg-secondary/20 relative overflow-hidden mb-4 border-2 shadow-sm",
                      isPickup ? "border-amber-500/60" : isDrop ? "border-emerald-500/60" : isStep ? "border-indigo-500/60" : "border-accent/60")}>
                      <div className={cn("absolute top-0 left-0 w-1 h-full", isPickup ? "bg-amber-500" : isDrop ? "bg-emerald-500" : isStep ? "bg-indigo-500" : "bg-accent")} />
                      <CardContent className="p-4 md:p-6 space-y-4">
                        {isStep && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-bold text-indigo-300">🔁 {pointLabel(dest)}{index > 0 ? ` (ต่อจากจุดที่ ${index})` : " (เริ่มที่นี่)"}</p>
                              <div className="flex items-center gap-1">
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`เลื่อน${pointLabel(dest)}ขึ้น`} disabled={index === 0} onClick={() => moveSequenceStop(index, -1)}>
                                  <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`เลื่อน${pointLabel(dest)}ลง`} disabled={index === destinations.length - 1} onClick={() => moveSequenceStop(index, 1)}>
                                  <ArrowDown className="h-4 w-4" />
                                </Button>
                                {destinations.length > 2 && (
                                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-red-400 hover:text-red-300" onClick={() => removeSequenceStop(dest.id)}>
                                    <Trash2 className="h-3.5 w-3.5 mr-1" /> ลบจุดนี้
                                  </Button>
                                )}
                              </div>
                            </div>
                            {reusable.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {reusable.map(from => (
                                  <Button key={from.id} type="button" variant="outline" size="sm" className="h-8 text-xs border-indigo-500/50 text-indigo-200 hover:bg-indigo-500/10"
                                    onClick={() => copyPlaceFrom(dest.id, from)}>
                                    ↩ ใช้สถานที่เดียวกับ{pointLabel(from)} ({placeName(from)})
                                  </Button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {(isPickup || isDrop) && (
                          <div className="flex items-center justify-between gap-2">
                            <p className={cn("text-sm font-bold", isPickup ? "text-amber-300" : "text-emerald-300")}>
                              {isPickup ? `📦 ${pointLabel(dest)}` : "🏁 จุดส่งของ (นำของที่รับทั้งหมดมาส่งที่นี่)"}
                            </p>
                            {isPickup && transferPickups.length > 1 && (
                              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-red-400 hover:text-red-300" onClick={() => removePickup(dest.id)}>
                                <Trash2 className="h-3.5 w-3.5 mr-1" /> ลบจุดนี้
                              </Button>
                            )}
                          </div>
                        )}
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
                                    searchTerm: "",
                                    // สถานที่ใหม่ (กำหนดเอง) → เปิด "บันทึกไว้ใช้ครั้งหน้า" ให้เลย กันคนลืมกด
                                    saveAsSite: cat.id === "custom",
                                    allowSeparateSite: false
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
                                      <SelectItem key={s.id} value={s.id}>{s.name}{inThailand(s.latitude, s.longitude) ? "" : " · ไม่มีพิกัด"}</SelectItem>
                                    )) : (
                                      <div className="p-4 text-center text-xs text-muted-foreground">ไม่พบสถานที่ในหมวดหมู่นี้</div>
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between min-h-[24px]">
                                  <Label>พิกัด (ดึงข้อมูลอัตโนมัติ)</Label>
                                  {liveCoordinates(dest) && (
                                    <Button
                                      type="button"
                                      variant="link"
                                      className="h-auto p-0 text-[10px] text-accent"
                                      onClick={() => {
                                        const [lat, lng] = liveCoordinates(dest).split(',').map(s => s.trim());
                                        if (lat && lng) {
                                          window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
                                        }
                                      }}
                                    >
                                      🗺️ ตรวจสอบตำแหน่ง
                                    </Button>
                                  )}
                                </div>
                                <Input className="h-11 bg-muted/30" value={liveCoordinates(dest)} readOnly />
                                {dest.siteId && !parseThaiCoordinates(liveCoordinates(dest)) && (
                                  <p className="text-[10px] text-red-400 flex items-center gap-1 mt-1" role="alert">
                                    <Info className="h-3 w-3 shrink-0" />
                                    สถานที่นี้ยังไม่มีพิกัดในระบบ — ส่งไม่ได้ เลือก &quot;กำหนดเอง&quot; แล้วใส่พิกัด หรือแจ้งทีมจัดรถให้เติมพิกัด
                                  </p>
                                )}
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
                                    updateDest(dest.id, { customName: e.target.value })
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
                                              coordinates: s.latitude && s.longitude ? `${s.latitude}, ${s.longitude}` : "",
                                              // เลือกสถานที่ที่มีอยู่แล้ว → ไม่ต้องบันทึกซ้ำ
                                              saveAsSite: false,
                                              allowSeparateSite: false
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
                              {dest.customName.trim() && !parseThaiCoordinates(dest.coordinates) && (
                                <p className="text-[10px] text-red-400 flex items-center gap-1 mt-1" role="alert">
                                  <Info className="h-3 w-3 shrink-0" />
                                  {dest.coordinates.trim()
                                    ? `พิกัดไม่ถูกต้องหรืออยู่นอกประเทศไทย — ใช้รูปแบบ ${COORDINATE_EXAMPLE}`
                                    : "ต้องใส่พิกัดก่อนส่งใบขอรถ — ไม่รู้พิกัดให้ถามทีมจัดรถ"}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {dest.category === "custom" && dest.customName && dest.coordinates && !dest.siteId && (
                          <div className={cn(
                            "rounded-lg border-2 p-3.5 transition-colors",
                            dest.saveAsSite
                              ? "border-accent bg-accent/10"
                              : "border-dashed border-muted-foreground/40 bg-background/30"
                          )}>
                            <div className="flex items-start gap-3">
                              <Checkbox
                                id={`save-site-${dest.id}`}
                                checked={dest.saveAsSite}
                                onCheckedChange={(val) => updateDest(dest.id, { saveAsSite: !!val })}
                                className="mt-0.5 h-5 w-5"
                              />
                              <div className="flex-1 space-y-1">
                                <Label htmlFor={`save-site-${dest.id}`} className="text-sm font-bold text-foreground cursor-pointer flex items-center gap-1.5">
                                  <Save className="h-4 w-4 text-accent shrink-0" />
                                  บันทึก “{dest.customName}” ไว้ใช้ครั้งต่อไป
                                </Label>
                                <p className="text-[11px] text-muted-foreground">
                                  {dest.saveAsSite
                                    ? 'จะบันทึกพร้อมใบขอรถเมื่อกดส่งสำเร็จ ครั้งหน้าเลือกจากรายการได้เลย'
                                    : 'ไม่บันทึกในรายการสถานที่ — ใช้เฉพาะใบขอรถนี้'}
                                </p>
                                {dest.saveAsSite && (
                                  <div className="space-y-1.5 pt-2 animate-in slide-in-from-top-1">
                                    <Label className="text-xs">ประเภทสถานที่</Label>
                                    <Select
                                      value={dest.locationType}
                                      onValueChange={(val) => updateDest(dest.id, { locationType: val })}
                                    >
                                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
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
                            </div>
                          </div>
                        )}

                        {dest.saveAsSite && siteMatch?.kind === 'existing' && (
                          <p className="text-xs text-emerald-400" role="status">ชื่อและพิกัดตรงกับ “{siteMatch.matches[0].name}” — จะใช้สถานที่เดิม ไม่เพิ่มซ้ำ</p>
                        )}
                        {dest.saveAsSite && siteMatch?.kind === 'conflict' && (
                          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 space-y-2" role="status">
                            <p className="text-sm font-medium text-amber-300">พบชื่อหรือพิกัดตรงกับสถานที่ที่มีอยู่</p>
                            {siteMatch.matches.map(site => (
                              <div key={site.id} className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs">{site.name} · {site.latitude ?? 'ไม่มีพิกัด'}, {site.longitude ?? 'ไม่มีพิกัด'}</span>
                                <Button type="button" variant="outline" size="sm" onClick={() => updateDest(dest.id, {
                                  siteId: site.id, siteName: site.name, customName: site.name,
                                  // สถานที่เดิมยังไม่มีพิกัด = ใช้พิกัดที่ผู้ขอพิมพ์ไว้ (เดิมล้างเป็นว่าง → ส่งไม่ได้ ทางตัน)
                                  coordinates: site.latitude != null && site.longitude != null ? `${site.latitude}, ${site.longitude}` : dest.coordinates,
                                  saveAsSite: false, allowSeparateSite: false,
                                })}>ใช้สถานที่นี้</Button>
                              </div>
                            ))}
                            <Checkbox id={`separate-site-${dest.id}`} checked={!!dest.allowSeparateSite}
                              onCheckedChange={checked => updateDest(dest.id, { allowSeparateSite: !!checked })} />
                            <Label htmlFor={`separate-site-${dest.id}`} className="ml-2 text-xs">ยืนยันว่าเป็นคนละสถานที่ ให้บันทึกแยก</Label>
                          </div>
                        )}

                        {isDrop && (
                          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-1" role="status">
                            <p className="text-[11px] font-bold text-emerald-300">ใบงานคนขับที่จุดนี้จะเขียนให้อัตโนมัติ:</p>
                            <p className="text-xs whitespace-pre-line text-foreground/90">
                              {transferPickups.some(p => placeName(p) || p.jobDescription.trim())
                                ? dropDescription("")
                                : "— กรอกจุดรับของและรายการของด้านบนก่อน —"}
                            </p>
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>{isPickup ? <>รับอะไร (รายการของ) <span className="text-red-400">*</span></> : isDrop ? "งานอื่นที่จุดส่ง (ถ้ามี)" : isStep ? <>ทำอะไรที่จุดนี้ <span className="text-red-400">*</span></> : "ลักษณะงานที่ต้องทำ"}</Label>
</div>
                          <Textarea
                            placeholder={isPickup ? "เช่น ปูนสกิม 10 ถุง, ท่อ PVC 4 นิ้ว 20 เส้น" : isDrop ? "ไม่ต้องพิมพ์รายการของซ้ำ — ใส่เฉพาะงานอื่น เช่น ส่งท่อ EMT จากออฟฟิศไปด้วย" : isStep ? "เช่น รับคนงาน 3 คน / ส่งคนงานทำเอกสาร รอรับกลับ / ส่งท่อ 8 เส้น และรับท่อเก่า 5 เส้น" : "รายละเอียดงาน เช่น ส่งอุปกรณ์ไฟฟ้า, รับตัวอย่างวัสดุ"}
                            className="min-h-[80px] bg-background/30"
                            style={{ resize: 'vertical' }}
                            value={dest.jobDescription}
                            onChange={(e) => updateDest(dest.id, { jobDescription: e.target.value })}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>{isPickup ? "เวลานัดรับของ" : isDrop ? "เวลาที่ต้องการให้ถึงจุดส่ง" : "เวลาที่ต้องการ (จุดนี้)"}</Label>
                          <div className="relative w-40">
                            <Input
                              placeholder="08:30"
                              className="h-11 pr-8"
                              value={dest.requestTime}
                              onChange={(e) => updateDest(dest.id, { requestTime: e.target.value })}
                              onBlur={() => {
                                // กรอกเสร็จ → จัดรูปแบบให้เห็นเลย ("6.30" → "06:30") · ผิดรูปแบบปล่อยไว้ให้ตอนส่งบอก
                                const t = normalizeRequestTime(dest.requestTime)
                                if (t && t !== dest.requestTime) updateDest(dest.id, { requestTime: t })
                              }}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none font-bold">
                              น.
                            </span>
                          </div>
                        </div>

                      </CardContent>
                    </Card>
                    {isStep && index === destinations.length - 1 && destinations.length < SEQUENCE_MAX_STOPS && (
                      <Button type="button" variant="outline" className="w-full h-11 mb-4 border-dashed border-indigo-500/60 text-indigo-300 hover:bg-indigo-500/10" onClick={addSequenceStop}>
                        <Plus className="h-4 w-4 mr-1" /> เพิ่มจุดถัดไป (จุดที่ {destinations.length + 1})
                      </Button>
                    )}
                    </React.Fragment>
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
