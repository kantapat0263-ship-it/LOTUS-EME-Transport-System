"use client"

import * as React from "react"
import {
  collection,
  query,
  where,
  doc,
  onSnapshot,
  type Query,
  type CollectionReference,
  type DocumentData,
} from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type {
  Vehicle,
  Trip,
  CompanySetting,
  VehiclePositionDoc,
  VehicleTrailDoc,
  TrackingDailyDoc,
  UserProfile,
} from "@/types/models"
import {
  computeStopStatuses,
  computeDailySummary,
  detectStops,
  haversineMeters,
  isPositionStale,
  isPowerCut,
  isOverspeed,
  mileageKm,
  OVERSPEED_KMH,
  trackingDateKey,
  OFFICE_LOCATION,
  OFFICE_RADIUS_M,
  LONG_DWELL_MIN,
  type TrailPoint,
} from "@/lib/tracking"
import { TrackingMap, type TrackingMapStop } from "@/components/tracking/TrackingMap"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { AlertTriangle, WifiOff, Navigation, Clock } from "lucide-react"

type TruckStatus = "ok" | "stale" | "done" | "unmapped"

interface TruckView {
  trip: Trip
  deviceId?: string
  position?: VehiclePositionDoc
  trail: TrailPoint[]
  stops: TrackingMapStop[]
  arrivedCount: number
  totalStops: number
  status: TruckStatus
  stale: boolean
  origin: { lat: number; lng: number } | null
  arrivedAtByOrder: Record<number, number | null>
  daily: TrackingDailyDoc | null
  longStops: number
  timeline: TimelineEntry[]
  stopEvents: LongStopEvent[]
  powerCut: boolean
  overspeed: boolean
  mileageKm: number
}

interface LongStopEvent {
  lat: number
  lng: number
  durationMin: number
  startT: number
  /** จอดในรัศมีจุดงานไหม (true = จอดที่จุดงาน, false = จอดนอกจุดงาน = น่าสงสัยกว่า) */
  nearJob: boolean
}

interface TimelineEntry {
  order: number
  name: string
  lat?: number
  lng?: number
  arrived: boolean
  isCurrent: boolean
  arrivedAt: number | null
  /** งานนี้ถูกโยกออกไปคันอื่น (คนขับลา/ปฏิเสธ) — ไม่ใช่งานของคันนี้แล้ว */
  movedTo?: string
  /** งานนี้ถูกโยกมาให้คันนี้จากคันอื่น */
  incomingFrom?: { plate: string; refused: boolean }
}

const STATUS_META: Record<TruckStatus, { label: string; cls: string }> = {
  ok: { label: "ตามแผน", cls: "bg-emerald-500/15 text-emerald-400" },
  done: { label: "จบงานแล้ว", cls: "bg-emerald-500/15 text-emerald-400" },
  stale: { label: "GPS ออฟไลน์", cls: "bg-amber-500/15 text-amber-400" },
  unmapped: { label: "ยังไม่จับคู่ GPS", cls: "bg-muted text-muted-foreground" },
}

function thTime(ms?: number | null): string {
  if (!ms) return "-"
  return new Date(ms).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
}

/**
 * subscribe collection แบบ "ไม่ทำทั้งแอปพัง" — ถ้าอ่านไม่ได้ (เช่น firestore.rules
 * ของ collection ใหม่ยังไม่ publish) จะคืน [] แทนการโยน error เข้า global listener
 * ใช้เฉพาะ vehiclePositions/vehiclePositionTrails ที่เป็น collection ใหม่
 */
function useSafeCollection<T>(
  ref: Query<DocumentData> | CollectionReference<DocumentData> | null
): (T & { id: string })[] {
  const { user, isUserLoading } = useUser()
  const [data, setData] = React.useState<(T & { id: string })[]>([])
  React.useEffect(() => {
    if (!ref || isUserLoading || !user) {
      setData([])
      return
    }
    const unsub = onSnapshot(
      ref,
      (snap) => setData(snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))),
      (err: any) => {
        console.warn(
          "[tracking] อ่านตำแหน่ง/เส้นทางไม่ได้ (ต้อง publish firestore.rules ของ vehiclePositions):",
          err?.code || err?.message
        )
        setData([])
      }
    )
    return () => unsub()
  }, [ref, user, isUserLoading])
  return data
}

export default function TrackingPage() {
  const db = useFirestore()
  const { user } = useUser()
  const [now, setNow] = React.useState<number>(() => Date.now())
  const todayKey = trackingDateKey(now)
  const [selectedDate, setSelectedDate] = React.useState<string>(() => trackingDateKey())
  const isToday = selectedDate === todayKey
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [syncInfo, setSyncInfo] = React.useState<{ ok: boolean; error?: string; detail?: string; synced?: number; skipped?: boolean } | null>(null)
  const { toast } = useToast()
  const shownArrivalsRef = React.useRef<Set<string>>(new Set())
  const shownPowerCutRef = React.useRef<Set<string>>(new Set())

  // สิทธิ์ผู้ใช้ — viewer ดูได้อย่างเดียว (ไม่ยิง sync ที่ต้องใช้สิทธิ์ staff, ไม่โชว์ diag สิทธิ์)
  const profileRef = useMemoFirebase(() => (db && user ? doc(db, "users", user.uid) : null), [db, user])
  const { data: profile } = useDoc<UserProfile>(profileRef)
  const isStaff = profile?.role === "admin" || profile?.role === "dispatcher"

  // อัปเดต "เวลาปัจจุบัน" ทุก 60 วิ (เพื่อคำนวณ GPS ออฟไลน์)
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // ดึงตำแหน่งสดจาก SinoTrack เอง: poll /api/tracking/sync ทุก 60 วิ ระหว่างเปิดหน้านี้
  // → ฟรี ไม่ต้องพึ่ง cron ภายนอก (server จะ login SinoTrack + เขียน Firestore ให้ แล้ว subscription ข้างล่างอัปเดตเอง)
  React.useEffect(() => {
    if (!user || !isToday || !isStaff) return // viewer ดูอย่างเดียว / ย้อนหลังไม่ต้อง poll
    let stopped = false
    const runSync = async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch("/api/tracking/sync", { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json().catch(() => ({ ok: false, error: "bad-response" }))
        if (!stopped) setSyncInfo({ ...json, ok: res.ok && json?.ok !== false })
      } catch (e: any) {
        if (!stopped) setSyncInfo({ ok: false, error: "network", detail: e?.message })
      }
    }
    runSync()
    const id = setInterval(() => {
      if (!stopped) runSync()
    }, 60_000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [user, isToday, isStaff])

  const vehiclesRef = useMemoFirebase(
    () => (db && user ? collection(db, "vehicles") : null),
    [db, user]
  )
  const { data: vehicles } = useCollection<Vehicle>(vehiclesRef)

  const positionsRef = useMemoFirebase(
    () => (db && user ? collection(db, "vehiclePositions") : null),
    [db, user]
  )
  const positions = useSafeCollection<VehiclePositionDoc>(positionsRef)

  const tripsRef = useMemoFirebase(
    () => (db && user ? query(collection(db, "trips"), where("tripDate", "==", selectedDate)) : null),
    [db, user, selectedDate]
  )
  const { data: trips, isLoading: loadingTrips } = useCollection<Trip>(tripsRef)

  const trailsRef = useMemoFirebase(
    () =>
      db && user
        ? query(collection(db, "vehiclePositionTrails"), where("date", "==", selectedDate))
        : null,
    [db, user, selectedDate]
  )
  const trails = useSafeCollection<VehicleTrailDoc>(trailsRef)

  const dailyRef = useMemoFirebase(
    () =>
      db && user ? query(collection(db, "trackingDaily"), where("date", "==", selectedDate)) : null,
    [db, user, selectedDate]
  )
  const daily = useSafeCollection<TrackingDailyDoc>(dailyRef)

  const settingsRef = useMemoFirebase(
    () => (db && user ? doc(db, "companySettings", "default") : null),
    [db, user]
  )
  const { data: settings } = useDoc<CompanySetting>(settingsRef)

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || settings?.googleMapsApiKeyReference
  const overspeedLimit = settings?.overspeedLimitKmh || OVERSPEED_KMH

  // ---- ประกอบข้อมูลรถแต่ละคันที่มีงานวันนี้ ----
  const trucks = React.useMemo<TruckView[]>(() => {
    const plateToDevice: Record<string, string> = {}
    ;(vehicles ?? []).forEach((v) => {
      if (v.gpsDeviceId && v.licensePlate) plateToDevice[v.licensePlate] = v.gpsDeviceId
    })
    const deviceToPos: Record<string, VehiclePositionDoc> = {}
    ;(positions ?? []).forEach((p) => {
      deviceToPos[p.deviceId] = p
    })
    const deviceToTrail: Record<string, TrailPoint[]> = {}
    ;(trails ?? []).forEach((tr) => {
      deviceToTrail[tr.deviceId] = (tr.points ?? []).map((pt) => ({ lat: pt.lat, lng: pt.lng, t: pt.t }))
    })
    const deviceToDaily: Record<string, TrackingDailyDoc> = {}
    ;(daily ?? []).forEach((d) => {
      deviceToDaily[d.deviceId] = d
    })

    const activeTrips = (trips ?? []).filter((t) => t.status !== "Cancelled")

    // งานที่ถูกโยก "เข้า" แต่ละทริป (จับด้วย reassignedToTripId) พร้อมพิกัดจาก stop ต้นทาง
    const wasMovedAway = (s: any) =>
      !!s.reassignedToVehiclePlate && (s.outcome === "reassigned" || s.outcome === "driver-refused")
    const incomingByTripId: Record<
      string,
      { siteName: string; lat?: number; lng?: number; fromPlate: string; refused: boolean }[]
    > = {}
    activeTrips.forEach((src) => {
      ;(src.stops ?? []).forEach((s: any) => {
        if (wasMovedAway(s) && s.reassignedToTripId && s.reassignedToTripId !== src.id) {
          ;(incomingByTripId[s.reassignedToTripId] ??= []).push({
            siteName: s.siteName,
            lat: s.lat,
            lng: s.lng,
            fromPlate: src.vehiclePlate,
            refused: s.outcome === "driver-refused",
          })
        }
      })
    })

    return activeTrips.map((trip) => {
      const deviceId = plateToDevice[trip.vehiclePlate]
      // โหมดดูย้อนหลัง: ไม่ใช้ตำแหน่งสด (collection ตำแหน่งเก็บแค่ล่าสุด ไม่ใช่รายวัน)
      const position = deviceId && isToday ? deviceToPos[deviceId] : undefined
      const trail = deviceId ? deviceToTrail[deviceId] ?? [] : []

      const ownSorted = [...(trip.stops ?? [])].sort((a, b) => a.order - b.order)
      const incoming = incomingByTripId[trip.id] ?? []
      const maxOrder = ownSorted.reduce((m, s) => Math.max(m, s.order), 0)

      // จุดที่คันนี้ต้องวิ่งจริง = งานของตัวเองที่ยังไม่ถูกโยกออก + งานที่โยกเข้ามา
      const activeOwn = ownSorted.filter((s) => !wasMovedAway(s))
      const routeStops = [
        ...activeOwn.map((s) => ({ order: s.order, siteName: s.siteName, lat: s.lat, lng: s.lng })),
        ...incoming.map((inc, i) => ({
          order: maxOrder + i + 1,
          siteName: inc.siteName,
          lat: inc.lat,
          lng: inc.lng,
        })),
      ]

      const statuses = computeStopStatuses(
        routeStops.map((s) => ({ order: s.order, lat: s.lat, lng: s.lng })),
        trail
      )
      const statusByOrder: Record<number, (typeof statuses)[number]> = {}
      statuses.forEach((st) => (statusByOrder[st.order] = st))
      const arrivedAtByOrder: Record<number, number | null> = {}
      statuses.forEach((st) => (arrivedAtByOrder[st.order] = st.arrivedAt))

      const stops: TrackingMapStop[] = routeStops.map((s) => ({
        order: s.order,
        name: s.siteName,
        lat: s.lat,
        lng: s.lng,
        arrived: statusByOrder[s.order]?.arrived ?? false,
        isCurrent: statusByOrder[s.order]?.isCurrent ?? false,
      }))

      const arrivedCount = statuses.filter((s) => s.arrived).length
      const totalStops = routeStops.length

      // timeline: งานตัวเอง (ที่โยกออกจะมาร์คไว้) + งานที่โยกเข้า
      const timeline: TimelineEntry[] = [
        ...ownSorted.map((s: any) => {
          const moved = wasMovedAway(s)
          const st = moved ? undefined : statusByOrder[s.order]
          return {
            order: s.order,
            name: s.siteName,
            lat: s.lat,
            lng: s.lng,
            arrived: st?.arrived ?? false,
            isCurrent: st?.isCurrent ?? false,
            arrivedAt: st?.arrivedAt ?? null,
            movedTo: moved ? s.reassignedToVehiclePlate : undefined,
          }
        }),
        ...incoming.map((inc, i) => {
          const order = maxOrder + i + 1
          const st = statusByOrder[order]
          return {
            order,
            name: inc.siteName,
            lat: inc.lat,
            lng: inc.lng,
            arrived: st?.arrived ?? false,
            isCurrent: st?.isCurrent ?? false,
            arrivedAt: st?.arrivedAt ?? null,
            incomingFrom: { plate: inc.fromPlate, refused: inc.refused },
          }
        }),
      ]

      // ต้นทาง = ออฟฟิศเสมอ (ตั้งใน settings ได้ ไม่งั้นใช้พิกัดออฟฟิศคงที่)
      const origin =
        settings?.warehouseLatitude != null && settings?.warehouseLongitude != null
          ? { lat: settings.warehouseLatitude, lng: settings.warehouseLongitude }
          : OFFICE_LOCATION

      // วันนี้ = คำนวณสรุปสดจาก merged stops (รวมงานที่โยก) ; ย้อนหลัง = ใช้ที่เก็บไว้
      const stored = deviceId ? deviceToDaily[deviceId] ?? null : null
      let dailyDoc: TrackingDailyDoc | null = stored
      if (isToday && deviceId) {
        const sum = computeDailySummary(trail, routeStops, origin)
        dailyDoc = {
          id: "",
          date: selectedDate,
          deviceId,
          licensePlate: trip.vehiclePlate,
          departedOfficeAt: sum.departedOfficeAt,
          returnedOfficeAt: sum.returnedOfficeAt,
          totalKm: sum.totalKm,
          stops: sum.stops,
        }
      }
      const longStops = (dailyDoc?.stops ?? []).filter(
        (s) => s.dwellMin != null && s.dwellMin > LONG_DWELL_MIN
      ).length

      // จุดจอดนานผิดสังเกต (ตรวจจาก trail จริง รวมจุดนอกงาน) — ตัดจุดที่จอดที่ออฟฟิศออก
      const stopEvents: LongStopEvent[] = detectStops(trail, { minMinutes: LONG_DWELL_MIN })
        .filter((ev) => haversineMeters(ev, origin) > OFFICE_RADIUS_M)
        .map((ev) => ({
          lat: ev.lat,
          lng: ev.lng,
          durationMin: ev.durationMin,
          startT: ev.startT,
          nearJob: routeStops.some(
            (s) => s.lat != null && s.lng != null && haversineMeters(ev, { lat: s.lat, lng: s.lng }) <= 250
          ),
        }))

      const stale = isToday && (position ? isPositionStale(position.positionTime, now) : true)

      // แจ้งเตือนจากอุปกรณ์ (วันนี้เท่านั้น)
      // - ตัดไฟ/ถอด GPS: บิตค้างในรายงานล่าสุด → จับได้แม้ตอนนี้ offline แล้ว
      // - ความเร็วเกิน: ดูจากค่าสด → เฉพาะตอนยัง online
      const powerCut = isToday && !!position && isPowerCut(position.alarmState ?? 0)
      const overspeed =
        isToday && !stale && !!position && isOverspeed(position.speed, position.alarmState ?? 0, overspeedLimit)
      const mKm = position ? mileageKm(position.mileage ?? 0) : 0

      let status: TruckStatus
      if (!deviceId) status = "unmapped"
      else if (!isToday) status = totalStops > 0 && arrivedCount >= totalStops ? "done" : "ok"
      else if (stale) status = "stale"
      else if (totalStops > 0 && arrivedCount >= totalStops) status = "done"
      else status = "ok"

      return {
        trip,
        deviceId,
        position,
        trail,
        stops,
        arrivedCount,
        totalStops,
        status,
        stale,
        origin,
        arrivedAtByOrder,
        daily: dailyDoc,
        longStops,
        timeline,
        stopEvents,
        powerCut,
        overspeed,
        mileageKm: mKm,
      }
    })
  }, [vehicles, positions, trails, daily, trips, settings, now, isToday, selectedDate, overspeedLimit])

  // เรียง: คันมีปัญหาสำคัญ (ตัดไฟ/ความเร็วเกิน) ขึ้นก่อน แล้วตามสถานะ
  const order: Record<TruckStatus, number> = { stale: 0, ok: 1, unmapped: 2, done: 3 }
  const priority = (t: TruckView) => (t.powerCut ? -2 : t.overspeed ? -1 : order[t.status])
  const sortedTrucks = React.useMemo(
    () => [...trucks].sort((a, b) => priority(a) - priority(b)),
    [trucks]
  )

  React.useEffect(() => {
    if (!selectedId && sortedTrucks.length) setSelectedId(sortedTrucks[0].trip.id)
  }, [sortedTrucks, selectedId])

  const selected = trucks.find((t) => t.trip.id === selectedId) ?? null

  // แจ้งเตือนในแอปเมื่อรถกลับถึงออฟฟิศ (เฉพาะที่เพิ่งถึงใน 5 นาที กันเด้งย้อนหลังตอนเปิดหน้า)
  React.useEffect(() => {
    if (!isToday) return
    trucks.forEach((t) => {
      const ret = t.daily?.returnedOfficeAt
      if (ret && now - ret < 5 * 60 * 1000 && !shownArrivalsRef.current.has(t.trip.id)) {
        shownArrivalsRef.current.add(t.trip.id)
        toast({ title: "🏢 รถกลับถึงออฟฟิศแล้ว", description: `${t.trip.vehiclePlate} · เวลา ${thTime(ret)}` })
      }
      // แจ้งเตือน GPS ถูกถอด/ตัดไฟ (ครั้งเดียวต่อคันต่อเซสชัน)
      if (t.powerCut && !shownPowerCutRef.current.has(t.trip.id)) {
        shownPowerCutRef.current.add(t.trip.id)
        toast({
          variant: "destructive",
          title: "🔌 GPS ถูกถอด/ตัดไฟ!",
          description: `${t.trip.vehiclePlate} · คนขับ ${t.trip.actualDriverName || t.trip.driverName || "-"} — ตรวจสอบด่วน`,
        })
      }
    })
  }, [trucks, now, toast, isToday])

  const kpis = React.useMemo(() => {
    const arrived = trucks.reduce((s, t) => s + t.arrivedCount, 0)
    const total = trucks.reduce((s, t) => s + t.totalStops, 0)
    return {
      trucks: trucks.length,
      arrived,
      total,
      totalKm: Math.round(trucks.reduce((s, t) => s + (t.daily?.totalKm ?? 0), 0) * 10) / 10,
      returned: trucks.filter((t) => t.daily?.returnedOfficeAt).length,
      moving: trucks.filter((t) => !t.stale && (t.position?.speed ?? 0) > 0).length,
      stale: trucks.filter((t) => t.status === "stale").length,
    }
  }, [trucks])

  // วินิจฉัยว่าทำไมยังไม่เห็นตำแหน่งสด (แสดงเป็นแถบเตือนบอกสาเหตุตรง ๆ)
  const diag: { tone: "bad" | "warn"; msg: string } | null = (() => {
    if (!isToday || !isStaff) return null // viewer / โหมดย้อนหลัง ไม่ต้องวินิจฉัย sync
    if (positions.length > 0) return null // อ่านตำแหน่งได้แล้ว
    if (!syncInfo) return null // กำลัง sync ครั้งแรก
    if (syncInfo.ok) {
      if ((syncInfo.synced ?? 0) > 0 || syncInfo.skipped)
        return {
          tone: "warn",
          msg: "เซิร์ฟเวอร์ดึงตำแหน่งได้แล้ว แต่หน้าเว็บอ่านไม่ได้ — ต้อง Publish firestore.rules (vehiclePositions / vehiclePositionTrails ให้ allow read) ที่ Firebase Console",
        }
      return {
        tone: "warn",
        msg: "ยังไม่มีรถคันไหนจับคู่เลข GPS หรือ SinoTrack ไม่มีตำแหน่ง — ไปเมนู “ฟลีทรถและคนขับ” เพื่อจับคู่อุปกรณ์",
      }
    }
    const e = syncInfo.error
    if (e === "config") return { tone: "bad", msg: "ยังไม่ได้ตั้งค่า SINOTRACK_USER / SINOTRACK_PASSWORD บน Vercel (Environment Variables)" }
    if (e === "admin-init") return { tone: "bad", msg: "ยังไม่ได้ตั้งค่า FIREBASE_SERVICE_ACCOUNT_BASE64 บน Vercel" }
    if (e === "unauthorized") return { tone: "bad", msg: "สิทธิ์ไม่ผ่าน — ต้องล็อกอินเป็นแอดมิน/คนจัดรถ" }
    if (e === "sinotrack") return { tone: "bad", msg: `เข้าสู่ระบบ SinoTrack ไม่สำเร็จ: ${syncInfo.detail ?? "ตรวจ user/รหัสผ่าน"}` }
    return { tone: "bad", msg: `ดึงข้อมูลไม่สำเร็จ: ${e ?? "unknown"} ${syncInfo.detail ?? ""}` }
  })()

  const dateChips = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => trackingDateKey(now - i * 86400000)),
    [now]
  )
  const chipLabel = (dk: string, i: number) => {
    if (i === 0) return "วันนี้"
    if (i === 1) return "เมื่อวาน"
    return new Date(dk).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" })
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Navigation className="h-5 w-5 text-accent" />
          {isToday ? "ติดตามรถวันนี้" : "ประวัติการเดินรถ"}
        </h1>
        {isToday && (
          <span className="ml-auto rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            อัปเดตอัตโนมัติทุก 1–2 นาที
          </span>
        )}
      </div>

      {/* เลือกวัน (วันนี้ = สด, ย้อนหลังได้ 7 วัน) */}
      <div className="flex flex-wrap gap-2">
        {dateChips.map((dk, i) => (
          <button
            key={dk}
            onClick={() => {
              setSelectedDate(dk)
              setSelectedId(null)
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              dk === selectedDate
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {chipLabel(dk, i)}
          </button>
        ))}
      </div>

      {diag && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
            diag.tone === "bad" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <span>{diag.msg}</span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard n={kpis.trucks} label={isToday ? "รถวิ่งงานวันนี้" : "รถวิ่งงานวันนั้น"} />
        <KpiCard n={`${kpis.arrived}/${kpis.total}`} label="จุดงานที่ผ่าน" />
        {isToday ? (
          <>
            <KpiCard n={kpis.moving} label="🟢 กำลังวิ่ง" />
            <KpiCard n={kpis.stale} label="GPS ออฟไลน์" tone={kpis.stale ? "warn" : undefined} />
          </>
        ) : (
          <>
            <KpiCard n={kpis.totalKm} label="กม.รวมทั้งวัน" />
            <KpiCard n={`${kpis.returned}/${kpis.trucks}`} label="🏢 กลับถึงออฟฟิศ" />
          </>
        )}
      </div>

      {loadingTrips ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">กำลังโหลด…</CardContent>
        </Card>
      ) : trucks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {isToday ? "ยังไม่มีรถที่มีงานวันนี้" : "ไม่มีข้อมูลการเดินรถของวันนี้"} (วันที่ {selectedDate})
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* รายการรถ */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b py-3">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isToday ? "รถที่มีงานวันนี้" : "รถที่วิ่งงานวันนั้น"} ({trucks.length})
              </CardTitle>
            </CardHeader>
            <div className="divide-y divide-border">
              {sortedTrucks.map((t) => {
                const meta = STATUS_META[t.status]
                const pct = t.totalStops ? Math.round((t.arrivedCount / t.totalStops) * 100) : 0
                return (
                  <button
                    key={t.trip.id}
                    onClick={() => setSelectedId(t.trip.id)}
                    className={cn(
                      "flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                      selectedId === t.trip.id && "bg-muted/60 shadow-[inset_3px_0_0_hsl(var(--accent))]"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold">{t.trip.vehiclePlate}</span>
                      {t.powerCut && (
                        <Badge className="border-none bg-red-500/20 text-[10px] text-red-400">🔌 ถูกถอด/ตัดไฟ</Badge>
                      )}
                      {t.overspeed && (
                        <Badge className="border-none bg-orange-500/20 text-[10px] text-orange-400">⚡ ความเร็วเกิน</Badge>
                      )}
                      <Badge className={cn("ml-auto border-none text-[10px]", meta.cls)}>{meta.label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      คนขับ {t.trip.actualDriverName || t.trip.driverName || "-"}
                      {t.trip.actualDriverName && <span className="text-amber-400"> (ขับแทน {t.trip.driverName})</span>}
                      {" "}· ผ่าน {t.arrivedCount}/{t.totalStops} จุด
                      {t.longStops > 0 && (
                        <span className="text-amber-400"> · ⚠ {t.longStops} จุดแวะนาน</span>
                      )}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* รายละเอียดคันที่เลือก */}
          {selected && <TruckDetail truck={selected} apiKey={apiKey} thTime={thTime} isToday={isToday} />}
        </div>
      )}
    </div>
  )
}

function KpiCard({ n, label, tone }: { n: React.ReactNode; label: string; tone?: "bad" | "warn" }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div
          className={cn(
            "text-2xl font-bold tabular-nums",
            tone === "bad" && "text-red-400",
            tone === "warn" && "text-amber-400"
          )}
        >
          {n}
        </div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function TruckDetail({
  truck,
  apiKey,
  thTime,
  isToday,
}: {
  truck: TruckView
  apiKey?: string
  thTime: (ms?: number | null) => string
  isToday: boolean
}) {
  const meta = STATUS_META[truck.status]
  const pos = truck.position

  // เวลารวมภารกิจ + สัดส่วนเวลา (ขับ/ที่จุดงาน/นอกจุดงาน) — คำนวณจากข้อมูลที่มีอยู่แล้ว
  const depT = truck.daily?.departedOfficeAt ?? null
  const retT = truck.daily?.returnedOfficeAt ?? null
  const missionMin = depT && retT ? Math.max(0, Math.round((retT - depT) / 60_000)) : null
  const driveMin = (truck.daily?.stops ?? []).reduce((s, d) => s + (d.travelMinFromPrev ?? 0), 0)
  const dwellAtJobMin = (truck.daily?.stops ?? []).reduce((s, d) => s + (d.dwellMin ?? 0), 0)
  const fmtDur = (m: number) =>
    m >= 60 ? `${Math.floor(m / 60)} ชม. ${Math.round(m % 60)} นาที` : `${Math.round(m)} นาที`

  // แบบ A: ยุบกล่อง "จุดจอดนานผิดสังเกต" — จุดจอด "นอกจุดงาน" แทรกเข้า timeline ตามเวลา
  // (จอด "ที่จุดงาน" เป็นเรื่องปกติ โชว์ใน timeline ที่จุดนั้นอยู่แล้ว ไม่ต้องแยกกล่อง)
  const offJobStops = [...truck.stopEvents].filter((ev) => !ev.nearJob).sort((a, b) => a.startT - b.startT)
  // เรียงจุดงานตาม "เวลาถึงจริง" (คนขับอาจวิ่งสลับลำดับแผน) — จุดที่ยังไม่ถึงคงลำดับแผนต่อท้าย
  const sortedTimeline = [...truck.timeline].sort((a, b) => {
    if (a.arrivedAt != null && b.arrivedAt != null) return a.arrivedAt - b.arrivedAt
    if (a.arrivedAt != null) return -1
    if (b.arrivedAt != null) return 1
    return a.order - b.order
  })
  type TimelineRow =
    | { kind: "stop"; entry: TimelineEntry; count: number }
    | { kind: "offjob"; ev: LongStopEvent }
    | { kind: "return" }
  const timelineRows: TimelineRow[] = []
  {
    let oi = 0
    const pushEventsBefore = (t: number) => {
      while (oi < offJobStops.length && offJobStops[oi].startT < t) {
        timelineRows.push({ kind: "offjob", ev: offJobStops[oi++] })
      }
    }
    for (const s of sortedTimeline) {
      // เหตุการณ์จอดนอกงานที่เกิด "ก่อนถึงจุดนี้" → แทรกไว้ก่อนแถวจุดงาน
      if (s.arrivedAt) pushEventsBefore(s.arrivedAt)
      // งานหลายใบที่ไซต์เดียวกันติดกัน → ยุบเป็นแถวเดียว (ป้ายจำนวนงาน) — เฉพาะสถานะเหมือนกัน
      // และไม่ใช่งานโยกออก/โยกเข้า (มีป้ายเฉพาะตัว) ; ไซต์เดิมที่วนกลับมาอีกรอบไม่ติดกัน = ไม่ยุบ
      const last = timelineRows[timelineRows.length - 1]
      if (
        last?.kind === "stop" &&
        last.entry.name === s.name &&
        last.entry.lat === s.lat &&
        last.entry.lng === s.lng &&
        last.entry.arrived === s.arrived &&
        !s.movedTo && !last.entry.movedTo &&
        !s.incomingFrom && !last.entry.incomingFrom
      ) {
        last.count++
        continue
      }
      timelineRows.push({ kind: "stop", entry: s, count: 1 })
    }
    // กลับถึงออฟฟิศเป็นแถวใน timeline — เหตุการณ์หลังกลับ (รถออกไปอีกรอบ) จะได้ต่อท้ายถูกตำแหน่ง
    if (retT != null) {
      pushEventsBefore(retT)
      timelineRows.push({ kind: "return" })
    }
    while (oi < offJobStops.length) timelineRows.push({ kind: "offjob", ev: offJobStops[oi++] })
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 border-b py-3">
        <CardTitle className="text-base">{truck.trip.vehiclePlate}</CardTitle>
        <Badge className={cn("border-none text-[10px]", meta.cls)}>{meta.label}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {!isToday ? (
            <span>📅 ดูย้อนหลัง</span>
          ) : truck.deviceId ? (
            truck.stale ? (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <WifiOff className="h-3.5 w-3.5" /> ข้อมูลล่าสุด {thTime(pos?.positionTime)}
              </span>
            ) : pos && pos.speed > 0 ? (
              truck.overspeed ? (
                <span className="font-semibold text-orange-400">⚡ วิ่ง {pos.speed} กม./ชม. (เกิน)</span>
              ) : (
                <span className="text-emerald-400">🟢 วิ่ง {pos.speed} กม./ชม.</span>
              )
            ) : (
              <span>⚪ จอดอยู่</span>
            )
          ) : (
            "ยังไม่จับคู่ GPS กับทะเบียนนี้"
          )}
          {truck.mileageKm > 0 ? ` · 📏 ${truck.mileageKm.toLocaleString()} กม.สะสม` : ""}
          {truck.deviceId ? ` · GPS #${truck.deviceId}` : ""}
        </span>
      </CardHeader>

      {truck.powerCut && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-red-500/15 px-3 py-2.5 text-sm font-semibold text-red-400">
          <AlertTriangle className="h-4 w-4 flex-none" />
          🔌 GPS ถูกถอด/ตัดไฟ — คนขับอาจแอบถอดเพื่อไม่ให้ติดตาม ตรวจสอบด่วน
        </div>
      )}

      <div className="h-[340px] w-full bg-muted/20 p-2">
        <TrackingMap
          apiKey={apiKey}
          stops={truck.stops}
          trail={truck.trail}
          truck={pos ? { lat: pos.lat, lng: pos.lng } : null}
          origin={truck.origin}
          stopEvents={truck.stopEvents}
        />
      </div>

      <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">🏢 ออฟฟิศ (จุดเริ่มต้น)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: "#5b7cfa" }} /> เส้นทางที่ควรวิ่ง</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: "#2fb6a0" }} /> เส้นทางที่วิ่งจริง</span>
        {truck.stopEvents.length > 0 && <span className="inline-flex items-center gap-1.5">⏸ จุดจอดนาน</span>}
        {isToday && <span className="inline-flex items-center gap-1.5">🚚 ตำแหน่งรถตอนนี้</span>}
      </div>

      {offJobStops.length > 0 && (
        <div className="mx-4 mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400">
          🔴 จอดนอกจุดงาน {offJobStops.length} ครั้ง · รวม{" "}
          {offJobStops.reduce((sum, ev) => sum + ev.durationMin, 0)} นาที — ดูรายละเอียดใน ROOT ด้านล่าง
        </div>
      )}

      {truck.status === "unmapped" && (
        <div className="mx-4 mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          ทะเบียน {truck.trip.vehiclePlate} ยังไม่ได้จับคู่กับเลข GPS — ไปที่เมนู “ฟลีทรถและคนขับ” เพื่อใส่เลขอุปกรณ์
        </div>
      )}

      <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs">
        <span>🏢 ออกออฟฟิศ <b className="text-foreground">{thTime(truck.daily?.departedOfficeAt)}</b></span>
        <span>
          กลับถึงออฟฟิศ{" "}
          {truck.daily?.returnedOfficeAt ? (
            <b className="text-emerald-400">{thTime(truck.daily.returnedOfficeAt)}</b>
          ) : (
            <b className="text-muted-foreground">ยังไม่กลับ</b>
          )}
        </span>
        {truck.daily?.totalKm != null && <span>รวม <b className="text-foreground tabular-nums">{truck.daily.totalKm}</b> กม.</span>}
        {missionMin != null && <span>⏱ เวลาภารกิจรวม <b className="text-foreground">{fmtDur(missionMin)}</b></span>}
      </div>

      {/* สัดส่วนเวลาของวัน: ขับ / ทำงานที่จุด / นอกจุดงาน (ตัวเลขโดยประมาณจาก GPS) */}
      {depT != null && (driveMin > 0 || dwellAtJobMin > 0 || offJobStops.length > 0) && (
        <div className="mx-4 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs">
          <span>🚗 ขับรถ ~<b className="text-foreground">{fmtDur(driveMin)}</b></span>
          <span>📦 ทำงานที่จุด ~<b className="text-foreground">{fmtDur(dwellAtJobMin)}</b></span>
          <span className={cn(offJobStops.length > 0 && "font-semibold text-red-400")}>
            🔴 นอกจุดงาน <b>{fmtDur(offJobStops.reduce((s, e) => s + e.durationMin, 0))}</b>
          </span>
        </div>
      )}

      <div className="px-4 pb-1 pt-3 text-xs text-muted-foreground">
        ROOT งานวันนี้ · {truck.arrivedCount}/{truck.totalStops} จุด — “เข้าใกล้จุดงาน ≈300 ม. = ถือว่าทำภารกิจแล้ว ✅”
      </div>

      <div className="px-4 pb-4">
        {/* ออฟฟิศ = จุดเริ่มต้นเสมอ */}
        <div className="flex items-center gap-3 border-b border-dashed border-border py-2.5">
          <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 border-primary bg-primary/20 text-xs">🏢</div>
          <div className="flex-1">
            <div className="text-sm font-medium">ออฟฟิศ (จุดเริ่มต้น)</div>
            <div className="text-xs text-muted-foreground">
              ออกรถ {thTime(truck.daily?.departedOfficeAt)}
            </div>
          </div>
        </div>

        {timelineRows.map((row, idx) => {
          // กลับถึงออฟฟิศ (แทรกตามเวลา — เหตุการณ์หลังจากนี้คือรถออกไปอีกรอบ)
          if (row.kind === "return") {
            return (
              <div key={`return-${idx}`} className="flex items-center gap-3 border-b border-dashed border-border py-2.5 last:border-none">
                <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-500/20 text-xs">🏁</div>
                <div className="flex-1">
                  <div className="text-sm font-medium">กลับถึงออฟฟิศ</div>
                  <div className="text-xs text-emerald-400">{thTime(truck.daily?.returnedOfficeAt)}</div>
                </div>
              </div>
            )
          }
          // แถวจอดนอกจุดงาน (แทรกตามเวลา) — สีแดง เห็นทันทีว่าหายไปช่วงไหนของวัน
          if (row.kind === "offjob") {
            const ev = row.ev
            const endT = ev.startT + ev.durationMin * 60_000
            return (
              <div
                key={`offjob-${idx}`}
                className="-mx-2 flex items-center gap-3 rounded-md border-b border-dashed border-border bg-red-500/10 px-2 py-2.5"
              >
                <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 border-red-500 text-xs text-red-400">
                  ⏸
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-red-400">🔴 จอดนอกจุดงาน {ev.durationMin} นาที</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{thTime(ev.startT)}–{thTime(endT)}</span>
                    <a
                      className="inline-flex items-center gap-1 rounded-md border border-sky-400/50 bg-sky-400/10 px-2 py-0.5 font-semibold text-sky-300 hover:bg-sky-400/20"
                      href={`https://www.google.com/maps/search/?api=1&query=${ev.lat},${ev.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      📍 ดูตำแหน่ง
                    </a>
                  </div>
                </div>
              </div>
            )
          }
          const s = row.entry
          const t = truck.daily?.stops?.find((d) => d.order === s.order)
          const longStop = t?.dwellMin != null && t.dwellMin > LONG_DWELL_MIN
          const tag = s.movedTo ? "โยกออก" : s.arrived ? "ถึงแล้ว" : s.isCurrent ? "กำลังไป" : "รอ"
          const tagCls = s.movedTo
            ? "text-muted-foreground"
            : s.arrived
              ? "text-emerald-400"
              : s.isCurrent
                ? "text-accent"
                : "text-muted-foreground"
          return (
            <div key={`${s.order}-${idx}`}>
              {!s.movedTo && t?.travelMinFromPrev != null && (() => {
                // ขายาวแต่เฉลี่ยช้า = น่าสงสัยว่าถ่วงเวลา (ไม่จับขาในเมือง/รถติดที่ช้าปกติ)
                const slowHaul = t.travelKmFromPrev != null && t.travelKmFromPrev >= 30 && t.avgSpeedKmh != null && t.avgSpeedKmh < 50
                return (
                <div className="flex items-center gap-1 py-0.5 pl-8 text-[11px] text-muted-foreground">
                  <Navigation className="h-3 w-3 rotate-90 opacity-60" /> เดินทาง {t.travelMinFromPrev} นาที
                  {t.travelKmFromPrev != null && <span> · {t.travelKmFromPrev} กม.</span>}
                  {t.avgSpeedKmh != null && (
                    <span className={cn(slowHaul && "font-semibold text-amber-400")}>
                      {" "}· เฉลี่ย {t.avgSpeedKmh} กม/ชม{slowHaul && " 🐢 ช้าผิดปกติ"}
                    </span>
                  )}
                </div>
                )
              })()}
              <div
                className={cn(
                  "flex items-center gap-3 border-b border-dashed border-border py-2.5 last:border-none",
                  longStop && "-mx-2 rounded-md bg-amber-500/10 px-2",
                  s.movedTo && "opacity-50"
                )}
              >
                <div
                  className={cn(
                    "flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-xs font-bold",
                    s.movedTo
                      ? "border-border text-muted-foreground"
                      : s.arrived
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : s.isCurrent
                          ? "border-accent text-accent"
                          : s.incomingFrom
                            ? "border-blue-400 text-blue-400"
                            : "border-border text-muted-foreground"
                  )}
                >
                  {s.movedTo ? "↦" : s.arrived ? "✓" : s.order}
                </div>
                <div className="flex-1">
                  <div className={cn("text-sm font-medium", s.movedTo && "line-through")}>
                    {s.name}
                    {row.count > 1 && (
                      <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {row.count} งาน
                      </span>
                    )}
                    {s.incomingFrom && (
                      <span className="ml-2 rounded bg-blue-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">
                        🔄 รับต่อจาก {s.incomingFrom.plate}
                        {s.incomingFrom.refused ? " (คนขับเดิมปฏิเสธ)" : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {s.movedTo ? (
                      <span className="text-blue-400">🔄 โยกให้ {s.movedTo} แล้ว — ไม่ใช่งานคันนี้</span>
                    ) : s.arrived ? (
                      <>
                        <Clock className="h-3 w-3" /> ถึง {s.arrivedAt ? thTime(s.arrivedAt) : "แล้ว"}
                        {t?.dwellMin != null && (
                          <span className={cn(longStop && "font-semibold text-amber-400")}>
                            {" "}· จอด {t.dwellMin} นาที{longStop && " ⚠ นานผิดสังเกต"}
                          </span>
                        )}
                        {t?.dwellMin != null && t.departedAt != null && (
                          <span> · ออก {thTime(t.departedAt)}</span>
                        )}
                      </>
                    ) : s.isCurrent ? (
                      "รถกำลังมุ่งหน้า"
                    ) : s.lat == null ? (
                      "จุดนี้ไม่มีพิกัด"
                    ) : (
                      "ยังไม่ถึงคิว"
                    )}
                  </div>
                </div>
                <div className={cn("self-center text-xs font-bold", tagCls)}>{tag}</div>
              </div>
            </div>
          )
        })}

      </div>
    </Card>
  )
}
