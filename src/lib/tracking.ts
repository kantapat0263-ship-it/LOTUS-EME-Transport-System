/**
 * Logic การติดตามรถ (pure — ทดสอบได้) : ระยะทาง, geofence "เข้าใกล้จุดงาน = ทำแล้ว",
 * และการตรวจว่า GPS ออฟไลน์ (ข้อมูลเก่า)
 */

export interface LatLng {
  lat: number
  lng: number
}

/** ระยะทางระหว่างสองพิกัด (เมตร) ด้วยสูตร haversine */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000 // รัศมีโลก (เมตร)
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** รัศมีที่ถือว่า "ถึงจุดงานแล้ว" (เมตร) */
export const ARRIVAL_RADIUS_M = 300

/** เกินเวลานี้ (นาที) ถือว่า GPS ออฟไลน์/ข้อมูลเก่า */
export const STALE_THRESHOLD_MIN = 30

export interface StopStatus {
  order: number
  /** เคยเข้าใกล้จุดงานในรัศมีไหม = ทำภารกิจแล้ว */
  arrived: boolean
  /** ระยะที่เข้าใกล้ที่สุด (เมตร) — null ถ้าไม่มี trail */
  nearestM: number | null
  /** จุดนี้เป็นเป้าหมายปัจจุบัน (จุดแรกที่ยังไม่ถึง ตามลำดับ) */
  isCurrent: boolean
  /** เวลาที่เข้าใกล้จุดงานครั้งแรกโดยประมาณ (unix ms) — null ถ้ายังไม่ถึง/ไม่มีเวลาใน trail */
  arrivedAt: number | null
}

/** จุดใน trail: พิกัด + เวลา (unix ms) แบบ optional */
export type TrailPoint = LatLng & { t?: number }

/**
 * ประเมินสถานะแต่ละจุดงานจากเส้นทางที่วิ่งจริง (trail)
 * - arrived = มีจุดใน trail เข้าใกล้จุดงานภายใน radius
 * - isCurrent = จุดแรก (ตามลำดับ order) ที่ยังไม่ arrived
 * - arrivedAt = เวลาของจุด trail แรกที่เข้าใกล้ (ถ้ามี t)
 */
export function computeStopStatuses(
  stops: { order: number; lat?: number; lng?: number }[],
  trail: TrailPoint[],
  radius = ARRIVAL_RADIUS_M
): StopStatus[] {
  const ordered = [...stops].sort((a, b) => a.order - b.order)
  let currentAssigned = false

  return ordered.map((s) => {
    let nearestM: number | null = null
    let arrived = false
    let arrivedAt: number | null = null
    if (s.lat != null && s.lng != null && trail.length) {
      const stopPos = { lat: s.lat, lng: s.lng }
      for (const p of trail) {
        const d = haversineMeters(stopPos, p)
        if (nearestM == null || d < nearestM) nearestM = d
        if (d <= radius) {
          arrived = true
          if (arrivedAt == null && p.t != null) arrivedAt = p.t
        }
      }
    }
    const isCurrent = !arrived && !currentAssigned
    if (isCurrent) currentAssigned = true
    return { order: s.order, arrived, nearestM, isCurrent, arrivedAt }
  })
}

/** ระยะห่างเกินค่านี้ (เมตร) จากเส้นทางที่ควรวิ่ง = ถือว่าออกนอกเส้นทาง */
export const OFFROUTE_THRESHOLD_M = 2500

/**
 * ระยะห่างจากจุด p ถึงเส้น polyline (เมตร) — หาระยะที่สั้นที่สุดถึงทุกช่วง (segment)
 * ใช้ประมาณด้วยระนาบ equirectangular รอบ ๆ p (แม่นพอในระยะไม่กี่สิบกม.)
 * คืน null ถ้า polyline ว่าง
 */
export function distanceToPolylineMeters(p: LatLng, poly: LatLng[]): number | null {
  const pts = poly.filter((q) => q.lat != null && q.lng != null)
  if (pts.length === 0) return null
  if (pts.length === 1) return haversineMeters(p, pts[0])

  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const cosLat = Math.cos(toRad(p.lat))
  const toXY = (q: LatLng) => ({
    x: toRad(q.lng - p.lng) * cosLat * R,
    y: toRad(q.lat - p.lat) * R,
  })

  let min = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = toXY(pts[i - 1])
    const b = toXY(pts[i])
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    // p อยู่ที่ origin (0,0)
    let t = len2 === 0 ? 0 : -(a.x * dx + a.y * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const cx = a.x + t * dx
    const cy = a.y + t * dy
    const d = Math.sqrt(cx * cx + cy * cy)
    if (d < min) min = d
  }
  return min
}

/** รถออกนอกเส้นทางไหม (เทียบตำแหน่งรถกับเส้นทางตามแผน) */
export function isOffRoute(
  truck: LatLng,
  plannedRoute: LatLng[],
  threshold = OFFROUTE_THRESHOLD_M
): boolean {
  const d = distanceToPolylineMeters(truck, plannedRoute)
  return d != null && d > threshold
}

/** GPS ออฟไลน์/ข้อมูลเก่าไหม (positionTime เป็น unix ms) */
export function isPositionStale(
  positionTimeMs: number,
  nowMs: number,
  thresholdMin = STALE_THRESHOLD_MIN
): boolean {
  if (!positionTimeMs) return true
  return nowMs - positionTimeMs > thresholdMin * 60 * 1000
}

/**
 * คีย์วันที่สำหรับ trail รายวัน (YYYY-MM-DD) — ใช้ตรงกันทั้งฝั่ง sync (เขียน)
 * และหน้าเมนู (อ่าน) และให้ตรงแบบแผน Trip.tripDate ของแอป (UTC toISOString)
 */
export function trackingDateKey(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

/** ระยะรวมของเส้นทางที่วิ่งจริง (กม.) — ผลรวมช่วงต่อช่วง */
export function trailDistanceKm(trail: LatLng[]): number {
  let m = 0
  for (let i = 1; i < trail.length; i++) m += haversineMeters(trail[i - 1], trail[i])
  return m / 1000
}

/** รัศมีออฟฟิศ/คลัง (เมตร) ที่ถือว่า "อยู่ที่ออฟฟิศ" */
export const OFFICE_RADIUS_M = 250

/** พิกัดออฟฟิศ (จุดเริ่มต้นเสมอ) — ใช้เมื่อไม่ได้ตั้ง warehouse ใน companySettings */
export const OFFICE_LOCATION: LatLng = { lat: 14.093932911692894, lng: 100.68868332848953 }

/** จอด/แวะนานเกินค่านี้ (นาที) = ผิดสังเกต ควรตรวจสอบ (คุมทั้งหมุดบนแผนที่ + คำเตือน timeline) */
export const LONG_DWELL_MIN = 15

/** จุดจอด 1 จุดที่ตรวจจับได้จาก trail (รถอยู่นิ่งในรัศมีแคบนาน ๆ) */
export interface StopEvent {
  lat: number
  lng: number
  startT: number
  endT: number
  durationMin: number
}

/**
 * ตรวจจับ "จุดที่รถจอด/แวะ" จาก trail โดยตรง — จับกลุ่มจุดต่อเนื่องที่อยู่ในรัศมีแคบ (radiusM)
 * ต่อเนื่องกันนานอย่างน้อย minMinutes นาที (ครอบคลุมจุดที่ไม่ใช่จุดงานด้วย เช่นแวะพักนอกเส้นทาง)
 * คืนตำแหน่ง + เวลาเริ่ม/จบ + ระยะเวลาจอด (นาที)
 */
export function detectStops(
  trail: TrailPoint[],
  opts: { radiusM?: number; minMinutes?: number } = {}
): StopEvent[] {
  const radius = opts.radiusM ?? 120
  const minMin = opts.minMinutes ?? 10
  const pts = [...trail].filter((p) => p.t != null).sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
  const events: StopEvent[] = []
  let i = 0
  while (i < pts.length) {
    let j = i
    // ขยายกลุ่มตราบใดที่จุดถัดไปยังอยู่ในรัศมีของจุดเริ่มกลุ่ม
    while (j + 1 < pts.length && haversineMeters(pts[i], pts[j + 1]) <= radius) j++
    const durationMin = Math.round(((pts[j].t ?? 0) - (pts[i].t ?? 0)) / 60000)
    if (j > i && durationMin >= minMin) {
      events.push({
        lat: pts[i].lat,
        lng: pts[i].lng,
        startT: pts[i].t!,
        endT: pts[j].t!,
        durationMin,
      })
      i = j + 1
    } else {
      i++
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// สรุปรายวันต่อคัน — เวลาจอด/เดินทางแต่ละจุด + เข้า-ออกออฟฟิศ (คำนวณจาก trail)
// ---------------------------------------------------------------------------

export interface StopTiming {
  order: number
  siteName: string
  /** เวลาถึงจุด (unix ms) — null ถ้ายังไม่ถึง */
  arrivedAt: number | null
  /** เวลาออกจากจุด (unix ms) — null ถ้ายังไม่ออก/ยังไม่ถึง */
  departedAt: number | null
  /** จอดที่จุดกี่นาที (departedAt − arrivedAt) — null ถ้ายังคำนวณไม่ได้ */
  dwellMin: number | null
  /** เดินทางจากจุดก่อนหน้า (หรือจากออฟฟิศ) มากี่นาที — null ถ้าคำนวณไม่ได้ */
  travelMinFromPrev: number | null
}

export interface DailySummary {
  /** ออกจากออฟฟิศเมื่อ (unix ms) — null ถ้ายังไม่ออก/ไม่มีพิกัดออฟฟิศ */
  departedOfficeAt: number | null
  /** กลับถึงออฟฟิศเมื่อ (unix ms) — null ถ้ายังไม่กลับ */
  returnedOfficeAt: number | null
  totalKm: number
  stops: StopTiming[]
}

const toMin = (ms: number) => Math.round((ms / 60000) * 10) / 10

/**
 * คำนวณสรุปรายวันจาก trail (จุด {lat,lng,t}) + จุดงาน + พิกัดออฟฟิศ
 * - arrivedAt/departedAt ต่อจุด: จุด trail แรก/สุดท้ายที่อยู่ในรัศมี arrivalRadius
 * - travel = arrivedAt[n] − departedAt[n-1] (จุดแรกวัดจาก departedOfficeAt)
 * - departed/returnedOffice: ออก = จุดแรกที่พ้นรัศมีออฟฟิศ, กลับ = จุดแรกที่เข้ารัศมีอีกครั้งหลังออก
 */
export function computeDailySummary(
  trail: TrailPoint[],
  stops: { order: number; siteName?: string; lat?: number; lng?: number }[],
  origin: LatLng | null,
  opts: { arrivalRadius?: number; officeRadius?: number } = {}
): DailySummary {
  const arrivalRadius = opts.arrivalRadius ?? ARRIVAL_RADIUS_M
  const officeRadius = opts.officeRadius ?? OFFICE_RADIUS_M
  const pts = [...trail].filter((p) => p.t != null).sort((a, b) => (a.t ?? 0) - (b.t ?? 0))

  // ---- เข้า-ออกออฟฟิศ ----
  let departedOfficeAt: number | null = null
  let returnedOfficeAt: number | null = null
  if (origin && pts.length) {
    for (const p of pts) {
      const inOffice = haversineMeters(origin, p) <= officeRadius
      if (departedOfficeAt == null) {
        if (!inOffice) departedOfficeAt = p.t! // ออกจากออฟฟิศแล้ว
      } else if (inOffice) {
        returnedOfficeAt = p.t! // กลับเข้ารัศมีออฟฟิศครั้งแรกหลังออก
        break
      }
    }
  }

  // ---- เวลาถึง/ออก ต่อจุดงาน ----
  const ordered = [...stops].sort((a, b) => a.order - b.order)
  const timings: StopTiming[] = ordered.map((s) => {
    let arrivedAt: number | null = null
    let departedAt: number | null = null
    if (s.lat != null && s.lng != null) {
      const stopPos = { lat: s.lat, lng: s.lng }
      for (const p of pts) {
        if (haversineMeters(stopPos, p) <= arrivalRadius) {
          if (arrivedAt == null) arrivedAt = p.t!
          departedAt = p.t!
        }
      }
    }
    const dwellMin = arrivedAt != null && departedAt != null && departedAt > arrivedAt ? toMin(departedAt - arrivedAt) : null
    return { order: s.order, siteName: s.siteName ?? "", arrivedAt, departedAt, dwellMin, travelMinFromPrev: null }
  })

  // ---- เวลาเดินทางช่วง (ถึงจุดนี้ − ออกจุดก่อน / ออกออฟฟิศ) ----
  let prevDepart: number | null = departedOfficeAt
  for (const t of timings) {
    if (t.arrivedAt != null && prevDepart != null && t.arrivedAt > prevDepart) {
      t.travelMinFromPrev = toMin(t.arrivedAt - prevDepart)
    }
    if (t.departedAt != null) prevDepart = t.departedAt
  }

  return {
    departedOfficeAt,
    returnedOfficeAt,
    totalKm: Math.round(trailDistanceKm(pts) * 10) / 10,
    stops: timings,
  }
}
