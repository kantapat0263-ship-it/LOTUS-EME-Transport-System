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

// ---------------------------------------------------------------------------
// แจ้งเตือนจากอุปกรณ์ (nAlarmState bitmask) + ความเร็วเกิน + ระยะสะสม
// ถอดบิตจากแพลตฟอร์ม SinoTrack: isLowPowerAlarm=32768, isOverSpeed=(speed>120 || bit64)
// ---------------------------------------------------------------------------

/** บิตแจ้งเตือน "ตัดไฟ/แบตต่ำ" (GPS ถูกถอด/ไฟหาย → รันแบตสำรอง) */
export const ALARM_POWER_CUT = 32768
/** บิตแจ้งเตือน "ความเร็วเกิน" จากตัวอุปกรณ์ */
export const ALARM_OVERSPEED = 64
/** เกณฑ์ความเร็วเกิน (กม./ชม.) ฝั่งเรา — ปรับได้ */
export const OVERSPEED_KMH = 90

/** GPS ถูกถอด/ตัดไฟไหม (จาก nAlarmState) */
export function isPowerCut(alarmState: number): boolean {
  return (alarmState & ALARM_POWER_CUT) !== 0
}

/** ความเร็วเกินไหม — เกินเกณฑ์เรา หรืออุปกรณ์แจ้งเตือน overspeed */
export function isOverspeed(speed: number, alarmState = 0, threshold = OVERSPEED_KMH): boolean {
  return speed > threshold || (alarmState & ALARM_OVERSPEED) !== 0
}

/** ระยะสะสมจากอุปกรณ์ (เมตร) → กม. (ปัดทศนิยม 0) */
export function mileageKm(mileageMeters: number): number {
  return Math.round((mileageMeters || 0) / 1000)
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

/** ต้องเคยห่างออฟฟิศเกินระยะนี้ (เมตร) จึงถือว่า "ออกไปทำงานจริง" แล้วค่อยเริ่มนับการกลับ — กัน GPS เด้งรอบออฟฟิศตอนเพิ่งออกตัว ถูกนับเป็นกลับผิด ๆ */
export const DEPARTED_FAR_M = 1000

/** ต้องอยู่ในรัศมีออฟฟิศต่อเนื่องอย่างน้อยกี่นาที ถึงนับว่า "กลับถึงออฟฟิศ" จริง
 *  — เส้นทางบางสาย (ไปนครสวรรค์ ฯลฯ) วนผ่านใกล้ออฟฟิศ รถแค่วิ่งผ่านจะหลุดรัศมีก่อนครบเวลา ไม่นับ */
export const RETURN_DWELL_MIN = 5

/** ถ้ายังไม่เคยถึงจุดงานเลย (ขาออก/ยูเทิร์น/รถติดหน้าออฟฟิศ) ต้องจอดยาวกว่านี้ (นาที) ถึงนับว่ากลับ
 *  — กันขาออกที่อ้อยอิ่งแถวออฟฟิศ ; รถที่กลับมาจอดจริง (เช่นงานยกเลิกกลางทาง) จอดเกินนี้แน่นอน */
export const RETURN_DWELL_NO_JOB_MIN = 20

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
// จุดแวะประจำนอกจุดงาน — จับพฤติกรรมจอดที่เดิมซ้ำ ๆ ข้ามวัน (ทำรายงานให้คนขับ "เห็นข้อมูล")
// ---------------------------------------------------------------------------

export interface RecurringSpot {
  lat: number
  lng: number
  /** จำนวนวันที่มาแวะจุดนี้ */
  days: number
  /** จำนวนครั้งที่แวะ (วันเดียวแวะหลายรอบได้) */
  visits: number
  totalMin: number
  avgMin: number
  maxMin: number
  /** นาทีที่อยู่ "นอกช่วงพักเที่ยง" (12:00–13:00 เวลาไทย) — ชี้เคสพักเกิน/พักไม่ตรงเวลา */
  offLunchMin: number
  distFromOfficeKm: number
  dates: string[]
}

/** นาทีของช่วง [startT,endT] ที่อยู่นอกหน้าต่างพักเที่ยง (คิดตามเวลาไทย UTC+7, รองรับช่วงคร่อมวัน) */
export function minutesOutsideLunch(startT: number, endT: number, lunchStartHour = 12, lunchEndHour = 13): number {
  if (endT <= startT) return 0
  const totalMin = (endT - startT) / 60000
  const dayMs = 24 * 3600 * 1000
  const tzOff = 7 * 3600 * 1000
  let lunchOverlapMs = 0
  let dayStart = Math.floor((startT + tzOff) / dayMs) * dayMs - tzOff // เที่ยงคืนไทยของวันแรกที่เกี่ยว
  for (; dayStart < endT; dayStart += dayMs) {
    const ls = dayStart + lunchStartHour * 3600 * 1000
    const le = dayStart + lunchEndHour * 3600 * 1000
    const overlap = Math.min(endT, le) - Math.max(startT, ls)
    if (overlap > 0) lunchOverlapMs += overlap
  }
  return Math.max(0, totalMin - lunchOverlapMs / 60000)
}

/**
 * รวมจุดจอด "นอกจุดงาน" ของหลายวัน แล้วจับกลุ่มตำแหน่งเดิมซ้ำ ๆ (รัศมี clusterRadiusM)
 * คืนเฉพาะจุดที่แวะ ≥ minDays วัน เรียงตามเวลารวมมาก → น้อย
 * (events ต้องถูกกรอง "จอดที่จุดงาน/ออฟฟิศ" ออกมาก่อน — ฟังก์ชันนี้ cluster อย่างเดียว)
 */
export function computeRecurringStops(
  daily: { date: string; events: StopEvent[] }[],
  office: LatLng,
  opts: { clusterRadiusM?: number; minDays?: number } = {}
): RecurringSpot[] {
  const radius = opts.clusterRadiusM ?? 150
  const minDays = opts.minDays ?? 3
  interface Acc { lat: number; lng: number; n: number; visits: { date: string; startT: number; endT: number; durationMin: number }[] }
  const spots: Acc[] = []
  for (const d of daily) {
    for (const ev of d.events) {
      let s = spots.find((x) => haversineMeters(x, ev) <= radius)
      if (!s) {
        s = { lat: ev.lat, lng: ev.lng, n: 0, visits: [] }
        spots.push(s)
      }
      // running centroid — ให้ตำแหน่งกลุ่มนิ่ง ไม่เพี้ยนตาม GPS แกว่ง
      s.lat = (s.lat * s.n + ev.lat) / (s.n + 1)
      s.lng = (s.lng * s.n + ev.lng) / (s.n + 1)
      s.n++
      s.visits.push({ date: d.date, startT: ev.startT, endT: ev.endT, durationMin: ev.durationMin })
    }
  }
  return spots
    .map((s) => {
      const dates = Array.from(new Set(s.visits.map((v) => v.date))).sort()
      const totalMin = s.visits.reduce((t, v) => t + v.durationMin, 0)
      const offLunchMin = s.visits.reduce((t, v) => t + minutesOutsideLunch(v.startT, v.endT), 0)
      return {
        lat: s.lat,
        lng: s.lng,
        days: dates.length,
        visits: s.visits.length,
        totalMin: Math.round(totalMin),
        avgMin: Math.round(totalMin / Math.max(1, s.visits.length)),
        maxMin: Math.round(Math.max(...s.visits.map((v) => v.durationMin))),
        offLunchMin: Math.round(offLunchMin),
        distFromOfficeKm: Math.round(haversineMeters(office, s) / 100) / 10,
        dates,
      }
    })
    .filter((s) => s.days >= minDays)
    .sort((a, b) => b.totalMin - a.totalMin)
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
  /** ระยะทางขานี้ (กม.) วัดจาก trail ช่วง (ออกจุดก่อน → ถึงจุดนี้) — null ถ้าคำนวณไม่ได้ */
  travelKmFromPrev: number | null
  /** ความเร็วเฉลี่ยขานี้ (กม./ชม.) = travelKm ÷ travelMin — null ถ้าคำนวณไม่ได้ (ต่ำผิดปกติ = ถ่วงเวลา) */
  avgSpeedKmh: number | null
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
 * - departed/returnedOffice: ออก = จุดแรกที่พ้นรัศมีออฟฟิศ, กลับ = การกลับ "ครั้งล่าสุด" ที่ไม่มี
 *   การออกไปจริงตามหลัง (รองรับกลับมาพักแล้วออกอีกรอบ) โดยต้องอยู่ในรัศมีต่อเนื่องครบเวลา:
 *   เคยถึงจุดงานแล้ว ≥ RETURN_DWELL_MIN นาที / ยังไม่เคยถึงจุดงาน ≥ RETURN_DWELL_NO_JOB_MIN นาที
 *   (วิ่งผ่าน/ยูเทิร์นใกล้ออฟฟิศ ไม่นับ)
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
  // นับ "กลับ" ได้ต่อเมื่อรถ "ออกไปจริง" แล้วเท่านั้น — เคยห่างออฟฟิศเกิน DEPARTED_FAR_M
  // หรือเคยเข้าใกล้จุดงาน (เผื่องานใกล้ออฟฟิศ) — กัน GPS เด้งรอบรัศมีตอนเพิ่งออกตัว
  // ถูกนับเป็นกลับผิด ๆ (เวลาภารกิจเหลือ ~1 นาที ทั้งที่รถยังวิ่งอยู่)
  const jobStops = stops.filter((s) => s.lat != null && s.lng != null) as { lat: number; lng: number }[]
  const atAnyJob = (p: TrailPoint) =>
    jobStops.some((s) => haversineMeters({ lat: s.lat, lng: s.lng }, p) <= arrivalRadius)

  // state machine เดินทั้งวัน (รองรับออกหลายรอบ: งานเช้า → กลับพัก → ออกงานบ่าย → กลับจริง)
  // "กลับ" = การกลับครั้งล่าสุดที่ไม่มีการออกไปจริงตามหลัง — ถ้าออกไปอีกรอบ การกลับเดิมถูกยกเลิก
  // (คำนวณใหม่จาก trail ทั้งเส้นทุกรอบ sync จึง self-correct ระหว่างวัน)
  let departedOfficeAt: number | null = null
  let returnedOfficeAt: number | null = null
  if (origin && pts.length) {
    let leftForReal = false // รอบปัจจุบัน "ออกไปจริง" แล้ว (ไกลพอ/ถึงจุดงาน) — ค่อยเริ่มจับการกลับ
    let everAtJob = false // เคยถึงจุดงานอย่างน้อย 1 จุด (ทั้งวัน) — ใช้เลือกความเข้มงวดของ dwell
    let officeEnterAt: number | null = null // เวลาเข้ารัศมีครั้งล่าสุด (รอยืนยันว่า "อยู่จริง")
    for (const p of pts) {
      const distFromOffice = haversineMeters(origin, p)
      const inOffice = distFromOffice <= officeRadius
      const atJob = atAnyJob(p)
      if (atJob) everAtJob = true

      if (departedOfficeAt == null) {
        if (!inOffice) departedOfficeAt = p.t! // ออกจากออฟฟิศครั้งแรกของวัน
        continue
      }

      if (returnedOfficeAt != null) {
        // นับกลับไว้แล้ว — ถ้าออกไปจริงอีกรอบ (ไกล/ถึงจุดงาน) = วันยังไม่จบ ยกเลิกการกลับเดิม
        // (GPS เด้งรอบออฟฟิศตอนจอดไม่เกิน 1 กม. จะไม่หลุดเงื่อนไขนี้)
        if (distFromOffice > DEPARTED_FAR_M || atJob) {
          returnedOfficeAt = null
          officeEnterAt = null
          leftForReal = true
        }
        continue
      }

      if (distFromOffice > DEPARTED_FAR_M || atJob) leftForReal = true
      if (!leftForReal) continue
      // นับ "กลับ" เมื่อเข้ารัศมีแล้ว "อยู่จริง" ต่อเนื่องครบเวลา — วิ่งผ่าน/ยูเทิร์นหลุดรัศมีก่อนครบ ไม่นับ
      // ยังไม่เคยถึงจุดงานเลย (ขาออกอ้อยอิ่งแถวออฟฟิศ) → ใช้เกณฑ์ยาวพิเศษ กันนับผิด
      if (inOffice) {
        if (officeEnterAt == null) officeEnterAt = p.t!
        const needMin = everAtJob ? RETURN_DWELL_MIN : RETURN_DWELL_NO_JOB_MIN
        if (p.t! - officeEnterAt >= needMin * 60_000) {
          returnedOfficeAt = officeEnterAt // เวลาที่ "ถึง" จริง = จุดแรกของช่วงที่อยู่ยาว
          leftForReal = false // เริ่มรอบใหม่ ถ้าออกไปอีก
        }
      } else {
        officeEnterAt = null // หลุดรัศมีก่อนครบเวลา = วิ่งผ่านเฉย ๆ
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
    return { order: s.order, siteName: s.siteName ?? "", arrivedAt, departedAt, dwellMin, travelMinFromPrev: null, travelKmFromPrev: null, avgSpeedKmh: null }
  })

  // ---- เวลาเดินทางช่วง (ถึงจุดนี้ − ออกจุดก่อน / ออกออฟฟิศ) ----
  // คิดตาม "ลำดับที่ถึงจริง" ไม่ใช่ลำดับแผน — คนขับวิ่งสลับจุดได้ ถ้าคิดตามแผน
  // ขาเดินทางจะเพี้ยน (นับเวลาแวะจุดอื่นรวม / ขาที่ติดลบหายไป)
  const seq = [...timings].sort((a, b) => {
    if (a.arrivedAt != null && b.arrivedAt != null) return a.arrivedAt - b.arrivedAt
    if (a.arrivedAt != null) return -1
    if (b.arrivedAt != null) return 1
    return a.order - b.order // จุดที่ยังไม่ถึง คงลำดับแผนไว้ท้ายรายการ
  })
  let prevDepart: number | null = departedOfficeAt
  for (const t of seq) {
    if (t.arrivedAt != null && prevDepart != null && t.arrivedAt > prevDepart) {
      const legMs = t.arrivedAt - prevDepart
      t.travelMinFromPrev = toMin(legMs)
      // ระยะทางขานี้ = trail ช่วง (ออกจุดก่อน → ถึงจุดนี้) + ความเร็วเฉลี่ย
      const legPts = pts.filter((p) => p.t! >= prevDepart! && p.t! <= t.arrivedAt!)
      const km = Math.round(trailDistanceKm(legPts) * 10) / 10
      t.travelKmFromPrev = km
      const hours = legMs / 3_600_000
      t.avgSpeedKmh = hours > 0 ? Math.round(km / hours) : null
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
