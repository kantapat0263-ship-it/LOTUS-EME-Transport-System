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

/** จุดงานที่ห่างออฟฟิศไม่เกินนี้ (เมตร) ต้อง "จอดจริง" ถึงจะนับว่าถึง — งานแถวออฟฟิศ (โรงเก็บของ/ตรอ./ร้านของเก่า)
 *  อยู่บนเส้นทางวิ่งปกติ ขับผ่านใกล้ ๆ ง่าย · งานในเมืองจุดห่างกัน เข้าใกล้ = ไปจุดนั้นจริง (ผู้ใช้ยืนยัน 2026-10-06) */
export const NEAR_OFFICE_M = 5000
/** จุดงานใกล้ออฟฟิศ: ต้องอยู่ในรัศมีจุดงานต่อเนื่องอย่างน้อยกี่นาที */
export const NEAR_OFFICE_ARRIVAL_DWELL_MIN = 5

/** เวลาจอดขั้นต่ำ (นาที) ที่จุดงานนี้ต้องมีถึงจะนับว่า "ถึง" — 0 = เข้าใกล้จุดเดียวก็นับ (กติกาเดิม) */
export function arrivalDwellMin(stop: LatLng, office: LatLng | null | undefined): number {
  return office && haversineMeters(stop, office) <= NEAR_OFFICE_M ? NEAR_OFFICE_ARRIVAL_DWELL_MIN : 0
}

/** รอบที่อยู่ในรัศมีจุดงานสั้นกว่านี้ (นาที) = ขับผ่าน — ไม่นับเป็นเวลาจอดใน timeline */
export const STAY_MIN = 2

type Visit = { start: number; end: number }

/**
 * ทุกช่วงที่รถอยู่ในรัศมีจุดงาน — ช่วงจุด trail ต่อเนื่อง (เรียงตามเวลา) ที่อยู่ในรัศมีทุกจุด
 * จุดที่หลุดออกนอกรัศมีตัดช่วง · GPS ขาดช่วงแต่จุดก่อน-หลังอยู่ในรัศมีทั้งคู่ = ถือว่าอยู่ต่อเนื่อง
 * (trail ข้ามจุดที่เวลา GPS ซ้ำ → ช่องว่างเกิดตอนอุปกรณ์ไม่รายงาน ซึ่งส่วนใหญ่คือจอดนิ่ง ถ้าตัดช่องว่าง
 *  รถที่จอดนานจะไม่เคยถูกนับว่าถึง) · ใช้เฉพาะจุดที่มีเวลา (t)
 */
function stopVisits(stop: LatLng, trail: TrailPoint[], radius: number): Visit[] {
  const pts = trail.filter((p) => p.t != null).sort((a, b) => a.t! - b.t!)
  const visits: Visit[] = []
  let cur: Visit | null = null
  for (const p of pts) {
    if (haversineMeters(stop, p) <= radius) {
      if (cur) cur.end = p.t!
      else cur = { start: p.t!, end: p.t! }
    } else if (cur) {
      visits.push(cur)
      cur = null
    }
  }
  if (cur) visits.push(cur)
  return visits
}

/** รอบแรกที่ "ถึงจุดงานจริง" = ช่วงแรกที่อยู่ในรัศมีนานรวม ≥ minDwellMin · 0 = จุดเดียวก็นับ */
export function firstArrivalVisit(stop: LatLng, trail: TrailPoint[], radius: number, minDwellMin: number): Visit | null {
  return stopVisits(stop, trail, radius).find((v) => v.end - v.start >= minDwellMin * 60_000) ?? null
}

/**
 * เวลาถึง/ออก/จอดของจุดงาน — ถึง = เริ่มรอบแรกที่ผ่านเกณฑ์ (needMin) · ออก = จบรอบจอดสุดท้าย ·
 * จอด = รวมทุกรอบจอด (รอบแรก + รอบหลังที่นาน ≥ STAY_MIN) — รอบสั้นกว่านั้นคือขับผ่าน ไม่นับ
 * (เคสจริง: จอด 5 นาที ออกไป แล้วกลับมาจอดอีก 30 นาที → จอดรวม 35 · เวลาเดินทางไปจุดถัดไปนับจากออกรอบหลัง)
 * until = นับเฉพาะรอบจอดที่เริ่มก่อนเวลานี้ (เวลาถึงจุดงานถัดไป) — กัน A→B→A: รอบ A หลังถึง B ไม่ถูกนับให้ A
 */
export function stopTiming(
  stop: LatLng,
  trail: TrailPoint[],
  radius: number,
  needMin: number,
  until = Number.POSITIVE_INFINITY
): { arrivedAt: number; departedAt: number; dwellMin: number | null } | null {
  const visits = stopVisits(stop, trail, radius)
  const i = visits.findIndex((v) => v.end - v.start >= needMin * 60_000)
  if (i < 0) return null
  const stays = visits
    .slice(i)
    .filter((v, k) => k === 0 || (v.end - v.start >= STAY_MIN * 60_000 && v.start < until))
  const dwellMs = stays.reduce((s, v) => s + (v.end - v.start), 0)
  return {
    arrivedAt: stays[0].start,
    departedAt: stays[stays.length - 1].end,
    dwellMin: dwellMs > 0 ? Math.round((dwellMs / 60_000) * 10) / 10 : null, // ทศนิยม 1 ตำแหน่ง เหมือน toMin
  }
}

/** รถอยู่ในรัศมีจุดงานที่ต้องจอดยืนยัน (จุดใกล้ออฟฟิศ) — ใช้บอกว่า "อยู่บริเวณจุดงาน รอยืนยันจอดครบ" แทน "กำลังไป" */
export function isAwaitingDwell(stop: LatLng, pos: LatLng, office: LatLng | null | undefined, radius = ARRIVAL_RADIUS_M): boolean {
  return arrivalDwellMin(stop, office) > 0 && haversineMeters(stop, pos) <= radius
}

export interface StopStatus {
  order: number
  /** ถึงจุดงานแล้ว = ทำภารกิจแล้ว (จุดไกลออฟฟิศ: เข้าใกล้ในรัศมี · จุดใกล้ออฟฟิศ: จอดในรัศมี ≥ NEAR_OFFICE_ARRIVAL_DWELL_MIN) */
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
 * - arrived = จุดไกลออฟฟิศ: มีจุดใน trail เข้าใกล้จุดงานภายใน radius
 *             จุดใกล้ออฟฟิศ (ส่ง office มา): ต้องจอดในรัศมีต่อเนื่อง ≥ NEAR_OFFICE_ARRIVAL_DWELL_MIN (กันขับผ่าน)
 * - isCurrent = จุดแรก (ตามลำดับ order) ที่ยังไม่ arrived
 * - arrivedAt = เวลาเริ่มของรอบที่ถึงจริงรอบแรก (ถ้ามี t)
 */
export function computeStopStatuses(
  stops: { order: number; lat?: number; lng?: number }[],
  trail: TrailPoint[],
  opts: { radius?: number; office?: LatLng | null } = {}
): StopStatus[] {
  const radius = opts.radius ?? ARRIVAL_RADIUS_M
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
      }
      const needMin = arrivalDwellMin(stopPos, opts.office)
      if (needMin === 0) {
        // กติกาเดิม: เข้าใกล้จุดเดียวก็นับ (รองรับ trail ที่ไม่มีเวลา) · เวลาถึง = เวลาเร็วที่สุดในรัศมี (ไม่ขึ้นกับลำดับ array)
        for (const p of trail) {
          if (haversineMeters(stopPos, p) <= radius) {
            arrived = true
            if (p.t != null && (arrivedAt == null || p.t < arrivedAt)) arrivedAt = p.t
          }
        }
      } else {
        const visit = firstArrivalVisit(stopPos, trail, radius, needMin)
        arrived = visit != null
        arrivedAt = visit?.start ?? null
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
 * รถคันนี้ "ไม่ได้ออกวิ่ง" วันนี้ = ทุกจุดมีผลที่ไม่ใช่ตามแผน (โยก/เลื่อน/ปฏิเสธ) และไม่มีงานโยกเข้า
 * — เกณฑ์เดียวกับป้าย "🚫 ไม่ได้วิ่ง" ในใบสรุป (notRun ใน daily-summary) → หน้าติดตามรถไม่ต้องโชว์คันนี้
 * ยกเลิกการเลื่อน/โยก (ผลกลับเป็นตามแผน) = การ์ดกลับมาเอง เพราะคิดสดจาก trip.stops
 */
export function isTripNotRun(stops: { outcome?: string }[], incomingCount: number): boolean {
  if (incomingCount > 0) return false
  // ทริปเปล่า (ไม่มีงานตัวเอง ไม่มีงานโยกเข้า — เช่น สร้างทริปรับโยกแล้วเปลี่ยนใจ) = ไม่ได้วิ่ง
  if (stops.length === 0) return true
  return stops.every((s) => !!s.outcome && s.outcome !== 'delivered')
}

/** วันทำการของระบบติดตามรถเริ่ม 04:00 เวลาไทย (ตรงกับเวลาที่ cron เริ่มดึงตำแหน่ง)
 *  เลื่อนจาก 05:00 เมื่อ 2026-10-06 — คนขับออกก่อนตี 5 บ่อยขึ้น จุดช่วงออกรถหาย */
export const TRACKING_DAY_START_HOUR = 4

/**
 * คีย์วันที่สำหรับ trail/สรุปรายวัน (YYYY-MM-DD) — ใช้ตรงกันทั้งฝั่ง sync (เขียน) และหน้าเมนู (อ่าน)
 * = วันที่ไทย (UTC+7) แต่ตัดวันตอน 04:00 ให้ตรงกับ Trip.tripDate (วันที่ไทยที่ผู้ใช้เลือก)
 *   - 00:00–03:59 ยังนับเป็นวันก่อน → รถที่กลับดึกอยู่กับทริปของวันนั้น
 *   - เดิมใช้วันที่ UTC = วันเริ่ม 07:00 ไทย → จุด 05:00–06:59 ตกไปวันก่อน (ลบเวลากลับของเมื่อวาน / วันใหม่ขึ้น "ค้างคืน" ผิด)
 *   หมายเหตุ: doc ย้อนหลังก่อน 2026-10-01 ตัดแบบ UTC, 2026-10-01 ถึงวันขึ้นระบบรอบนี้ตัด 05:00
 */
export function trackingDateKey(nowMs = Date.now()): string {
  return new Date(nowMs + (7 - TRACKING_DAY_START_HOUR) * 3600_000).toISOString().slice(0, 10)
}

/** "HH:MM" เวลาไทยของวันติดตาม dateKey → epoch ms — ก่อนเวลาตัดวัน (ตี 4) = วันถัดไปตามปฏิทิน · รูปแบบผิด = null */
export function thaiClockToMs(dateKey: string, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  const [y, mo, d] = dateKey.split("-").map(Number)
  const dayOffset = h < TRACKING_DAY_START_HOUR ? 1 : 0
  return Date.UTC(y, mo - 1, d + dayOffset, h, mi) - 7 * 3600_000
}

/** epoch ms → "HH:MM" เวลาไทย */
export function msToThaiClock(ms: number): string {
  const d = new Date(ms + 7 * 3600_000)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

/** เดือนย่อภาษาไทย (ใช้บอกวันที่ของเวลาที่อยู่คนละวันกับหน้าที่กำลังดู) */
const TH_MONTH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

/** "HH:MM" เวลาไทย + "(6 ต.ค.)" เมื่อเวลานั้นเป็นคนละวัน (ปฏิทินไทย) กับวันที่กำลังดู — ทริปข้ามคืน/ขากลับที่เริ่มเมื่อวาน */
export function clockWithDay(ms: number, viewDate: string): string {
  const d = new Date(ms + 7 * 3600_000)
  const clock = msToThaiClock(ms)
  if (d.toISOString().slice(0, 10) === viewDate) return clock
  return `${clock} (${d.getUTCDate()} ${TH_MONTH_SHORT[d.getUTCMonth()]})`
}

/** รัศมี "พื้นที่ไซต์" ของทริปกลับอย่างเดียว — ใช้หาจังหวะรถออกจากไซต์ (กว้างกว่าเกณฑ์ถึงจุดงาน เพราะหมุดไซต์กับลานจอดจริงห่างกันได้) */
export const RETURN_SITE_AREA_M = 2000
/** รถต้อง "หยุดนิ่ง" ในพื้นที่ไซต์อย่างน้อยเท่านี้ ถึงจะนับเป็นขารับรถ — ขับผ่าน/ติดไฟแดงใกล้ไซต์ไม่นับ
 *  10 นาที (เดิม 30): เคสจริง ถส-5694 ไปถึงจุดเปลี่ยนรถ 19:13 ออก 19:40 = 27 นาที — รถมาถึงแล้วเปลี่ยนคนขับเลย ไม่ได้จอดรอนาน */
export const RETURN_SITE_MIN_STAY_MIN = 10
/** GPS เงียบนานเท่านี้แล้วไปโผล่ไกล (นอกรัศมี 300 ม.) ถึงเชื่อว่าช่วงเงียบคือรถจอด — สั้นกว่านี้อาจแค่ระบบดึง GPS ไม่ได้ช่วงที่ขับผ่าน
 *  ใช้ทั้งหลักฐานจอดรอและเวลาออกจากไซต์ (แยกจาก RETURN_SITE_MIN_STAY_MIN ที่ใช้กับจุดที่อยู่ติดกันในที่เดิม) */
const RETURN_SITE_SILENT_GAP_MIN = 30

/** รัศมีพื้นที่ไซต์รับรถจริงที่ใช้ — กว้างสุด RETURN_SITE_AREA_M แต่ห้ามครอบออฟฟิศ
 *  (ไซต์ใกล้ออฟฟิศ เช่น อู่ 1 กม. → หดลง เหลือไม่ต่ำกว่าเกณฑ์ถึงจุดงาน 300 ม.) ใช้ชุดเดียวทั้งหน้าติดตามและรายงาน */
export function pickupAreaRadiusM(site: LatLng, office: LatLng | null | undefined): number {
  if (!office) return RETURN_SITE_AREA_M
  const room = haversineMeters(site, office) - OFFICE_RADIUS_M - 200
  return Math.max(ARRIVAL_RADIUS_M, Math.min(RETURN_SITE_AREA_M, room))
}

/** หลักฐานว่ารถ "หยุดนิ่ง" จริงในช่วงจุดที่ให้มา (ไม่ใช่แค่อยู่ในรัศมีนาน — รถคลานช้าในพื้นที่ไม่นับ)
 *  - กลุ่มจุดห่างจุดตั้งต้นไม่เกินระยะแกว่งของ GPS (300 ม.) ต่อเนื่อง ≥ minStayMs หรือ
 *  - GPS เงียบ ≥ silentGapMs หลังจุดใดจุดหนึ่งแล้วไปโผล่ไกล (เครื่องไม่ส่งตำแหน่งตอนรถจอดดับ — trail ข้ามเวลาซ้ำ)
 *    ช่วงเงียบที่จุดก่อน-หลังอยู่ในรัศมีเดิม นับด้วยเกณฑ์กลุ่มจุด (minStayMs) อยู่แล้ว
 *  next = จุดแรกหลังช่วงนี้ (ถ้ามี) ใช้วัดเวลาเงียบของจุดสุดท้าย */
function hasStationaryStay<T extends TrailPoint>(pts: T[], next: T | undefined, minStayMs: number, silentGapMs: number): boolean {
  const seq = next ? [...pts, next] : pts
  let anchor = 0
  for (let j = 1; j < seq.length; j++) {
    if (seq[j].t! - seq[j - 1].t! >= silentGapMs) return true
    if (haversineMeters(seq[anchor], seq[j]) <= ARRIVAL_RADIUS_M) {
      if (seq[j].t! - seq[anchor].t! >= minStayMs) return true
    } else anchor = j
  }
  return false
}

/** เวลาเริ่มของรอบ "จอดจริง" ในออฟฟิศครั้งแรก (≥ minMs นับถึงจุดถัดไปหลังรอบ — ขับผ่านจุดเดียวไม่นับ) · ไม่มี = null */
function firstOfficeStayStart<T extends TrailPoint>(pts: T[], office: LatLng, radiusM: number, minMs: number): number | null {
  for (let i = 0; i < pts.length; i++) {
    if (haversineMeters(office, pts[i]) > radiusM) continue
    let j = i
    while (j + 1 < pts.length && haversineMeters(office, pts[j + 1]) <= radiusM) j++
    const endT = j + 1 < pts.length ? pts[j + 1].t! : pts[j].t!
    if (endT - pts[i].t! >= minMs) return pts[i].t!
    i = j
  }
  return null
}

/**
 * ทริปกลับอย่างเดียว (ไปรับรถที่ไซต์ขับกลับ): คนขับอาจออกจากไซต์ตั้งแต่เย็นวันก่อนแล้วขับข้ามคืน
 * → ต่อ GPS ของวันก่อน ตั้งแต่จุดสุดท้ายที่รถยังอยู่ในพื้นที่ไซต์ เข้ากับ GPS วันนี้ (ทริปลงวันที่วันที่รถถึงออฟฟิศ)
 * - วันนี้ยังมีจุดในพื้นที่ไซต์ (ออกจากไซต์วันนี้) / วันก่อนไม่เคยอยู่ไซต์ / ไม่มีพิกัดไซต์ = ใช้ GPS วันนี้ตามเดิม
 * - ต่อเฉพาะเมื่อวันก่อน "จอดรอ" ที่ไซต์จริง (หยุดนิ่ง ≥ RETURN_SITE_MIN_STAY_MIN — hasStationaryStay)
 *   และหลังออกจากไซต์ไม่ได้ "จอดจริง" ที่ออฟฟิศก่อนวันของทริป (tripDayStart = 00:00 ไทยของวันที่ทริป)
 *   (ขับผ่าน/คลานผ่านใกล้ไซต์ หรือรับรถแล้วกลับถึงออฟฟิศไปตั้งแต่วันก่อน = ไม่ใช่ขากลับของทริปนี้
 *    — ถึงออฟฟิศหลังเที่ยงคืนของวันทริปแต่ก่อนตัดวันตี 4 ยังนับเป็นขากลับของทริปนี้)
 * - ตัด GPS ตาม gpsEndAt ก่อนเรียกฟังก์ชันนี้ (เวลาออกไซต์ต้องมาจาก GPS ที่ยังเป็นของทริป)
 * - siteDepartAt = จุดสุดท้ายในพื้นที่ไซต์ที่ตามด้วยจุดนอกพื้นที่ · GPS เงียบ ≥ minStay ก่อนจุดนอกพื้นที่ = ใช้เวลาจุดนอกพื้นที่
 *   (รถจอดเงียบจนออก — เวลาเริ่มจอดไม่ใช่เวลาออก) · จุดล่าสุดยังอยู่ไซต์ (วนกลับมาจอด/ยังไม่ออก) = null
 * - seenAtSite = มีจุดในพื้นที่ไซต์ (ถือว่ารับรถที่ไซต์แล้ว — จุดไซต์ของทริปนี้คือจุดเริ่ม ไม่ใช่ปลายทาง)
 */
export function returnTripTrail<T extends TrailPoint>(
  prev: T[],
  today: T[],
  site: LatLng | null | undefined,
  opts: { radiusM?: number; office?: LatLng | null; officeRadiusM?: number; minStayMin?: number; tripDayStart?: number } = {}
): { trail: T[]; prepended: boolean; siteDepartAt: number | null; seenAtSite: boolean } {
  if (!site) return { trail: today, prepended: false, siteDepartAt: null, seenAtSite: false }
  const radiusM = opts.radiusM ?? RETURN_SITE_AREA_M
  const minStayMs = (opts.minStayMin ?? RETURN_SITE_MIN_STAY_MIN) * 60_000
  const silentGapMs = Math.max(minStayMs, RETURN_SITE_SILENT_GAP_MIN * 60_000)
  const office = opts.office
  const officeRadiusM = opts.officeRadiusM ?? OFFICE_RADIUS_M
  const inSite = (p: T) => haversineMeters(site, p) <= radiusM
  const sorted = (pts: T[]) => pts.filter((p) => p.t != null).sort((a, b) => a.t! - b.t!)
  const tod = sorted(today)
  let all = tod
  let prepended = false
  if (!tod.some(inSite)) {
    const pr = sorted(prev)
    let last = -1
    for (let i = pr.length - 1; i >= 0; i--) {
      if (inSite(pr[i])) {
        last = i
        break
      }
    }
    if (last >= 0) {
      let first = last
      while (first > 0 && inSite(pr[first - 1])) first--
      const stayed = hasStationaryStay(pr.slice(first, last + 1), pr[last + 1] ?? tod[0], minStayMs, silentGapMs)
      const officeStay = office
        ? firstOfficeStayStart([...pr.slice(last + 1), ...tod], office, officeRadiusM, RETURN_DWELL_MIN * 60_000)
        : null
      const returnedBeforeTripDay = officeStay != null && officeStay < (opts.tripDayStart ?? Infinity)
      if (stayed && !returnedBeforeTripDay) {
        all = [...pr.slice(last), ...tod]
        prepended = true
      }
    }
  }
  let siteDepartAt: number | null = null
  const lastPt = all[all.length - 1]
  if (lastPt && !inSite(lastPt)) {
    for (let i = all.length - 2; i >= 0; i--) {
      if (inSite(all[i]) && !inSite(all[i + 1])) {
        siteDepartAt = all[i + 1].t! - all[i].t! >= silentGapMs ? all[i + 1].t! : all[i].t!
        break
      }
    }
  }
  return { trail: prepended ? all : today, prepended, siteDepartAt, seenAtSite: all.some(inSite) }
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
  /** นาทีที่อยู่ "นอกช่วงพักเที่ยง" (12:30–13:30 เวลาไทย) — ชี้เคสพักเกิน/พักไม่ตรงเวลา */
  offLunchMin: number
  distFromOfficeKm: number
  dates: string[]
}

/** นาทีของช่วง [startT,endT] ที่อยู่นอกหน้าต่างพักเที่ยง (เวลาไทย UTC+7, รองรับช่วงคร่อมวัน)
 *  พักเที่ยงบริษัท = 12:30–13:30 ; รับเป็นชั่วโมงทศนิยมได้ (12.5 = 12:30) */
export function minutesOutsideLunch(startT: number, endT: number, lunchStartHour = 12.5, lunchEndHour = 13.5): number {
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
  /** ออกจากออฟฟิศเมื่อ (unix ms) — null ถ้ายังไม่ออก/ไม่มีพิกัดออฟฟิศ
   *  วันที่รถตื่นนอกออฟฟิศแล้วไม่แวะออฟฟิศก่อนเริ่มงาน = เวลาที่ออกจากจุดค้างคืน */
  departedOfficeAt: number | null
  /** กลับถึงออฟฟิศเมื่อ (unix ms) — null ถ้ายังไม่กลับ */
  returnedOfficeAt: number | null
  /** จุดแรกของวันอยู่นอกรัศมีออฟฟิศ = รถค้างคืนข้างนอก */
  startedAwayFromOffice: boolean
  /** เวลาที่เอารถเข้าออฟฟิศครั้งแรก (ขา "มาคืนรถ") — เฉพาะวันตื่นนอกพื้นที่ที่เข้าออฟฟิศก่อนแตะงานใด */
  vehicleReturnedAt: number | null
  /** จุดสุดท้ายของวันอยู่นอกรัศมีออฟฟิศ — วันที่จบไปแล้ว = ค้างคืนนอกพื้นที่ */
  endedAwayFromOffice: boolean
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
  let vehicleReturnedAt: number | null = null
  let startedAwayFromOffice = false
  let endedAwayFromOffice = false
  if (origin && pts.length) {
    startedAwayFromOffice = haversineMeters(origin, pts[0]) > officeRadius
    endedAwayFromOffice = haversineMeters(origin, pts[pts.length - 1]) > officeRadius

    let startIdx = 0 // จุดที่เริ่มเดิน state machine (วันปกติ = ตั้งแต่ต้น trail)
    let leftForReal = false // รอบปัจจุบัน "ออกไปจริง" แล้ว (ไกลพอ/ถึงจุดงาน) — ค่อยเริ่มจับการกลับ
    let everAtJob = false // เคยถึงจุดงานอย่างน้อย 1 จุด (ทั้งวัน) — ใช้เลือกความเข้มงวดของ dwell

    if (startedAwayFromOffice) {
      // รถตื่นนอกออฟฟิศ (ค้างคืนข้างนอก เช่น เอารถกลับบ้านหลังงานไกล) — จุดแรกของวัน
      // ไม่ใช่ "ออกจากออฟฟิศ" ห้ามนับเป็นเวลาออกงาน (บั๊กเดิม: บันทึกออก 6 โมงตอนขับมาคืนรถ)
      // หาการเข้าออฟฟิศครั้งแรกที่ "อยู่จริง" (ต่อเนื่อง ≥ RETURN_DWELL_MIN — ขับผ่านเฉย ๆ ไม่นับ)
      let enterIdx: number | null = null
      let officeIdx: number | null = null
      for (let i = 0; i < pts.length; i++) {
        if (haversineMeters(origin, pts[i]) <= officeRadius) {
          if (enterIdx == null) enterIdx = i
          if (pts[i].t! - pts[enterIdx].t! >= RETURN_DWELL_MIN * 60_000) {
            officeIdx = enterIdx
            break
          }
        } else enterIdx = null
      }
      const jobBeforeOffice = pts.slice(0, officeIdx ?? pts.length).some(atAnyJob)
      if (officeIdx != null && !jobBeforeOffice) {
        // เข้าออฟฟิศโดยยังไม่แตะงานใด = ขา "เอารถมาคืน" — วันทำงานจริงเริ่มนับจากออฟฟิศจุดนี้
        vehicleReturnedAt = pts[officeIdx].t!
        startIdx = officeIdx
      } else {
        // ไม่เข้าออฟฟิศเลย (หรือถึงงานก่อนเข้า) = ทำงานต่อจากจุดค้างคืน
        // → นับเวลาที่ออกจากจุดค้างคืนเป็นการเริ่มงาน (ยังไม่ขยับ = ยังไม่เริ่ม)
        const startPos = pts[0]
        const left = pts.find((p) => haversineMeters(startPos, p) > officeRadius)
        if (left) {
          departedOfficeAt = left.t!
          leftForReal = true
          everAtJob = jobBeforeOffice
        }
      }
    }

    let officeEnterAt: number | null = null // เวลาเข้ารัศมีครั้งล่าสุด (รอยืนยันว่า "อยู่จริง")
    for (const p of pts.slice(startIdx)) {
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
  // ถึง = รอบแรกที่ผ่านเกณฑ์ · ออก = จบรอบจอดสุดท้าย · จอด = รวมทุกรอบจอด (stopTiming) — เดิมเอาจุดแรก/สุดท้าย
  // ที่เคยเข้ารัศมีทั้งวัน ทำให้ขับผ่านจุดเดิมตอนเช้า+บ่าย กลายเป็น "จอด" หลายชั่วโมง · จุดใกล้ออฟฟิศต้องจอด ≥ 5 นาทีถึงจะนับ
  const ordered = [...stops].sort((a, b) => a.order - b.order)
  const timingOf = (s: { lat?: number; lng?: number }, until?: number) =>
    s.lat != null && s.lng != null
      ? stopTiming({ lat: s.lat, lng: s.lng }, pts, arrivalRadius, arrivalDwellMin({ lat: s.lat, lng: s.lng }, origin), until)
      : null
  // รอบจอดหลังถึงจุดงานถัดไปไม่นับให้จุดนี้ (A→B→A) — ไม่งั้นเวลาออก A เลยเวลาถึง B แล้วขาไป B หาย
  const firstArrivals = ordered.map((s) => timingOf(s)?.arrivedAt ?? null)
  const timings: StopTiming[] = ordered.map((s, idx) => {
    const a = firstArrivals[idx]
    const until =
      a == null ? undefined : Math.min(...firstArrivals.filter((x): x is number => x != null && x > a), Number.POSITIVE_INFINITY)
    const timing = timingOf(s, until)
    return {
      order: s.order,
      siteName: s.siteName ?? "",
      arrivedAt: timing?.arrivedAt ?? null,
      departedAt: timing?.departedAt ?? null,
      dwellMin: timing?.dwellMin ?? null,
      travelMinFromPrev: null,
      travelKmFromPrev: null,
      avgSpeedKmh: null,
    }
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
    startedAwayFromOffice,
    vehicleReturnedAt,
    endedAwayFromOffice,
    totalKm: Math.round(trailDistanceKm(pts) * 10) / 10,
    stops: timings,
  }
}

// ---------------------------------------------------------------------------
// จบการใช้รถของทริป — รถคันเดียวถูกใช้ต่อในวันเดียวกัน (เช่น กลับออฟฟิศแล้วอีกคนเอารถไปนอนที่พัก)
// GPS ผูกกับ "รถ" ทั้งวัน แต่งานผูกกับ "ทริป" → ตัด trail ของทริปที่เวลาจบ ไม่ให้การวิ่งของคนถัดไปมานับรวม
// ---------------------------------------------------------------------------

/** trail ของทริปหลังตัดที่เวลาจบการใช้รถ — ไม่ได้ตั้ง = ทั้งหมด (คืน array เดิม) */
export function cutTrailAt<T extends TrailPoint>(trail: T[], endAt: number | null | undefined): T[] {
  if (endAt == null) return trail
  return trail.filter((p) => p.t != null && p.t <= endAt)
}

/**
 * เวลาที่ควรเสนอให้ "จบการใช้รถ" = จุดสุดท้ายในออฟฟิศของรอบที่กลับมาจอด (≥ minStayMin) ก่อนรถถูกขับออกไปอีก
 * — ตัดตรงนี้แล้วยังเห็น "กลับถึงออฟฟิศ" ครบ (มีจุดในออฟฟิศพอให้ผ่านเกณฑ์จอด) · ไม่มีการออกซ้ำหลังกลับ = null
 */
export function suggestHandoverTime(
  trail: TrailPoint[],
  office: LatLng,
  opts: { radius?: number; minStayMin?: number } = {}
): number | null {
  const radius = opts.radius ?? OFFICE_RADIUS_M
  const minMs = (opts.minStayMin ?? RETURN_DWELL_MIN) * 60_000
  const pts = trail.filter((p) => p.t != null).sort((a, b) => a.t! - b.t!)
  let best: number | null = null
  let start: number | null = null
  let end = 0
  // ต้องเคย "ออกจากออฟฟิศ" มาก่อน (รอบจอดตอนเช้าก่อนออกงานไม่ใช่การส่งต่อ)
  // นับเฉพาะการออกที่มีจุดในออฟฟิศนำหน้า — วันตื่นนอกพื้นที่ รอบเข้าออฟฟิศแรกแล้วออกงาน = ออกงาน ไม่ใช่ส่งต่อ
  let leftOnce = false
  for (const p of pts) {
    if (haversineMeters(office, p) <= radius) {
      if (start == null) start = p.t!
      end = p.t!
    } else {
      if (start != null) {
        if (leftOnce && end - start >= minMs) best = end
        leftOnce = true
      }
      start = null
    }
  }
  return best
}

/** เวลาจบการใช้รถที่จะบันทึก: ไม่ได้แก้เวลาตั้งต้น (ข้อเสนอ/ตอนนี้) = ใช้ค่านั้นเป๊ะ (มีวินาที — ปัดเป็นนาทีแล้วจะตัดจุดที่ทำให้จอดครบ 5 นาทีทิ้ง)
 *  แต่ต้องเป็นวันติดตามเดียวกับทริป (ดูย้อนหลังแล้วค่าเริ่ม "ตอนนี้" = คนละวัน → ใช้นาฬิกานั้นบนวันของทริป)
 *  แก้เอง = นับถึงสิ้นนาทีนั้น (กรอก 17:05 = รวมจุด 17:05:xx) แต่ไม่เกิน now (พิมพ์นาทีปัจจุบันไม่โดนปฏิเสธว่าเป็นอนาคต)
 *  เวลาผิดรูปแบบ = null */
export function handoverCutMs(
  dateKey: string,
  hhmm: string,
  base: number | null | undefined,
  now: number = Date.now()
): number | null {
  if (base != null && msToThaiClock(base) === hhmm && trackingDateKey(base) === dateKey) return base
  const ms = thaiClockToMs(dateKey, hhmm)
  if (ms == null) return null
  const end = ms + 59_999
  return end > now && ms <= now ? now : end
}

/** ตรวจเวลาจบการใช้รถก่อนบันทึก — อนาคต (ยังไม่เกิด) / ก่อนรถออกงาน (จะตัด GPS ทั้งทริปทิ้ง) = ไม่รับ */
export function handoverTimeError(
  ms: number,
  ctx: { departedAt: number | null | undefined; now: number }
): "future" | "before-departure" | null {
  if (ms > ctx.now) return "future"
  if (ctx.departedAt != null && ms < ctx.departedAt) return "before-departure"
  return null
}
