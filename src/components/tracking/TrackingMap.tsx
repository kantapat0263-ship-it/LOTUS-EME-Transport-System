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
  truck?: { lat: number; lng: number; offRoute?: boolean } | null
  trail: { lat: number; lng: number }[]
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

/**
 * แผนที่ติดตามรถ 1 คัน:
 *  - เส้นประ (primary) = ROOT งานตามแผน (ลากผ่านจุดงานตามลำดับ)
 *  - เส้นทึบ (teal) = เส้นทางที่วิ่งจริง (trail)
 *  - หมุดจุดงาน: เขียว = ถึงแล้ว, ส้ม = เป้าหมายปัจจุบัน, เทา = รอ
 *  - 🚚 = ตำแหน่งรถล่าสุด
 */
export function TrackingMap({ apiKey, stops, truck, trail }: TrackingMapProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<google.maps.Map | null>(null)
  const overlaysRef = React.useRef<Array<google.maps.Marker | google.maps.Polyline>>([])
  const [ready, setReady] = React.useState(false)

  // โหลด map ครั้งเดียว
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current || !apiKey) return
    let cancelled = false
    const loader = new Loader({ apiKey, version: "weekly", libraries: ["geometry"] })
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

  // วาด overlays ใหม่ทุกครั้งที่ข้อมูลเปลี่ยน
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []
    const bounds = new google.maps.LatLngBounds()
    let hasPoint = false

    const validStops = stops.filter((s) => s.lat != null && s.lng != null)

    // ROOT งานตามแผน (เส้นประ)
    if (validStops.length >= 2) {
      const planned = new google.maps.Polyline({
        path: validStops.map((s) => ({ lat: s.lat!, lng: s.lng! })),
        map,
        strokeOpacity: 0,
        icons: [
          {
            icon: { path: "M 0,-1 0,1", strokeOpacity: 0.7, strokeWeight: 2, scale: 3 },
            offset: "0",
            repeat: "14px",
          },
        ],
        strokeColor: "#4f6ef2",
      })
      overlaysRef.current.push(planned)
    }

    // เส้นทางที่วิ่งจริง (เส้นทึบ teal)
    if (trail.length >= 2) {
      const actual = new google.maps.Polyline({
        path: trail,
        map,
        strokeColor: "#2fb6a0",
        strokeWeight: 4,
        strokeOpacity: 0.9,
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
          fillColor: truck.offRoute ? "#d64027" : "#F0890D",
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

    if (hasPoint) {
      map.fitBounds(bounds, 60)
      // กันซูมชิดเกินเมื่อมีจุดเดียว
      const listener = google.maps.event.addListenerOnce(map, "idle", () => {
        if ((map.getZoom() ?? 0) > 15) map.setZoom(15)
      })
      overlaysRef.current.push({ setMap: () => google.maps.event.removeListener(listener) } as any)
    }
  }, [ready, stops, truck, trail])

  if (!apiKey) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        ยังไม่ได้ตั้งค่า Google Maps API key
        <br />
        (env NEXT_PUBLIC_GOOGLE_MAPS_API_KEY หรือ companySettings.googleMapsApiKeyReference)
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full rounded-lg" />
}
