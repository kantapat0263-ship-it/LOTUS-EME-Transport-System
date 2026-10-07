import { ARRIVAL_RADIUS_M, cutTrailAt, detectStops, haversineMeters, isTripNotRun, LONG_DWELL_MIN, OFFICE_RADIUS_M, RETURN_SITE_AREA_M, type LatLng, type StopEvent, type TrailPoint } from '@/lib/tracking'
import { tripRouteMode } from '@/lib/routeMode'
import { incomingStopsForTrip } from '@/lib/calculations'
import type { Trip, Vehicle, VehicleTrailDoc } from '@/types/models'

export type StopKind = 'office' | 'job' | 'overnight' | 'rest' | 'lunch' | 'review'
export type DriverStop = StopEvent & { kind: StopKind; confirmedDrivingMin: number; uncertain: boolean }
export type DrivingPoint = TrailPoint & { sp?: number }
export const MAX_OBSERVED_GAP_MS = 5 * 60_000
const validLocation = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
const validPoint = (p: DrivingPoint) => validLocation(p) && Number.isFinite(p.t) && p.t! > 0
/** ช่วงกลางคืน (เวลาไทย) 22:00–05:00 — จุดจอดที่คร่อมช่วงนี้ = จอดค้างคืน/พักกลางคืน (เช่น ขับกลับจากต่างจังหวัดถึงบ้านตี 3)
 *  ไม่ใช่ "จอดนอกจุดงาน รอตรวจสอบ" และไม่นับในนาทีที่ต้องตรวจของสรุปรายสัปดาห์ */
export const NIGHT_START_HOUR = 22
export const NIGHT_END_HOUR = 5
export function overlapsNight(startT: number, endT: number): boolean {
  const DAY = 86_400_000, TH = 7 * 3_600_000
  // เริ่มจากคืนก่อนหน้าของวันที่จุดจอดเริ่ม (ช่วงกลางคืนเริ่ม 22:00 ของวันก่อน)
  for (let midnight = Math.floor((startT + TH) / DAY) * DAY - TH - DAY; midnight <= endT; midnight += DAY) {
    const nightStart = midnight + NIGHT_START_HOUR * 3_600_000
    const nightEnd = midnight + DAY + NIGHT_END_HOUR * 3_600_000
    if (startT < nightEnd && endT > nightStart) return true
  }
  return false
}
/** areas = พื้นที่งานที่กว้างกว่าเกณฑ์ 300 ม. (ไซต์รับรถของทริปกลับอย่างเดียว — ลานจอดจริงอาจห่างหมุด) จอดในนี้ = จอดที่จุดงาน */
export function classifyDriverStops(trail: DrivingPoint[], office: LatLng, jobs: LatLng[], opts: { areas?: (LatLng & { radiusM: number })[] } = {}): DriverStop[] {
  const points = [...trail].filter(validPoint).sort((a, b) => a.t! - b.t!)
  return detectStops(points, { minMinutes: LONG_DWELL_MIN }).filter(event => event.endT - event.startT >= LONG_DWELL_MIN * 60_000).map(event => {
    const day = Math.floor((event.startT + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000
    const lunch = event.startT >= day + 11.5 * 3_600_000 && event.endT <= day + 13 * 3_600_000 && event.endT - event.startT <= 60 * 60_000
    let drivingMs = 0
    for (let i = 1; i < points.length && points[i].t! <= event.startT; i++) {
      const previous = points[i - 1], next = points[i]
      const interval = next.t! - previous.t!
      const speed = haversineMeters(previous, next) / interval * 3600
      if (next.t === event.startT && next.sp === 0 && (previous.sp ?? 0) > 0 && interval > 0 && interval <= MAX_OBSERVED_GAP_MS && speed <= 180) break
      if (interval > 0 && interval <= MAX_OBSERVED_GAP_MS && speed <= 180 && haversineMeters(previous, next) > 1 && (previous.sp ?? 0) > 0 && (next.sp ?? 0) > 0) drivingMs += interval
      else drivingMs = 0
    }
    const rest = drivingMs >= 120 * 60_000 && event.endT - event.startT <= 45 * 60_000
    const nearbyOffice = haversineMeters(event, office) <= OFFICE_RADIUS_M
    const nearbyJob = jobs.filter(validLocation).some(job => haversineMeters(event, job) <= ARRIVAL_RADIUS_M) || (opts.areas ?? []).filter(validLocation).some(area => haversineMeters(event, area) <= area.radiusM)
    const eventPoints = points.filter(point => point.t! >= event.startT && point.t! <= event.endT)
    const uncertain = eventPoints.some((point, i) => i > 0 && point.t! - eventPoints[i - 1].t! > MAX_OBSERVED_GAP_MS)
    const overnight = overlapsNight(event.startT, event.endT)
    return { ...event, durationMin: (event.endT - event.startT) / 60_000, kind: nearbyOffice ? 'office' : nearbyJob ? 'job' : overnight ? 'overnight' : lunch ? 'lunch' : rest ? 'rest' : 'review', confirmedDrivingMin: drivingMs / 60_000, uncertain }
  })
}

export interface StopReview {
  eventId: string; sourceFingerprint: string; version: number; excluded: boolean; reason: string; updatedBy: string; stale?: boolean
}
export type WeeklyEvent = DriverStop & { eventId: string; review: StopReview | null }
export interface WeeklyDay {
  key: string; date: string; plate: string; trailId: string | null; tripIds: string[]; driverId: string; driverName: string
  candidateDrivers: { driverId: string; driverName: string }[]
  quality: 'sufficient' | 'missing' | 'incomplete' | 'ambiguous'
  distanceKm: number; observedMin: number; gapMin: number; events: WeeklyEvent[]; sourceFingerprint: string
}
export interface WeeklyDriver {
  driverId: string; driverName: string; days: number; sufficientDays: number; distanceKm: number; reviewMin: number; excludedMin: number; restMin: number; lunchMin: number; minutesPer100Km: number | null
}
export interface WeeklyStopReport { weekStart: string; weekEnd: string; days: WeeklyDay[]; drivers: WeeklyDriver[] }
export function weeklyJobLocations(trip: Trip, allTrips: Trip[]): LatLng[] {
  const moved = (s: Trip['stops'][number]) => !!s.reassignedToVehiclePlate && (s.outcome === 'reassigned' || s.outcome === 'driver-refused')
  return [...(trip.stops ?? []).filter(s => !moved(s) && s.outcome !== 'postponed'),
    ...allTrips.filter(t => t.status !== 'Cancelled' && t.tripDate === trip.tripDate && t.id !== trip.id).flatMap(t => (t.stops ?? []).filter(s => moved(s) && s.reassignedToTripId === trip.id)),
  ].map(s => ({ lat: s.lat!, lng: s.lng! })).filter(validLocation)
}
export function buildWeeklyStopDays(trips: Trip[], trails: VehicleTrailDoc[], vehicles: Vehicle[], office: LatLng): WeeklyDay[] {
  const groups = new Map<string, Trip[]>()
  const active = trips.filter(t => t.status !== 'Cancelled')
  for (const trip of active.filter(t => !isTripNotRun(t.stops ?? [], incomingStopsForTrip(active.filter(other => other.tripDate === t.tripDate), t.id).length))) {
    const key = `${trip.tripDate}__${trip.vehiclePlate}`
    groups.set(key, [...(groups.get(key) ?? []), trip])
  }
  return [...groups].map(([key, assigned]) => {
    const first = assigned[0]
    const matches = trails.filter(trail => trail.date === first.tripDate && (trail.licensePlate || vehicles.find(v => v.gpsDeviceId === trail.deviceId)?.licensePlate) === first.vehiclePlate)
    const matched = matches[0]
    const identities = new Set(assigned.map(t => t.actualDriverId || t.driverId || ''))
    const cuts = new Set(assigned.map(t => t.gpsEndAt ?? null))
    const candidateDrivers = [...new Map(assigned.map(t => [t.actualDriverId || t.driverId || '', { driverId: t.actualDriverId || t.driverId || '', driverName: t.actualDriverName || t.driverName }])).values()].filter(driver => driver.driverId)
    const base: WeeklyDay = { key, date: first.tripDate, plate: first.vehiclePlate, trailId: matched?.id ?? null, tripIds: assigned.map(t => t.id), driverId: first.actualDriverId || first.driverId || '', driverName: first.actualDriverName || first.driverName, candidateDrivers, quality: 'missing', distanceKm: 0, observedMin: 0, gapMin: 0, sourceFingerprint: '', events: [] }
    if (identities.size !== 1 || identities.has('') || matches.length > 1 || cuts.size > 1) return { ...base, driverId: '', driverName: '', quality: 'ambiguous' }
    const raw = cutTrailAt(matched?.points ?? [], first.gpsEndAt)
    const points = raw.filter(validPoint).sort((a, b) => a.t - b.t)
    let invalid = raw.length !== points.length
    for (let i = 1; i < points.length; i++) {
      const elapsed = points[i].t - points[i - 1].t
      const distance = haversineMeters(points[i - 1], points[i]) / 1000
      if (elapsed <= 0 || distance / elapsed * 3_600_000 > 180) { invalid = true; continue }
      if (elapsed > MAX_OBSERVED_GAP_MS) base.gapMin += elapsed / 60_000
      else {
        if (points[i - 1].sp > 0 || points[i].sp > 0) base.distanceKm += distance
        base.observedMin += elapsed / 60_000
      }
    }
    base.quality = points.length < 2 || base.distanceKm <= 0 || base.observedMin < LONG_DWELL_MIN ? 'missing' : invalid || base.gapMin > 0 ? 'incomplete' : 'sufficient'
    // ทริปกลับอย่างเดียว: ไซต์รับรถ = จุดแรกของงาน (พื้นที่กว้าง) · GPS วันนี้เริ่มนอกทั้งออฟฟิศและไซต์ = ขากลับเริ่มตั้งแต่เมื่อวาน
    // (หน้าติดตามต่อ GPS เมื่อวานให้ แต่รายงานนี้คิดรายวัน) → ข้อมูลไม่ครบช่วง ไม่ใช้เป็นค่าเทียบ
    // เลือกไซต์รับรถตามลำดับจุด (order) แบบเดียวกับหน้าติดตาม · วันนี้ไม่มี GPS ในพื้นที่ไซต์เลย = รับรถก่อนวันนี้ → ไม่ครบช่วง
    const pickup = assigned.filter(t => tripRouteMode(t) === 'return').map(t => weeklyJobLocations({ ...t, stops: [...(t.stops ?? [])].sort((a, b) => a.order - b.order) }, active)[0]).find(Boolean)
    if (pickup && base.quality === 'sufficient' && !points.some(p => haversineMeters(p, pickup) <= RETURN_SITE_AREA_M)) base.quality = 'incomplete'
    base.events = classifyDriverStops(points, office, assigned.flatMap(t => weeklyJobLocations(t, active)), { areas: pickup ? [{ ...pickup, radiusM: RETURN_SITE_AREA_M }] : [] }).filter(event => event.kind !== 'office').map(event => ({ ...event, eventId: `${event.startT}-${event.endT}`, review: null }))
    return base
  })
}
export function aggregateWeeklyStops(days: WeeklyDay[]): WeeklyDriver[] {
  const drivers = new Map<string, WeeklyDriver>()
  for (const day of days) {
    const targets = day.quality === 'ambiguous' ? day.candidateDrivers : [{ driverId: day.driverId, driverName: day.driverName }]
    for (const driver of targets.filter(value => value.driverId)) {
      const row = drivers.get(driver.driverId) ?? { driverId: driver.driverId, driverName: driver.driverName, days: 0, sufficientDays: 0, distanceKm: 0, reviewMin: 0, excludedMin: 0, restMin: 0, lunchMin: 0, minutesPer100Km: null }
      row.days++
      if (day.quality === 'sufficient') row.sufficientDays++
      row.distanceKm += day.distanceKm
      for (const event of day.events) {
        if (event.kind === 'review') event.review?.excluded && !event.review.stale ? row.excludedMin += event.durationMin : row.reviewMin += event.durationMin
        if (event.kind === 'rest') row.restMin += event.durationMin
        if (event.kind === 'lunch') row.lunchMin += event.durationMin
      }
      row.minutesPer100Km = row.days === row.sufficientDays && row.distanceKm > 0 ? row.reviewMin / row.distanceKm * 100 : null
      drivers.set(driver.driverId, row)
    }
  }
  return [...drivers.values()]
}
