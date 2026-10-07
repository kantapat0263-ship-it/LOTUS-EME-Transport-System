"use client"

import * as React from "react"
import { Loader } from "@googlemaps/js-api-loader"
import { summarizeFlood } from "@/lib/roadFlood"
import { formatDurationMinutes } from "@/lib/formatDuration"
import { useRoadFlood } from "@/hooks/use-road-flood"
import { useFloodMarkers } from "./useFloodMarkers"
import { FloodStatusBar } from "./FloodStatusBar"

export interface TrackingMapStop {
  order: number
  name: string
  lat?: number
  lng?: number
  arrived: boolean
  isCurrent: boolean
}

export interface TrackingMapStopEvent {
  lat: number
  lng: number
  durationMin: number
  nearJob: boolean
  kind?: 'office' | 'job' | 'rest' | 'lunch' | 'review'
}

export interface TrackingMapProps {
  apiKey?: string
  stops: TrackingMapStop[]
  truck?: { lat: number; lng: number; direction?: number | null; speed?: number | null } | null
  trail: { lat: number; lng: number }[]
  /** จุดออกรถ (คลัง/ออฟฟิศ) — ใช้เป็นต้นทางของเส้นทางที่ควรวิ่ง */
  origin?: { lat: number; lng: number } | null
  /** จุดจอดนานผิดสังเกต — มาร์คด้วยหมุด ⏸ + ระยะเวลา */
  stopEvents?: TrackingMapStopEvent[]
  /** โหมดสด (วันนี้) — เปิดปุ่มชั้นจราจร (จราจรเป็นข้อมูล "ตอนนี้" ไม่ตรงกับการดูย้อนหลัง) */
  live?: boolean
  /** ตัวระบุ "การเลือก" (เช่น id ทริป/วัน) — เปลี่ยนค่านี้ = zoom ให้พอดีใหม่ครั้งเดียว
   *  ค่าเดิม = ไม่แตะซูม (กันแผนที่เด้งออกตอน poll ระหว่างผู้ใช้กำลังซูมดู) */
  fitKey?: string
  /** รูปแบบเส้นทาง — "return" (กลับอย่างเดียว) วาดจากจุดงาน → ออฟฟิศ · อื่น ๆ วาดจากออฟฟิศ → จุดงาน */
  routeMode?: "round" | "outbound" | "return"
}

// โทนแผนที่เข้ม (ชุดเดียวกับ GroupingMap เพื่อความกลมกลืน)
const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#2d3139" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1c23" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9aa0b3" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a1c23" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#172899" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
]

const DEFAULT_CENTER = { lat: 13.7563, lng: 100.5018 } // กรุงเทพฯ
const validLatLng = (s: { lat?: number; lng?: number }) => s.lat != null && s.lng != null

/**
 * แผนที่ติดตามรถ 1 คัน:
 *  - เส้นน้ำเงินโปร่ง (ทึบ) = เส้นทางถนนจริงที่ควรวิ่ง (Google Directions ผ่านจุดงานตามลำดับ)
 *    ถ้าคำนวณไม่ได้ → fallback เส้นประลากตรงผ่านจุดงาน
 *  - เส้น teal = เส้นทางที่วิ่งจริง (trail)
 *  - หมุดจุดงาน: เขียว = ถึงแล้ว, ส้ม = เป้าหมายปัจจุบัน, เทา = รอ
 *  - 🚚 = ตำแหน่งรถล่าสุด
 */
export function TrackingMap({ apiKey, stops, truck, trail, origin, stopEvents, live, fitKey, routeMode }: TrackingMapProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<google.maps.Map | null>(null)
  const overlaysRef = React.useRef<Array<google.maps.Marker | google.maps.Polyline>>([])
  const routeRef = React.useRef<google.maps.Polyline | null>(null)
  const trafficRef = React.useRef<google.maps.TrafficLayer | null>(null)
  const lastFitKeyRef = React.useRef<string | null>(null) // zoom พอดีครั้งเดียวต่อการเลือก
  const [ready, setReady] = React.useState(false)
  const [trafficOn, setTrafficOn] = React.useState(false)
  // ชั้นน้ำท่วมถนน กทม. — floodOn คือความตั้งใจของผู้ใช้ (คงไว้ข้ามโหมดดูย้อนหลัง) · แสดงจริงเฉพาะโหมดวันนี้
  const [floodOn, setFloodOn] = React.useState(false)
  const floodLive = floodOn && !!live
  const flood = useRoadFlood(floodLive)
  const floodSummary = React.useMemo(
    () => (flood.snapshot ? summarizeFlood(flood.snapshot, flood.now) : null),
    [flood.snapshot, flood.now]
  )
  useFloodMarkers({ map: ready ? mapRef.current : null, ready, active: floodLive, summary: floodSummary, now: flood.now })

  // โหลด map ครั้งเดียว
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current || !apiKey) return
    let cancelled = false
    // ต้องใช้ options เดียวกับ GroupingMap เป๊ะ ๆ (Loader เป็น singleton ทั้งแอป —
    // ถ้าต่างกันจะ throw "Loader must not be called again with different options" ตอนสลับหน้า)
    const loader = new Loader({ apiKey, version: "weekly", libraries: ["places", "geometry"] })
    loader
      .load()
      .then(() => {
        if (cancelled || !containerRef.current) return
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: 10,
          styles: DARK_STYLE,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        })
        setReady(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [apiKey])

  // ชั้นจราจรสด (Google TrafficLayer) — เปิด/ปิดได้ ไม่มีค่าใช้จ่ายเพิ่ม (ติดมากับ map load เดิม)
  React.useEffect(() => {
    if (!ready || !mapRef.current) return
    if (trafficOn) {
      if (!trafficRef.current) trafficRef.current = new google.maps.TrafficLayer()
      trafficRef.current.setMap(mapRef.current)
    } else {
      trafficRef.current?.setMap(null)
    }
  }, [trafficOn, ready])

  // คีย์ของเส้นทาง (จุดงาน + ต้นทาง) — ใช้กันคำนวณ Directions ซ้ำตอนตำแหน่งรถอัปเดต
  const routeKey = React.useMemo(() => {
    const s = stops.filter(validLatLng).map((x) => `${x.lat},${x.lng}`).join("|")
    return `${routeMode ?? ""}|${origin ? `${origin.lat},${origin.lng}` : ""}>${s}`
  }, [stops, origin, routeMode])

  // เส้นทางที่ควรวิ่ง (ถนนจริง) — คำนวณเมื่อจุดงาน/ต้นทางเปลี่ยนเท่านั้น
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const pts = stops.filter(validLatLng).map((s) => ({ lat: s.lat!, lng: s.lng! }))
    routeRef.current?.setMap(null)
    routeRef.current = null
    if (pts.length < 1) return

    const isReturn = routeMode === "return" && !!origin // กลับอย่างเดียว: จุดงาน → ออฟฟิศ
    const drawStraight = () => {
      const path = isReturn ? [...pts, origin!] : origin ? [origin, ...pts] : pts
      if (path.length < 2) return
      routeRef.current = new google.maps.Polyline({
        path,
        map,
        strokeOpacity: 0,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.6, strokeWeight: 2, scale: 3 }, offset: "0", repeat: "14px" }],
        strokeColor: "#4f6ef2",
      })
    }

    const originPt = isReturn ? pts[0] : origin ?? pts[0]
    const rest = isReturn ? [...pts.slice(1), origin!] : origin ? pts : pts.slice(1)
    if (rest.length === 0) {
      drawStraight()
      return
    }
    const destination = rest[rest.length - 1]
    const waypoints = rest.slice(0, -1).map((location) => ({ location, stopover: true }))

    let cancelled = false // routeKey เปลี่ยนก่อนผลตอบ → ทิ้งผลเก่า ไม่ให้วาดทับเส้นใหม่
    try {
      const ds = new google.maps.DirectionsService()
      ds.route(
        { origin: originPt, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING, region: "TH" },
        (res, status) => {
          if (!mapRef.current || cancelled) return
          if (status === google.maps.DirectionsStatus.OK && res?.routes?.[0]) {
            routeRef.current?.setMap(null)
            routeRef.current = new google.maps.Polyline({
              path: res.routes[0].overview_path,
              map,
              strokeColor: "#5b7cfa",
              strokeWeight: 5,
              strokeOpacity: 0.55,
            })
          } else {
            drawStraight() // คำนวณถนนไม่ได้ → เส้นประลากตรงแทน
          }
        }
      )
    } catch {
      drawStraight()
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routeKey])

  // หมุด/รถ/เส้นที่วิ่งจริง — วาดใหม่ทุกครั้งที่ตำแหน่งเปลี่ยน
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []
    const bounds = new google.maps.LatLngBounds()
    let hasPoint = false
    const validStops = stops.filter(validLatLng)

    // เส้นทางที่วิ่งจริง (teal)
    if (trail.length >= 2) {
      const actual = new google.maps.Polyline({
        path: trail,
        map,
        strokeColor: "#2fb6a0",
        strokeWeight: 4,
        strokeOpacity: 0.95,
      })
      overlaysRef.current.push(actual)
      trail.forEach((p) => {
        bounds.extend(p)
        hasPoint = true
      })
    }

    // หมุดจุดงาน
    validStops.forEach((s) => {
      const pos = { lat: s.lat!, lng: s.lng! }
      const color = s.arrived ? "#1f9d55" : s.isCurrent ? "#F0890D" : "#5c6675"
      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: `${s.order}. ${s.name}${s.arrived ? " (ถึงแล้ว)" : ""}`,
        label: { text: s.arrived ? "✓" : String(s.order), color: "#fff", fontSize: "12px", fontWeight: "700" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: s.isCurrent ? 13 : 11,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 500, // อยู่เหนือหมุดน้ำท่วม (100) แต่ใต้จุดจอดนาน (900) และรถ (999)
      })
      overlaysRef.current.push(marker)
      bounds.extend(pos)
      hasPoint = true
    })

    // ตำแหน่งรถ — กำลังวิ่ง (speed>0 + มีทิศ) = ลูกศรหันตามทิศล้วน ๆ (ไม่มีวงกลม)
    // ตอนจอด (speed=0) heading จาก GPS มักค้าง/มั่ว → โชว์วงกลม 🚚 แทน
    if (truck) {
      const t = { lat: truck.lat, lng: truck.lng }
      const heading = truck.direction
      const moving = (truck.speed ?? 0) > 0 && heading != null && !Number.isNaN(heading)
      const truckMarker = new google.maps.Marker({
        position: t,
        map,
        title: moving ? "ตำแหน่งรถตอนนี้ (หัวลูกศร = ทิศที่มุ่งหน้า)" : "ตำแหน่งรถตอนนี้",
        label: moving ? undefined : { text: "🚚", fontSize: "18px" },
        icon: moving
          ? {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 9,
              rotation: heading as number, // องศาตามเข็มนาฬิกา 0=เหนือ ตรงกับ heading GPS
              fillColor: "#F0890D",
              fillOpacity: 1,
              strokeColor: "#fff",
              strokeWeight: 2,
            }
          : {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 16,
              fillColor: "#F0890D",
              fillOpacity: 1,
              strokeColor: "#fff",
              strokeWeight: 2,
            },
        zIndex: 999,
      })
      overlaysRef.current.push(truckMarker)
      bounds.extend(t)
      hasPoint = true
    }

    // จุดจอด: พักปกติ = เทา, ที่จุดงาน = ส้ม, รอตรวจสอบ = แดง
    ;(stopEvents ?? []).forEach((ev) => {
      const pos = { lat: ev.lat, lng: ev.lng }
      const kind = ev.kind ?? (ev.nearJob ? 'job' : 'review')
      const description = { office: 'ที่ออฟฟิศ', job: 'ที่จุดงาน', rest: 'พักหลังขับต่อเนื่อง', lunch: 'พักเที่ยง', review: 'นอกจุดงาน · รอตรวจสอบ' }[kind]
      const color = kind === 'job' ? '#d98a00' : kind === 'review' ? '#d64027' : '#6b7280'
      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: `จอด ${formatDurationMinutes(ev.durationMin)} (${description})`,
        label: { text: `⏸${formatDurationMinutes(ev.durationMin, 'compact')}`, color: "#fff", fontSize: "11px", fontWeight: "700" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 15,
          fillColor: color,
          fillOpacity: 0.95,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 900,
      })
      overlaysRef.current.push(marker)
      bounds.extend(pos)
      hasPoint = true
    })

    // ออฟฟิศ (จุดเริ่มต้น)
    if (origin) {
      const officeMarker = new google.maps.Marker({
        position: origin,
        map,
        title: "ออฟฟิศ (จุดเริ่มต้น)",
        label: { text: "🏢", fontSize: "16px" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 13,
          fillColor: "#4f6ef2",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
      })
      overlaysRef.current.push(officeMarker)
      bounds.extend(origin)
      hasPoint = true
    }

    // zoom ให้พอดี "ครั้งเดียวต่อการเลือก" (fitKey เปลี่ยน) — รอบ poll ถัดมาไม่แตะซูม
    // เพื่อไม่ให้แผนที่เด้งออกตอนผู้ใช้กำลังซูมดูสถานที่อยู่
    const fitId = fitKey ?? ""
    if (hasPoint && lastFitKeyRef.current !== fitId) {
      lastFitKeyRef.current = fitId
      map.fitBounds(bounds, 60)
      const listener = google.maps.event.addListenerOnce(map, "idle", () => {
        if ((map.getZoom() ?? 0) > 15) map.setZoom(15)
      })
      overlaysRef.current.push({ setMap: () => google.maps.event.removeListener(listener) } as any)
    }
  }, [ready, stops, truck, trail, origin, stopEvents, fitKey])

  if (!apiKey) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        ยังไม่ได้ตั้งค่า Google Maps API key
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-lg" />
      {ready && live && (
        <div className="absolute right-2 top-2 z-10 flex gap-1.5">
          <button
            type="button"
            onClick={() => setTrafficOn((v) => !v)}
            title="แสดง/ซ่อนสภาพจราจรสด"
            className={
              "rounded-md border px-2.5 py-1 text-xs font-medium shadow-md backdrop-blur transition " +
              (trafficOn
                ? "border-orange-400/60 bg-orange-500/90 text-white"
                : "border-border bg-background/80 text-foreground hover:bg-background")
            }
          >
            🚦 จราจร{trafficOn ? " เปิด" : ""}
          </button>
          <button
            type="button"
            onClick={() => setFloodOn((v) => !v)}
            title="แสดง/ซ่อนจุดวัดน้ำท่วมถนน กทม."
            className={
              "rounded-md border px-2.5 py-1 text-xs font-medium shadow-md backdrop-blur transition " +
              (floodOn
                ? "border-blue-400/60 bg-blue-600/90 text-white"
                : "border-border bg-background/80 text-foreground hover:bg-background")
            }
          >
            🌊 น้ำท่วม{floodOn ? " เปิด" : ""}
          </button>
        </div>
      )}
      {ready && floodLive && (
        <FloodStatusBar
          phase={flood.phase}
          lastFailed={flood.lastFailed}
          snapshot={flood.snapshot}
          summary={floodSummary}
          now={flood.now}
        />
      )}
    </div>
  )
}
