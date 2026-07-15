"use client"

import * as React from "react"
import { Loader } from "@googlemaps/js-api-loader"

export interface TrackingMapStop {
  order: number
  name: string
  lat?: number
  lng?: number
  arrived: boolean
  isCurrent: boolean
}

export interface TrackingMapProps {
  apiKey?: string
  stops: TrackingMapStop[]
  truck?: { lat: number; lng: number } | null
  trail: { lat: number; lng: number }[]
  /** จุดออกรถ (คลัง/ออฟฟิศ) — ใช้เป็นต้นทางของเส้นทางที่ควรวิ่ง */
  origin?: { lat: number; lng: number } | null
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
export function TrackingMap({ apiKey, stops, truck, trail, origin }: TrackingMapProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<google.maps.Map | null>(null)
  const overlaysRef = React.useRef<Array<google.maps.Marker | google.maps.Polyline>>([])
  const routeRef = React.useRef<google.maps.Polyline | null>(null)
  const [ready, setReady] = React.useState(false)

  // โหลด map ครั้งเดียว
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current || !apiKey) return
    let cancelled = false
    const loader = new Loader({ apiKey, version: "weekly", libraries: ["geometry", "routes"] })
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

  // คีย์ของเส้นทาง (จุดงาน + ต้นทาง) — ใช้กันคำนวณ Directions ซ้ำตอนตำแหน่งรถอัปเดต
  const routeKey = React.useMemo(() => {
    const s = stops.filter(validLatLng).map((x) => `${x.lat},${x.lng}`).join("|")
    return `${origin ? `${origin.lat},${origin.lng}` : ""}>${s}`
  }, [stops, origin])

  // เส้นทางที่ควรวิ่ง (ถนนจริง) — คำนวณเมื่อจุดงาน/ต้นทางเปลี่ยนเท่านั้น
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const pts = stops.filter(validLatLng).map((s) => ({ lat: s.lat!, lng: s.lng! }))
    routeRef.current?.setMap(null)
    routeRef.current = null
    if (pts.length < 1) return

    const drawStraight = () => {
      const path = origin ? [origin, ...pts] : pts
      if (path.length < 2) return
      routeRef.current = new google.maps.Polyline({
        path,
        map,
        strokeOpacity: 0,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.6, strokeWeight: 2, scale: 3 }, offset: "0", repeat: "14px" }],
        strokeColor: "#4f6ef2",
      })
    }

    const originPt = origin ?? pts[0]
    const rest = origin ? pts : pts.slice(1)
    if (rest.length === 0) {
      drawStraight()
      return
    }
    const destination = rest[rest.length - 1]
    const waypoints = rest.slice(0, -1).map((location) => ({ location, stopover: true }))

    try {
      const ds = new google.maps.DirectionsService()
      ds.route(
        { origin: originPt, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING, region: "TH" },
        (res, status) => {
          if (!mapRef.current) return
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
      })
      overlaysRef.current.push(marker)
      bounds.extend(pos)
      hasPoint = true
    })

    // ตำแหน่งรถ
    if (truck) {
      const t = { lat: truck.lat, lng: truck.lng }
      const truckMarker = new google.maps.Marker({
        position: t,
        map,
        title: "ตำแหน่งรถตอนนี้",
        label: { text: "🚚", fontSize: "18px" },
        icon: {
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

    if (hasPoint) {
      map.fitBounds(bounds, 60)
      const listener = google.maps.event.addListenerOnce(map, "idle", () => {
        if ((map.getZoom() ?? 0) > 15) map.setZoom(15)
      })
      overlaysRef.current.push({ setMap: () => google.maps.event.removeListener(listener) } as any)
    }
  }, [ready, stops, truck, trail, origin])

  if (!apiKey) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        ยังไม่ได้ตั้งค่า Google Maps API key
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full rounded-lg" />
}
