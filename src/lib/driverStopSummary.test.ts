import { describe, expect, it } from 'vitest'
import { aggregateWeeklyStops, buildWeeklyStopDays, classifyDriverStops } from './driverStopSummary'
import type { Trip, Vehicle, VehicleTrailDoc } from '@/types/models'
const office = { lat: 14, lng: 100 }
const time = (clock: string) => Date.parse(`2026-10-05T${clock}:00+07:00`)
const stationary = (start: string, end: string) => [{ lat: 15, lng: 101, t: time(start), sp: 0 }, { lat: 15, lng: 101, t: time(end), sp: 0 }]
const drivenThenStop = (minutes = 120, stopMinutes = 45) => {
  const start = time('08:00')
  const driving = Array.from({ length: minutes + 1 }, (_, i) => ({ lat: 15 + i * .003, lng: 101, t: start + i * 60_000, sp: 60 }))
  const last = driving.at(-1)!
  return [...driving, ...Array.from({ length: stopMinutes }, (_, i) => ({ ...last, t: last.t + (i + 1) * 60_000, sp: 0 }))]
}
describe('fair classification of observed driver stops', () => {
  it('classifies a stop wholly inside 11:30–13:00 Thai time and at most 60 minutes as lunch', () => {
    expect(classifyDriverStops(stationary('11:30', '12:30'), office, [])).toMatchObject([{ kind: 'lunch', durationMin: 60 }])
  })
  it('exempts at most 45 minutes after at least 2 hours of observed continuous driving', () => {
    expect(classifyDriverStops(drivenThenStop(), office, [])).toMatchObject([{ kind: 'rest', confirmedDrivingMin: 120 }])
    expect(classifyDriverStops(drivenThenStop(119), office, [])[0].kind).toBe('review')
    expect(classifyDriverStops(drivenThenStop(120, 46), office, [])[0].kind).toBe('review')
  })
  it('never scores office or assigned job stops even during lunch', () => {
    expect(classifyDriverStops(stationary('11:30', '12:30'), { lat: 15, lng: 101 }, [])[0].kind).toBe('office')
    expect(classifyDriverStops(stationary('11:30', '12:30'), office, [{ lat: 15, lng: 101 }])[0].kind).toBe('job')
  })
  it('does not infer continuous driving or a clean result across silent GPS gaps', () => {
    const points = drivenThenStop().filter((_, i) => i < 30 || i > 40)
    expect(classifyDriverStops(points, office, [])[0].kind).toBe('review')
    expect(classifyDriverStops(stationary('08:00', '09:00'), office, [])[0].uncertain).toBe(true)
  })
  it('rejects partly overlapping lunch, long lunches and fractional duration above 45 minutes', () => {
    for (const clocks of [['11:29', '12:00'], ['12:30', '13:01'], ['11:30', '12:31']]) {
      expect(classifyDriverStops(stationary(clocks[0], clocks[1]), office, [])[0].kind).toBe('review')
    }
    const points = drivenThenStop()
    points.at(-1)!.t += 1000
    expect(classifyDriverStops(points, office, [])[0].kind).toBe('review')
  })
  it('does not treat stale speed at identical locations as continuous driving', () => {
    const points = drivenThenStop()
    for (let i = 0; i < 70; i++) points[i].lat = 15
    expect(classifyDriverStops(points, office, []).at(-1)!.kind).toBe('review')
  })
  it('retains driving proof on arrival at the first stationary sample but not after an unobserved arrival gap', () => {
    const driving = drivenThenStop().slice(0, 121)
    const parked = Array.from({ length: 46 }, (_, i) => ({ lat: 15.363, lng: 101, t: time('10:01') + i * 60_000, sp: 0 }))
    expect(classifyDriverStops([...driving, ...parked], office, [])[0]).toMatchObject({ kind: 'rest', confirmedDrivingMin: 120 })
    const afterGap = parked.map(p => ({ ...p, t: p.t + 10 * 60_000 }))
    expect(classifyDriverStops([...driving, ...afterGap], office, [])[0].kind).toBe('review')
  })
})
const trip = (patch: Partial<Trip> = {}): Trip => ({ id: 't1', tripId: 'T-0510-0001', tripDate: '2026-10-05', driverId: 'd1', driverName: 'สมคิด', vehicleId: 'v1', vehiclePlate: '40-1000', departureSiteId: '', stops: [], status: 'Planned', ...patch })
const trail = (patch: Partial<VehicleTrailDoc> = {}): VehicleTrailDoc => ({ id: '2026-10-05__gps1', date: '2026-10-05', deviceId: 'gps1', licensePlate: '40-1000', points: drivenThenStop(60, 30), ...patch })
describe('weekly attribution and normalized review time', () => {
  it('uses the actual driver identity and historical trail plate, then normalizes only review minutes per 100 GPS km', () => {
    const days = buildWeeklyStopDays([trip({ actualDriverId: 'substitute', actualDriverName: 'คนขับแทน' })], [trail()], [{ gpsDeviceId: 'gps1', licensePlate: 'new-plate' } as Vehicle], office)
    expect(days).toMatchObject([{ driverId: 'substitute', driverName: 'คนขับแทน', plate: '40-1000', quality: 'sufficient' }])
    const summary = aggregateWeeklyStops(days)[0]
    expect(summary.reviewMin).toBe(30)
    expect(summary.minutesPer100Km).toBeCloseTo(30 / days[0].distanceKm * 100)
  })
  it('never duplicates a plate-day trail between different drivers without a start boundary', () => {
    const days = buildWeeklyStopDays([trip(), trip({ id: 't2', driverId: 'd2', driverName: 'อีกคน' })], [trail()], [], office)
    expect(days).toMatchObject([{ quality: 'ambiguous', driverId: '', distanceKm: 0, events: [] }])
    expect(aggregateWeeklyStops(days)).toMatchObject([{ driverId: 'd1', days: 1, sufficientDays: 0, distanceKm: 0, minutesPer100Km: null }, { driverId: 'd2', days: 1, sufficientDays: 0, distanceKm: 0, minutesPer100Km: null }])
  })
  it('reports missing/zero-distance days and silent gaps as insufficient rather than zero anomalies', () => {
    for (const samples of [[], [trail({ points: stationary('08:00', '09:00') })], [trail({ points: drivenThenStop(60, 30).filter((_, i) => i < 10 || i > 20) })]]) {
      const days = buildWeeklyStopDays([trip()], samples, [], office)
      expect(days[0].quality).not.toBe('sufficient')
      expect(aggregateWeeklyStops(days)[0].minutesPer100Km).toBeNull()
    }
  })
  it('counts assigned incoming jobs and excludes moved/postponed jobs consistently with tracking', () => {
    const location = { lat: 15.18, lng: 101 }
    const stop = { siteId: 's1', siteName: 'งาน', cargoDetails: 'ของ', order: 1, ...location }
    const source = trip({ id: 'src', vehiclePlate: 'other', stops: [{ ...stop, outcome: 'reassigned', reassignedToTripId: 't1', reassignedToVehiclePlate: '40-1000' }] })
    const incomingDays = buildWeeklyStopDays([trip(), source], [trail()], [], office)
    expect(incomingDays.find(d => d.plate === '40-1000')!.events[0].kind).toBe('job')
    for (const patch of [{ outcome: 'postponed' as const }, { outcome: 'reassigned' as const, reassignedToVehiclePlate: 'other' }]) {
      expect(buildWeeklyStopDays([trip({ stops: [{ ...stop, ...patch }, { ...stop, lat: 13, lng: 100, order: 2 }] })], [trail()], [], office)[0].events[0].kind).toBe('review')
    }
  })
  it('clips evidence at gpsEndAt and retains an insufficient day instead of attributing later driving', () => {
    const days = buildWeeklyStopDays([trip({ gpsEndAt: time('08:00') })], [trail()], [], office)
    expect(days[0].events).toEqual([])
    expect(days[0].distanceKm).toBe(0)
    expect(aggregateWeeklyStops(days)[0].minutesPer100Km).toBeNull()
  })
  it('invalid GPS coordinates, impossible jumps and multiple trails for one plate are not scorable', () => {
    for (const samples of [[trail({ points: [{ lat: 91, lng: 101, t: time('08:00'), sp: 0 }, ...drivenThenStop(60, 30)] })], [trail({ points: [{ lat: 10, lng: 100, t: time('07:59'), sp: 60 }, ...drivenThenStop(60, 30)] })], [trail(), trail({ id: 'other', deviceId: 'gps2' })]]) {
      expect(buildWeeklyStopDays([trip()], samples, [], office)[0].quality).not.toBe('sufficient')
    }
  })
  it('does not count parked GPS jitter as driving distance or a valid denominator', () => {
    const jitter = Array.from({ length: 61 }, (_, i) => ({ lat: 15 + (i % 2) * .0005, lng: 101, t: time('08:00') + i * 60_000, sp: 0 }))
    const days = buildWeeklyStopDays([trip()], [trail({ points: jitter })], [], office)
    expect(days[0].distanceKm).toBe(0)
    expect(aggregateWeeklyStops(days)[0].minutesPer100Km).toBeNull()
  })
  it('marks the whole week insufficient for every known driver on an ambiguous day', () => {
    const nextDate = '2026-10-06'
    const days = buildWeeklyStopDays([trip(), trip({ id: 't2', tripDate: nextDate }), trip({ id: 't3', tripDate: nextDate, driverId: 'd2', driverName: 'อีกคน' })], [trail(), trail({ id: `${nextDate}__gps1`, date: nextDate })], [], office)
    const rows = aggregateWeeklyStops(days)
    expect(rows.find(row => row.driverId === 'd1')).toMatchObject({ days: 2, sufficientDays: 1, minutesPer100Km: null })
    expect(rows.find(row => row.driverId === 'd2')).toMatchObject({ days: 1, sufficientDays: 0, minutesPer100Km: null })
  })
})
describe('overnight stops (จอดค้างคืน)', () => {
  const at = (iso: string) => Date.parse(`${iso}+07:00`)
  const parked = (from: string, to: string, place = { lat: 15, lng: 101 }) => [{ ...place, t: at(from), sp: 0 }, { ...place, t: at(to), sp: 0 }]
  it('classifies a stop overlapping 22:00–05:00 Thai time as overnight, not review', () => {
    expect(classifyDriverStops(parked('2026-10-06T19:13', '2026-10-07T03:56'), office, [])[0].kind).toBe('overnight')
    expect(classifyDriverStops(parked('2026-10-07T03:56', '2026-10-07T14:30'), office, [])[0].kind).toBe('overnight')
    expect(classifyDriverStops(parked('2026-10-06T21:30', '2026-10-06T22:10'), office, [])[0].kind).toBe('overnight')
  })
  it('keeps daytime stops and the night window edges unchanged', () => {
    expect(classifyDriverStops(parked('2026-10-06T08:00', '2026-10-06T09:00'), office, [])[0].kind).toBe('review')
    expect(classifyDriverStops(parked('2026-10-06T05:00', '2026-10-06T06:00'), office, [])[0].kind).toBe('review')
    expect(classifyDriverStops(parked('2026-10-06T21:00', '2026-10-06T22:00'), office, [])[0].kind).toBe('review')
  })
  it('still reports office and assigned job stops first', () => {
    expect(classifyDriverStops(parked('2026-10-06T23:00', '2026-10-07T02:00'), { lat: 15, lng: 101 }, [])[0].kind).toBe('office')
    expect(classifyDriverStops(parked('2026-10-06T23:00', '2026-10-07T02:00'), office, [{ lat: 15, lng: 101 }])[0].kind).toBe('job')
  })
  it('does not count overnight minutes as review, rest or lunch in the weekly totals', () => {
    const event = { ...classifyDriverStops(parked('2026-10-06T19:13', '2026-10-07T03:56'), office, [])[0], eventId: 'x', review: null }
    const rows = aggregateWeeklyStops([{ key: 'k', date: '2026-10-06', plate: 'p', trailId: 't', tripIds: ['t1'], driverId: 'd1', driverName: 'คนขับ', candidateDrivers: [], quality: 'sufficient', distanceKm: 100, observedMin: 600, gapMin: 0, events: [event], sourceFingerprint: '' }])
    expect(rows[0]).toMatchObject({ reviewMin: 0, restMin: 0, lunchMin: 0, excludedMin: 0 })
  })
})
describe('return-mode trips (กลับอย่างเดียว)', () => {
  it('treats a stop inside the wider pickup-site area as a job stop, not review', () => {
    const yard = [{ lat: 15.005, lng: 101, t: time('09:00'), sp: 0 }, { lat: 15.005, lng: 101, t: time('10:00'), sp: 0 }]
    expect(classifyDriverStops(yard, office, [{ lat: 15, lng: 101 }])[0].kind).toBe('review')
    expect(classifyDriverStops(yard, office, [{ lat: 15, lng: 101 }], { areas: [{ lat: 15, lng: 101, radiusM: 2000 }] })[0].kind).toBe('job')
  })
  it('flags a return-trip day whose GPS starts away from both office and pickup site as incomplete (mission began the day before)', () => {
    const far = { siteId: 's1', siteName: 'ไซต์ไกล', cargoDetails: 'รับรถ', order: 1, lat: 16.5, lng: 101 }
    const started = buildWeeklyStopDays([trip({ routeMode: 'return', stops: [far] })], [trail()], [], office)
    expect(started[0].quality).toBe('incomplete')
    const sameDay = { ...far, lat: 15, lng: 101 } // วันนี้เริ่มที่ไซต์เอง
    expect(buildWeeklyStopDays([trip({ routeMode: 'return', stops: [sameDay] })], [trail()], [], office)[0].quality).toBe('sufficient')
    expect(buildWeeklyStopDays([trip({ stops: [far] })], [trail()], [], office)[0].quality).toBe('sufficient')
  })
})
