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
import type {
  Vehicle,
  Trip,
  CompanySetting,
  VehiclePositionDoc,
  VehicleTrailDoc,
} from "@/types/models"
import {
  computeStopStatuses,
  isPositionStale,
  isOffRoute,
  trackingDateKey,
  type TrailPoint,
} from "@/lib/tracking"
import { TrackingMap, type TrackingMapStop } from "@/components/tracking/TrackingMap"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { MapPin, AlertTriangle, WifiOff, Navigation, Clock } from "lucide-react"

type TruckStatus = "ok" | "offroute" | "stale" | "done" | "unmapped"

interface TruckView {
  trip: Trip
  deviceId?: string
  position?: VehiclePositionDoc
  trail: TrailPoint[]
  stops: TrackingMapStop[]
  arrivedCount: number
  totalStops: number
  status: TruckStatus
  offRoute: boolean
  stale: boolean
  arrivedAtByOrder: Record<number, number | null>
}

const STATUS_META: Record<TruckStatus, { label: string; cls: string }> = {
  ok: { label: "ตามแผน", cls: "bg-emerald-500/15 text-emerald-400" },
  done: { label: "จบงานแล้ว", cls: "bg-emerald-500/15 text-emerald-400" },
  offroute: { label: "⚠ ออกนอกเส้นทาง", cls: "bg-red-500/15 text-red-400" },
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
  const today = React.useMemo(() => trackingDateKey(), [])
  const [now, setNow] = React.useState<number>(() => Date.now())
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  // อัปเดต "เวลาปัจจุบัน" ทุก 60 วิ (เพื่อคำนวณ GPS ออฟไลน์)
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

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
    () => (db && user ? query(collection(db, "trips"), where("tripDate", "==", today)) : null),
    [db, user, today]
  )
  const { data: trips, isLoading: loadingTrips } = useCollection<Trip>(tripsRef)

  const trailsRef = useMemoFirebase(
    () =>
      db && user
        ? query(collection(db, "vehiclePositionTrails"), where("date", "==", today))
        : null,
    [db, user, today]
  )
  const trails = useSafeCollection<VehicleTrailDoc>(trailsRef)

  const settingsRef = useMemoFirebase(
    () => (db && user ? doc(db, "companySettings", "default") : null),
    [db, user]
  )
  const { data: settings } = useDoc<CompanySetting>(settingsRef)

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || settings?.googleMapsApiKeyReference

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

    const activeTrips = (trips ?? []).filter((t) => t.status !== "Cancelled")

    return activeTrips.map((trip) => {
      const deviceId = plateToDevice[trip.vehiclePlate]
      const position = deviceId ? deviceToPos[deviceId] : undefined
      const trail = deviceId ? deviceToTrail[deviceId] ?? [] : []

      const sortedStops = [...(trip.stops ?? [])].sort((a, b) => a.order - b.order)
      const statuses = computeStopStatuses(
        sortedStops.map((s) => ({ order: s.order, lat: s.lat, lng: s.lng })),
        trail
      )
      const arrivedAtByOrder: Record<number, number | null> = {}
      statuses.forEach((st) => (arrivedAtByOrder[st.order] = st.arrivedAt))

      const stops: TrackingMapStop[] = sortedStops.map((s, i) => ({
        order: s.order,
        name: s.siteName,
        lat: s.lat,
        lng: s.lng,
        arrived: statuses[i]?.arrived ?? false,
        isCurrent: statuses[i]?.isCurrent ?? false,
      }))

      const arrivedCount = statuses.filter((s) => s.arrived).length
      const totalStops = sortedStops.length
      const plannedRoute = sortedStops
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({ lat: s.lat!, lng: s.lng! }))

      const stale = position ? isPositionStale(position.positionTime, now) : true
      const hasPending = arrivedCount < totalStops
      const offRoute =
        !!position && !stale && hasPending && isOffRoute({ lat: position.lat, lng: position.lng }, plannedRoute)

      let status: TruckStatus
      if (!deviceId) status = "unmapped"
      else if (offRoute) status = "offroute"
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
        offRoute,
        stale,
        arrivedAtByOrder,
      }
    })
  }, [vehicles, positions, trails, trips, now])

  // เรียงคันมีปัญหาขึ้นก่อน
  const order: Record<TruckStatus, number> = { offroute: 0, stale: 1, ok: 2, unmapped: 3, done: 4 }
  const sortedTrucks = React.useMemo(
    () => [...trucks].sort((a, b) => order[a.status] - order[b.status]),
    [trucks]
  )

  React.useEffect(() => {
    if (!selectedId && sortedTrucks.length) setSelectedId(sortedTrucks[0].trip.id)
  }, [sortedTrucks, selectedId])

  const selected = trucks.find((t) => t.trip.id === selectedId) ?? null

  const kpis = React.useMemo(() => {
    const arrived = trucks.reduce((s, t) => s + t.arrivedCount, 0)
    const total = trucks.reduce((s, t) => s + t.totalStops, 0)
    return {
      trucks: trucks.length,
      arrived,
      total,
      offroute: trucks.filter((t) => t.status === "offroute").length,
      stale: trucks.filter((t) => t.status === "stale").length,
    }
  }, [trucks])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Navigation className="h-5 w-5 text-accent" />
          ติดตามรถวันนี้
        </h1>
        <span className="text-sm text-muted-foreground">
          {new Date(now).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </span>
        <span className="ml-auto rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          อัปเดตอัตโนมัติทุก 1–2 นาที
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard n={kpis.trucks} label="รถวิ่งงานวันนี้" />
        <KpiCard n={`${kpis.arrived}/${kpis.total}`} label="จุดงานที่ผ่านแล้ว" />
        <KpiCard n={kpis.offroute} label="⚠ ออกนอกเส้นทาง" tone={kpis.offroute ? "bad" : undefined} />
        <KpiCard n={kpis.stale} label="GPS ออฟไลน์" tone={kpis.stale ? "warn" : undefined} />
      </div>

      {loadingTrips ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">กำลังโหลด…</CardContent>
        </Card>
      ) : trucks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            ยังไม่มีรถที่มีงานวันนี้ (ทริปของวันที่ {today})
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* รายการรถ */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b py-3">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                รถที่มีงานวันนี้ ({trucks.length})
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
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{t.trip.vehiclePlate}</span>
                      <Badge className={cn("ml-auto border-none text-[10px]", meta.cls)}>{meta.label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      คนขับ {t.trip.driverName || "-"} · ผ่าน {t.arrivedCount}/{t.totalStops} จุด
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
          {selected && <TruckDetail truck={selected} apiKey={apiKey} thTime={thTime} />}
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
}: {
  truck: TruckView
  apiKey?: string
  thTime: (ms?: number | null) => string
}) {
  const meta = STATUS_META[truck.status]
  const pos = truck.position
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 border-b py-3">
        <CardTitle className="text-base">{truck.trip.vehiclePlate}</CardTitle>
        <Badge className={cn("border-none text-[10px]", meta.cls)}>{meta.label}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {truck.deviceId ? (
            truck.stale ? (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <WifiOff className="h-3.5 w-3.5" /> ข้อมูลล่าสุด {thTime(pos?.positionTime)}
              </span>
            ) : pos && pos.speed > 0 ? (
              <span className="text-emerald-400">🟢 วิ่ง {pos.speed} กม./ชม.</span>
            ) : (
              <span>⚪ จอดอยู่</span>
            )
          ) : (
            "ยังไม่จับคู่ GPS กับทะเบียนนี้"
          )}
          {truck.deviceId ? ` · GPS #${truck.deviceId}` : ""}
        </span>
      </CardHeader>

      <div className="h-[340px] w-full bg-muted/20 p-2">
        <TrackingMap
          apiKey={apiKey}
          stops={truck.stops}
          trail={truck.trail}
          truck={pos ? { lat: pos.lat, lng: pos.lng, offRoute: truck.offRoute } : null}
        />
      </div>

      {truck.status === "offroute" && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-400">
          <AlertTriangle className="h-4 w-4" /> รถออกนอกเส้นทางที่ควรวิ่ง — ตรวจสอบกับคนขับ
        </div>
      )}
      {truck.status === "unmapped" && (
        <div className="mx-4 mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          ทะเบียน {truck.trip.vehiclePlate} ยังไม่ได้จับคู่กับเลข GPS — ไปที่เมนู “ฟลีทรถและคนขับ” เพื่อใส่เลขอุปกรณ์
        </div>
      )}

      <div className="px-4 pb-1 pt-3 text-xs text-muted-foreground">
        ROOT งานวันนี้ · {truck.arrivedCount}/{truck.totalStops} จุด — “เข้าใกล้จุดงาน ≈300 ม. = ถือว่าทำภารกิจแล้ว ✅”
      </div>

      <div className="px-4 pb-4">
        {truck.stops.map((s) => {
          const tag = s.arrived ? "ถึงแล้ว" : s.isCurrent ? "กำลังไป" : "รอ"
          const tagCls = s.arrived ? "text-emerald-400" : s.isCurrent ? "text-accent" : "text-muted-foreground"
          const arrivedAt = truck.arrivedAtByOrder[s.order]
          return (
            <div key={s.order} className="flex items-center gap-3 border-b border-dashed border-border py-2.5 last:border-none">
              <div
                className={cn(
                  "flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-xs font-bold",
                  s.arrived
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : s.isCurrent
                      ? "border-accent text-accent"
                      : "border-border text-muted-foreground"
                )}
              >
                {s.arrived ? "✓" : s.order}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">{s.name}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {s.arrived ? (
                    <>
                      <Clock className="h-3 w-3" /> เข้าใกล้จุดงาน {arrivedAt ? thTime(arrivedAt) : "แล้ว"} ✅
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
          )
        })}
      </div>
    </Card>
  )
}
