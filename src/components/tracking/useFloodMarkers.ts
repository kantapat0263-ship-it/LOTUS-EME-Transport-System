"use client"

/**
 * หมุดจุดวัดน้ำท่วม + กล่องรายละเอียด บนแผนที่ติดตามรถ (spec ข้อ 8)
 * - หมุดชุดแยกจากหมุดรถ/จุดงาน: GPS poll ไม่ล้างหมุดนี้ และโค้ดนี้ไม่แตะซูม/ตำแหน่งแผนที่
 * - สร้างหมุดใหม่เฉพาะเมื่อ markerKey เปลี่ยน (ไม่ใช่ทุก tick ของเวลา)
 * - สถานะกล่องทั้งหมดผ่าน floodInfoReducer · เนื้อหากล่องสร้างด้วย textContent เท่านั้น
 */

import * as React from "react"
import {
  ageLabel,
  CREDIT_TEXT,
  depthLabel,
  formatThaiClock,
  markerKey,
  NOT_OFFICIAL_TEXT,
  POPNIX_URL,
  type FloodSummary,
  type VisibleFloodPoint,
} from "@/lib/roadFlood"
import { floodInfoReducer, INITIAL_FLOOD_INFO, type FloodInfoEvent } from "./floodInfoState"

const CLOSE_DELAY_MS = 300
const HOVER_QUERY = "(hover: hover) and (pointer: fine)"
const COLOR = { flood: "#1d4ed8", slight: "#60a5fa", aging: "#6b7280" }
const FLOOD_Z_INDEX = 100 // ต่ำกว่าจุดงาน (500) / จอดนาน (900) / รถ (999)

function line(parent: HTMLElement, text: string, style = ""): HTMLDivElement {
  const div = document.createElement("div")
  div.textContent = text
  if (style) div.style.cssText = style
  parent.appendChild(div)
  return div
}

/** เนื้อหากล่อง — ข้อความจากต้นทางใส่ผ่าน textContent ทั้งหมด · ลิงก์เครดิตเป็น URL ตายตัว */
function buildContent(p: VisibleFloodPoint, now: number): HTMLElement {
  const root = document.createElement("div")
  root.style.cssText = "font:12px/1.45 system-ui,sans-serif;color:#1f2937;max-width:240px"

  line(
    root,
    `🌊 ${p.level === "flood" ? "น้ำท่วม" : "ท่วมเล็กน้อย"} · ค่าจากจุดวัด${p.isTunnel ? " · อุโมงค์" : ""}`,
    "font-weight:700"
  )
  line(root, [p.name, p.road, p.district ? `เขต${p.district}` : null, p.dir].filter(Boolean).join(" · "))
  line(
    root,
    p.depthCm == null
      ? "ไม่มีค่าความลึก"
      : p.depthAtLeast
        ? `ความลึกน้ำ อย่างน้อย ${p.depthCm} ซม.`
        : `ความลึกน้ำ ${p.depthCm} ซม.`,
    "font-weight:600"
  )
  if (p.floodingSince != null) line(root, `เริ่มท่วม ${formatThaiClock(p.floodingSince)}`)
  line(
    root,
    `${p.aging ? "⚠ ข้อมูลเก่า · " : ""}วัดเมื่อ ${formatThaiClock(p.measuredAt)} (${ageLabel(now - p.measuredAt)})`,
    p.aging ? "color:#b45309;font-weight:600" : ""
  )
  line(root, "ค่าเฉพาะจุดวัด ถนนช่วงอื่นอาจลึกหรือตื้นกว่านี้", "color:#6b7280;font-size:11px")

  const credit = document.createElement("div")
  credit.style.cssText = "color:#6b7280;font-size:11px;margin-top:2px"
  const a = document.createElement("a")
  a.href = POPNIX_URL
  a.target = "_blank"
  a.rel = "noopener noreferrer"
  a.textContent = `${CREDIT_TEXT} ↗`
  a.style.cssText = "color:#2563eb;text-decoration:underline"
  credit.appendChild(a)
  credit.appendChild(document.createTextNode(` · ${NOT_OFFICIAL_TEXT}`))
  root.appendChild(credit)
  return root
}

export function useFloodMarkers(o: {
  map: google.maps.Map | null
  ready: boolean
  active: boolean
  summary: FloodSummary | null
  now: number
}): void {
  const { map, ready, active, summary, now } = o
  const markersRef = React.useRef(new Map<string, google.maps.Marker>())
  const pointsRef = React.useRef(new Map<string, VisibleFloodPoint>())
  const nowRef = React.useRef(now)
  const mapRef = React.useRef(map)
  const infoRef = React.useRef<google.maps.InfoWindow | null>(null)
  const stateRef = React.useRef(INITIAL_FLOOD_INFO)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [canHover, setCanHover] = React.useState(false)

  // ข้อมูลล่าสุดสำหรับ handler (อ่านจาก ref เสมอ ไม่ใช่ closure เก่า) — effect นี้รันก่อน effect อื่นในรอบเดียวกัน
  React.useEffect(() => {
    pointsRef.current = new Map((summary?.visible ?? []).map((p) => [p.code, p]))
    nowRef.current = now
    mapRef.current = map
  })

  // hover ตัดสินจากความสามารถของอุปกรณ์ (notebook จอสัมผัส+เมาส์ = hover ได้) และติดตามการเปลี่ยน
  React.useEffect(() => {
    const mq = window.matchMedia(HOVER_QUERY)
    const update = () => setCanHover(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  // dispatch ตัวเดียวตลอดอายุ component — ทุกอย่างที่ใช้เป็น ref
  const dispatchRef = React.useRef<(ev: FloodInfoEvent) => void>(() => {})
  dispatchRef.current = React.useCallback((ev: FloodInfoEvent) => {
    const { state, effect } = floodInfoReducer(stateRef.current, ev)
    stateRef.current = state
    if (effect.clearTimer && timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (effect.close) infoRef.current?.close()
    if (effect.open) {
      const marker = markersRef.current.get(effect.open.code)
      const point = pointsRef.current.get(effect.open.code)
      const m = mapRef.current
      if (marker && point && m) {
        if (!infoRef.current) {
          infoRef.current = new google.maps.InfoWindow({ maxWidth: 260 })
          infoRef.current.addListener("closeclick", () => dispatchRef.current({ type: "closeClick" }))
        }
        const el = buildContent(point, nowRef.current)
        el.addEventListener("pointerenter", () => dispatchRef.current({ type: "enterContent" }))
        el.addEventListener("pointerleave", () => dispatchRef.current({ type: "leaveContent" }))
        infoRef.current.setContent(el)
        infoRef.current.setOptions({ disableAutoPan: !effect.open.autoPan })
        infoRef.current.open({ map: m, anchor: marker })
      }
    }
    if (effect.startTimer) {
      const code = effect.startTimer
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        dispatchRef.current({ type: "timerFired", code })
      }, CLOSE_DELAY_MS)
    }
  }, [])

  const key = markerKey(summary?.visible ?? [])

  // สร้างหมุดใหม่เมื่อชุดจุด/สี/ป้ายเปลี่ยน — ไม่เรียก fitBounds/setCenter/setZoom
  React.useEffect(() => {
    if (!ready || !map || !active) return
    const handles: google.maps.MapsEventListener[] = []
    const markers = new Map<string, google.maps.Marker>()
    for (const p of pointsRef.current.values()) {
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map,
        label: { text: depthLabel(p), color: "#fff", fontSize: "10px", fontWeight: "700" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: p.aging ? COLOR.aging : COLOR[p.level],
          fillOpacity: 0.95,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: FLOOD_Z_INDEX,
      })
      const code = p.code
      handles.push(marker.addListener("click", () => dispatchRef.current({ type: "clickMarker", code })))
      if (canHover) {
        handles.push(marker.addListener("mouseover", () => dispatchRef.current({ type: "hoverMarker", code })))
        handles.push(marker.addListener("mouseout", () => dispatchRef.current({ type: "leaveMarker", code })))
      }
      markers.set(code, marker)
    }
    markersRef.current = markers
    dispatchRef.current({ type: "rebuild", visibleCodes: [...markers.keys()] })
    return () => {
      handles.forEach((h) => google.maps.event.removeListener(h))
      markers.forEach((m) => m.setMap(null))
      markersRef.current = new Map()
    }
  }, [ready, map, active, key, canHover])

  // ปิดชั้น/ออกโหมดวันนี้ → ปิดกล่อง ล้าง timer ล้างสถานะ
  React.useEffect(() => {
    if (!active) dispatchRef.current({ type: "reset" })
  }, [active])

  // tick ของเวลา → รีเฟรชข้อความในกล่องที่เปิดอยู่ (ไม่สร้างหมุดใหม่ ไม่ dispatch)
  React.useEffect(() => {
    const code = stateRef.current.openCode
    const point = code ? pointsRef.current.get(code) : undefined
    if (!point || !infoRef.current) return
    const el = buildContent(point, now)
    el.addEventListener("pointerenter", () => dispatchRef.current({ type: "enterContent" }))
    el.addEventListener("pointerleave", () => dispatchRef.current({ type: "leaveContent" }))
    infoRef.current.setContent(el)
  }, [now])

  // unmount → ปิดกล่อง + ถอด listener ของกล่อง
  React.useEffect(
    () => () => {
      dispatchRef.current({ type: "reset" })
      if (infoRef.current) {
        google.maps.event.clearInstanceListeners(infoRef.current) // ของกล่องเราเท่านั้น ไม่ใช่ของ map
        infoRef.current = null
      }
    },
    []
  )
}
