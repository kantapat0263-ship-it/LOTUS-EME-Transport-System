import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  computeStopStatuses,
  isPositionStale,
  trailDistanceKm,
  distanceToPolylineMeters,
  isOffRoute,
  computeDailySummary,
  detectStops,
  isPowerCut,
  isOverspeed,
  mileageKm,
  ARRIVAL_RADIUS_M,
  minutesOutsideLunch,
  computeRecurringStops,
  trackingDateKey,
  isTripNotRun,
  OFFICE_LOCATION,
  NEAR_OFFICE_M,
  NEAR_OFFICE_ARRIVAL_DWELL_MIN,
  arrivalDwellMin,
  firstArrivalVisit,
  stopTiming,
  isAwaitingDwell,
  STAY_MIN,
  cutTrailAt,
  suggestHandoverTime,
  thaiClockToMs,
  msToThaiClock,
  handoverCutMs,
  returnTripTrail,
  clockWithDay,
  RETURN_SITE_AREA_M,
  handoverTimeError,
} from './tracking'

describe('tracking: เวลาที่จุดงานนับทุกรอบที่จอดจริง ไม่นับรอบที่ขับผ่าน (Codex รอบ 1 ข้อ 3, 5, 7)', () => {
  const T0 = Date.parse('2026-10-06T09:00:00+07:00')
  const MIN = 60_000
  const office = OFFICE_LOCATION
  const near = { lat: OFFICE_LOCATION.lat + 0.018, lng: OFFICE_LOCATION.lng }
  const far = { lat: 13.75, lng: 100.5 }
  const nextFar = { lat: 13.85, lng: 100.55 }
  const inside = (s: { lat: number; lng: number }, t: number) => ({ lat: s.lat + 0.001, lng: s.lng, t })
  const outside = (s: { lat: number; lng: number }, t: number) => ({ lat: s.lat + 0.01, lng: s.lng, t })
  const parked = (s: { lat: number; lng: number }, start: number, minutes: number) =>
    Array.from({ length: minutes + 1 }, (_, i) => inside(s, start + i * MIN))

  it('STAY_MIN = 2 นาที (สั้นกว่านี้ถือว่าขับผ่าน)', () => expect(STAY_MIN).toBe(2))

  it('stopTiming: จอด 5 นาที ออกไป แล้วกลับมาจอด 30 นาที → ถึงรอบแรก ออกรอบหลัง จอดรวม 35', () => {
    const trail = [...parked(near, T0, 5), outside(near, T0 + 10 * MIN), ...parked(near, T0 + 20 * MIN, 30)]
    expect(stopTiming(near, trail, ARRIVAL_RADIUS_M, 5)).toEqual({ arrivedAt: T0, departedAt: T0 + 50 * MIN, dwellMin: 35 })
  })

  it('stopTiming: รอบที่ขับผ่าน (< 2 นาที) หลังถึงแล้ว ไม่ยืดเวลาออก/จอด', () => {
    const trail = [...parked(far, T0, 10), outside(far, T0 + 20 * MIN), inside(far, T0 + 300 * MIN), outside(far, T0 + 301 * MIN)]
    expect(stopTiming(far, trail, ARRIVAL_RADIUS_M, 0)).toEqual({ arrivedAt: T0, departedAt: T0 + 10 * MIN, dwellMin: 10 })
  })

  it('stopTiming: ยังไม่ถึงตามเกณฑ์ → null · จุดไกลผ่านจุดเดียว → ถึง แต่ไม่มีเวลาจอด', () => {
    expect(stopTiming(near, [inside(near, T0)], ARRIVAL_RADIUS_M, 5)).toBeNull()
    expect(stopTiming(far, [inside(far, T0)], ARRIVAL_RADIUS_M, 0)).toEqual({ arrivedAt: T0, departedAt: T0, dwellMin: null })
  })

  it('สรุปรายวัน: กลับมาจอดไซต์เดิมอีกรอบก่อนไปจุดถัดไป → เวลาเดินทางนับจากออกรอบหลัง', () => {
    const trail = [
      { ...office, t: T0 - 90 * MIN },
      ...parked(far, T0, 5),
      outside(far, T0 + 10 * MIN),
      ...parked(far, T0 + 20 * MIN, 30), // กลับมาจอดอีก 09:20–09:50
      outside(far, T0 + 60 * MIN),
      ...parked(nextFar, T0 + 80 * MIN, 10), // จุดถัดไป 10:20
    ]
    const sum = computeDailySummary(
      trail,
      [{ order: 1, siteName: 'A', ...far }, { order: 2, siteName: 'B', ...nextFar }],
      office
    )
    expect(sum.stops[0].dwellMin).toBe(35)
    expect(sum.stops[0].departedAt).toBe(T0 + 50 * MIN)
    expect(sum.stops[1].travelMinFromPrev).toBe(30)
  })

  it('สรุปรายวัน A→B→A→C: รอบจอด A ที่เกิดหลังถึง B ไม่ถูกนับให้ A — ขาไป B ไม่หาย (Codex รอบ 2 ข้อ 1)', () => {
    const third = { lat: 13.95, lng: 100.6 }
    const trail = [
      { ...office, t: T0 - 90 * MIN },
      ...parked(far, T0, 5), // A 09:00–09:05
      outside(far, T0 + 10 * MIN),
      ...parked(nextFar, T0 + 20 * MIN, 5), // B 09:20–09:25
      outside(nextFar, T0 + 30 * MIN),
      ...parked(far, T0 + 40 * MIN, 30), // A อีกรอบ 09:40–10:10
      outside(far, T0 + 80 * MIN),
      ...parked(third, T0 + 90 * MIN, 5), // C 10:30
    ]
    const sum = computeDailySummary(
      trail,
      [{ order: 1, siteName: 'A', ...far }, { order: 2, siteName: 'B', ...nextFar }, { order: 3, siteName: 'C', ...third }],
      office
    )
    const [a, b] = sum.stops
    expect(a.departedAt).toBe(T0 + 5 * MIN)
    expect(a.dwellMin).toBe(5)
    expect(b.travelMinFromPrev).toBe(15)
  })

  it('stopTiming: รอบจอดที่เริ่มหลัง until ไม่นับ', () => {
    const trail = [...parked(far, T0, 5), outside(far, T0 + 10 * MIN), ...parked(far, T0 + 40 * MIN, 30)]
    expect(stopTiming(far, trail, ARRIVAL_RADIUS_M, 0, T0 + 20 * MIN)).toEqual({ arrivedAt: T0, departedAt: T0 + 5 * MIN, dwellMin: 5 })
  })

  it('จุดไกล: เวลาถึง = เวลาเร็วที่สุดในรัศมี แม้ trail ไม่เรียงเวลา', () => {
    const trail = [inside(far, T0 + 20 * MIN), outside(far, T0 + 10 * MIN), inside(far, T0)]
    const [st] = computeStopStatuses([{ order: 1, ...far }], trail, { office })
    expect(st.arrivedAt).toBe(T0)
  })

  it('isAwaitingDwell: รถอยู่ในรัศมีจุดใกล้ออฟฟิศ (ยังไม่ครบเวลา) → true · จุดไกล/อยู่นอกรัศมี/ไม่รู้ออฟฟิศ → false', () => {
    expect(isAwaitingDwell(near, inside(near, T0), office)).toBe(true)
    expect(isAwaitingDwell(far, inside(far, T0), office)).toBe(false)
    expect(isAwaitingDwell(near, outside(near, T0), office)).toBe(false)
    expect(isAwaitingDwell(near, inside(near, T0), null)).toBe(false)
  })
})

describe('tracking: จุดงานใกล้ออฟฟิศต้องจอดจริงถึงจะนับว่าถึง (กันขับผ่าน)', () => {
  const T0 = Date.parse('2026-10-06T09:00:00+07:00')
  const MIN = 60_000
  const office = OFFICE_LOCATION
  const near = { lat: OFFICE_LOCATION.lat + 0.018, lng: OFFICE_LOCATION.lng } // ~2 กม. จากออฟฟิศ
  const far = { lat: 13.75, lng: 100.5 } // กทม. ~40 กม.
  const inside = (s: { lat: number; lng: number }, t: number) => ({ lat: s.lat + 0.001, lng: s.lng, t }) // ~110 ม.
  const outside = (s: { lat: number; lng: number }, t: number) => ({ lat: s.lat + 0.01, lng: s.lng, t }) // ~1.1 กม.
  const parked = (s: { lat: number; lng: number }, start: number, minutes: number) =>
    Array.from({ length: minutes + 1 }, (_, i) => inside(s, start + i * MIN))

  it('ค่าคงที่ตามที่ตกลง: โซน 5 กม. จอด 5 นาที', () => {
    expect(NEAR_OFFICE_M).toBe(5000)
    expect(NEAR_OFFICE_ARRIVAL_DWELL_MIN).toBe(5)
  })

  it('arrivalDwellMin: ใกล้ออฟฟิศ 5 · ไกล 0 · ไม่รู้ตำแหน่งออฟฟิศ 0', () => {
    expect(arrivalDwellMin(near, office)).toBe(5)
    expect(arrivalDwellMin(far, office)).toBe(0)
    expect(arrivalDwellMin(near, null)).toBe(0)
  })

  it('firstArrivalVisit: ช่วงต่อเนื่องในรัศมี ≥ เกณฑ์ · จุดหลุดนอกรัศมีตัดช่วง · GPS ขาดช่วงแต่หัวท้ายอยู่ในรัศมี = จอดต่อเนื่อง', () => {
    expect(firstArrivalVisit(near, parked(near, T0, 5), ARRIVAL_RADIUS_M, 5)).toEqual({ start: T0, end: T0 + 5 * MIN })
    expect(firstArrivalVisit(near, parked(near, T0, 4), ARRIVAL_RADIUS_M, 5)).toBeNull()
    const split = [...parked(near, T0, 3), outside(near, T0 + 4 * MIN), ...parked(near, T0 + 5 * MIN, 3)]
    expect(firstArrivalVisit(near, split, ARRIVAL_RADIUS_M, 5)).toBeNull()
    expect(firstArrivalVisit(near, [inside(near, T0), inside(near, T0 + 10 * MIN)], ARRIVAL_RADIUS_M, 5)).toEqual({
      start: T0,
      end: T0 + 10 * MIN,
    })
    expect(firstArrivalVisit(near, [inside(near, T0)], ARRIVAL_RADIUS_M, 0)).toEqual({ start: T0, end: T0 })
  })

  it('จุดใกล้ออฟฟิศ: ขับผ่าน (อยู่ในรัศมีจุดเดียว) → ยังไม่ถึง และเป็นเป้าหมายปัจจุบัน', () => {
    const trail = [outside(near, T0), inside(near, T0 + MIN), outside(near, T0 + 2 * MIN)]
    const [st] = computeStopStatuses([{ order: 1, ...near }], trail, { office })
    expect(st.arrived).toBe(false)
    expect(st.isCurrent).toBe(true)
    expect(st.nearestM!).toBeLessThan(ARRIVAL_RADIUS_M)
  })

  it('จุดใกล้ออฟฟิศ: จอด 5 นาที → ถึง (เวลาถึง = เริ่มจอด) · จอด 4 นาที → ยังไม่ถึง', () => {
    const [ok] = computeStopStatuses([{ order: 1, ...near }], parked(near, T0, 5), { office })
    expect(ok.arrived).toBe(true)
    expect(ok.arrivedAt).toBe(T0)
    const [short] = computeStopStatuses([{ order: 1, ...near }], parked(near, T0, 4), { office })
    expect(short.arrived).toBe(false)
  })

  it('จุดใกล้ออฟฟิศ: ขับผ่านตอนเช้า แล้วกลับมาจอดจริงทีหลัง → เวลาถึง = ตอนจอดจริง', () => {
    const trail = [inside(near, T0), outside(near, T0 + MIN), ...parked(near, T0 + 120 * MIN, 6)]
    const [st] = computeStopStatuses([{ order: 1, ...near }], trail, { office })
    expect(st.arrived).toBe(true)
    expect(st.arrivedAt).toBe(T0 + 120 * MIN)
  })

  it('จุดไกลออฟฟิศ / ไม่ส่งตำแหน่งออฟฟิศ: กติกาเดิม เข้าใกล้จุดเดียว = ถึง', () => {
    const [farSt] = computeStopStatuses([{ order: 1, ...far }], [outside(far, T0), inside(far, T0 + MIN)], { office })
    expect(farSt.arrived).toBe(true)
    expect(farSt.arrivedAt).toBe(T0 + MIN)
    const [noOffice] = computeStopStatuses([{ order: 1, ...near }], [inside(near, T0)])
    expect(noOffice.arrived).toBe(true)
  })

  it('สรุปรายวัน: จุดใกล้ออฟฟิศที่ขับผ่านก่อน → เวลาถึง/ออก/จอด มาจากรอบจอดจริง', () => {
    const trail = [
      { ...office, t: T0 - 60 * MIN },
      outside(near, T0 - 30 * MIN),
      inside(near, T0), // ขับผ่าน
      outside(near, T0 + MIN),
      ...parked(near, T0 + 120 * MIN, 20), // จอดจริง 11:00–11:20
      outside(near, T0 + 150 * MIN),
    ]
    const sum = computeDailySummary(trail, [{ order: 1, siteName: 'โรงเก็บของ', ...near }], office)
    expect(sum.stops[0].arrivedAt).toBe(T0 + 120 * MIN)
    expect(sum.stops[0].departedAt).toBe(T0 + 140 * MIN)
    expect(sum.stops[0].dwellMin).toBe(20)
  })

  it('สรุปรายวัน: จุดไกลที่ขับผ่านซ้ำตอนบ่าย → เวลาออก/จอด ไม่ยืดไปถึงตอนขับผ่าน', () => {
    const trail = [
      { ...office, t: T0 - 90 * MIN },
      ...parked(far, T0, 10), // ถึงจริง 09:00–09:10
      outside(far, T0 + 20 * MIN),
      inside(far, T0 + 360 * MIN), // ขับผ่านอีกรอบ 15:00
      outside(far, T0 + 361 * MIN),
    ]
    const sum = computeDailySummary(trail, [{ order: 1, siteName: 'ไซต์ในเมือง', ...far }], office)
    expect(sum.stops[0].arrivedAt).toBe(T0)
    expect(sum.stops[0].departedAt).toBe(T0 + 10 * MIN)
    expect(sum.stops[0].dwellMin).toBe(10)
  })
})

describe('tracking: isTripNotRun (เกณฑ์เดียวกับป้าย 🚫 ไม่ได้วิ่ง ในใบสรุป)', () => {
  it('งานเดียวถูกเลื่อน + ไม่มีงานโยกเข้า = ไม่ได้วิ่ง (เคส 1ฒล-6100 5 ต.ค.)', () => {
    expect(isTripNotRun([{ outcome: 'postponed' }], 0)).toBe(true)
  })
  it('เลื่อน/โยก/ปฏิเสธ ผสมกันครบทุกจุด = ไม่ได้วิ่ง', () => {
    expect(isTripNotRun([{ outcome: 'postponed' }, { outcome: 'reassigned' }, { outcome: 'driver-refused' }], 0)).toBe(true)
  })
  it('เลื่อนบางจุด ยังมีงานตามแผน = ยังวิ่ง', () => {
    expect(isTripNotRun([{ outcome: 'postponed' }, {}], 0)).toBe(false)
    expect(isTripNotRun([{ outcome: 'postponed' }, { outcome: 'delivered' }], 0)).toBe(false)
  })
  it('มีงานโยกเข้า = ยังวิ่ง แม้งานตัวเองถูกเลื่อนหมด', () => {
    expect(isTripNotRun([{ outcome: 'postponed' }], 1)).toBe(false)
  })
  it('ยกเลิกการเลื่อน (ผลกลับเป็นตามแผน) = การ์ดกลับมา', () => {
    expect(isTripNotRun([{}], 0)).toBe(false)
  })
  it('ทริปไม่มีจุด = ไม่ซ่อน', () => {
    expect(isTripNotRun([], 0)).toBe(false)
  })
})

describe('tracking: เก็บ GPS ตลอด 24 ชม. — จุดกลางคืนนับเป็นวันติดตามเดิม', () => {
  const th = (iso: string) => Date.parse(`${iso}+07:00`)
  it('22:00–03:59 ตกวันเดิม (ขับกลับดึก/ถึงบ้านตี 3 อยู่ในทริปวันเดียวกัน) · 04:00 ขึ้นวันใหม่', () => {
    expect(trackingDateKey(th('2026-10-01T22:30:00'))).toBe('2026-10-01')
    expect(trackingDateKey(th('2026-10-02T03:00:00'))).toBe('2026-10-01')
    expect(trackingDateKey(th('2026-10-02T03:59:00'))).toBe('2026-10-01')
    expect(trackingDateKey(th('2026-10-02T04:00:00'))).toBe('2026-10-02')
  })
})

describe('tracking: trackingDateKey (วันทำการไทย ตัดวันตอน 04:00)', () => {
  // เวลาไทย = UTC+7 → แปลงเวลาไทยเป็น ms
  const th = (iso: string) => Date.parse(`${iso}+07:00`)
  it('กลางวัน/หัวค่ำ = วันที่ไทยวันนั้น (เดิม UTC ก็ตรง)', () => {
    expect(trackingDateKey(th('2026-09-30T08:00:00'))).toBe('2026-09-30')
    expect(trackingDateKey(th('2026-09-30T20:13:00'))).toBe('2026-09-30')
    expect(trackingDateKey(th('2026-09-30T23:59:00'))).toBe('2026-09-30')
  })
  it('หลังเที่ยงคืนถึง 03:59 ยังนับเป็นวันก่อน (รถกลับดึกอยู่กับทริปวันนั้น)', () => {
    expect(trackingDateKey(th('2026-10-01T00:30:00'))).toBe('2026-09-30')
    expect(trackingDateKey(th('2026-10-01T03:59:00'))).toBe('2026-09-30')
  })
  it('04:00 เริ่มวันใหม่ — รถที่ออกก่อนตี 5 อยู่กับทริปของวันนั้น', () => {
    expect(trackingDateKey(th('2026-10-01T04:00:00'))).toBe('2026-10-01')
    expect(trackingDateKey(th('2026-10-01T04:59:00'))).toBe('2026-10-01')
    expect(trackingDateKey(th('2026-10-01T05:00:00'))).toBe('2026-10-01')
    expect(trackingDateKey(th('2026-10-01T06:30:00'))).toBe('2026-10-01')
    expect(trackingDateKey(th('2026-10-01T07:00:00'))).toBe('2026-10-01')
  })
})

describe('tracking: haversineMeters', () => {
  it('ระยะ 0 เมื่อจุดเดียวกัน', () => {
    expect(haversineMeters({ lat: 13.75, lng: 100.5 }, { lat: 13.75, lng: 100.5 })).toBe(0)
  })

  it('~111 กม. ต่อ 1 องศาละติจูด (±1%)', () => {
    const d = haversineMeters({ lat: 13, lng: 100 }, { lat: 14, lng: 100 })
    expect(d).toBeGreaterThan(110000)
    expect(d).toBeLessThan(112000)
  })
})

describe('tracking: computeStopStatuses (geofence เข้าใกล้ = ทำแล้ว)', () => {
  const stops = [
    { order: 1, lat: 13.75, lng: 100.5 }, // รถผ่านใกล้
    { order: 2, lat: 14.09, lng: 100.69 }, // รถยังไม่ถึง
    { order: 3, lat: 14.61, lng: 103.02 }, // รถยังไม่ถึง
  ]
  // trail ผ่านใกล้จุดที่ 1 (ห่าง ~50 ม.) แล้วมุ่งหน้าไปทางจุด 2
  const trail = [
    { lat: 13.7504, lng: 100.5003 },
    { lat: 13.85, lng: 100.55 },
    { lat: 13.95, lng: 100.62 },
  ]

  it('จุดที่รถเข้าใกล้ = arrived, จุดถัดไป = current', () => {
    const st = computeStopStatuses(stops, trail)
    expect(st[0].arrived).toBe(true)
    expect(st[0].isCurrent).toBe(false)
    expect(st[1].arrived).toBe(false)
    expect(st[1].isCurrent).toBe(true) // จุดแรกที่ยังไม่ถึง
    expect(st[2].isCurrent).toBe(false)
  })

  it('nearestM ของจุดที่ผ่านใกล้ต้องน้อยกว่ารัศมี', () => {
    const st = computeStopStatuses(stops, trail)
    expect(st[0].nearestM).not.toBeNull()
    expect(st[0].nearestM!).toBeLessThan(ARRIVAL_RADIUS_M)
  })

  it('ไม่มี trail → ทุกจุดยังไม่ถึง, จุดแรกเป็น current', () => {
    const st = computeStopStatuses(stops, [])
    expect(st.every((s) => !s.arrived)).toBe(true)
    expect(st[0].isCurrent).toBe(true)
    expect(st[0].nearestM).toBeNull()
  })

  it('เรียงตาม order เสมอแม้ input สลับ', () => {
    const shuffled = [stops[2], stops[0], stops[1]]
    const st = computeStopStatuses(shuffled, trail)
    expect(st.map((s) => s.order)).toEqual([1, 2, 3])
  })
})

describe('tracking: isPositionStale', () => {
  const now = 1_700_000_000_000
  it('สดถ้าเพิ่งอัปเดต', () => {
    expect(isPositionStale(now - 5 * 60 * 1000, now)).toBe(false)
  })
  it('เก่าถ้าเกิน 30 นาที', () => {
    expect(isPositionStale(now - 45 * 60 * 1000, now)).toBe(true)
  })
  it('ไม่มีเวลา = ถือว่าเก่า', () => {
    expect(isPositionStale(0, now)).toBe(true)
  })
})

describe('tracking: off-route detection', () => {
  // เส้นทางแนวเหนือ-ใต้ตามเส้น lng=100.5
  const route = [
    { lat: 13.7, lng: 100.5 },
    { lat: 14.0, lng: 100.5 },
  ]
  it('จุดบนเส้น = ระยะเกือบ 0', () => {
    const d = distanceToPolylineMeters({ lat: 13.85, lng: 100.5 }, route)
    expect(d!).toBeLessThan(50)
  })
  it('รถบนเส้นทาง = ไม่ออกนอกเส้นทาง', () => {
    expect(isOffRoute({ lat: 13.85, lng: 100.505 }, route)).toBe(false)
  })
  it('รถห่างเส้นทางมาก = ออกนอกเส้นทาง', () => {
    expect(isOffRoute({ lat: 13.85, lng: 100.7 }, route)).toBe(true) // ห่าง ~20 กม.
  })
  it('polyline ว่าง = null / ไม่ถือว่าออกนอกเส้นทาง', () => {
    expect(distanceToPolylineMeters({ lat: 13, lng: 100 }, [])).toBeNull()
    expect(isOffRoute({ lat: 13, lng: 100 }, [])).toBe(false)
  })
})

describe('tracking: computeDailySummary (เวลาจอด/เดินทาง/เข้า-ออกออฟฟิศ)', () => {
  const M = 60000 // 1 นาที = ms
  const office = { lat: 13.7, lng: 100.5 }
  const stops = [
    { order: 1, siteName: 'A', lat: 13.75, lng: 100.55 },
    { order: 2, siteName: 'B', lat: 13.8, lng: 100.6 },
  ]
  // ออฟฟิศ(0') → ออก(5') → ถึง A(15') → ออก A(25') → ถึง B(45') → ออก B(50') → กลับออฟฟิศ(70')
  // จุดท้าย ๆ อยู่ที่ออฟฟิศต่อเนื่อง ≥ RETURN_DWELL_MIN นาที เพื่อยืนยันว่า "กลับจริง" (ไม่ใช่วิ่งผ่าน)
  const trail = [
    { lat: 13.7, lng: 100.5, t: 0 * M },
    { lat: 13.72, lng: 100.52, t: 5 * M },
    { lat: 13.7501, lng: 100.5501, t: 15 * M },
    { lat: 13.7502, lng: 100.55, t: 25 * M },
    { lat: 13.78, lng: 100.58, t: 35 * M },
    { lat: 13.8001, lng: 100.6001, t: 45 * M },
    { lat: 13.8, lng: 100.6, t: 50 * M },
    { lat: 13.7005, lng: 100.5003, t: 70 * M },
    { lat: 13.7004, lng: 100.5004, t: 76 * M },
  ]

  it('ออก/กลับออฟฟิศตรงเวลา (กลับ = เวลาแรกที่เข้ารัศมีแล้วอยู่จริง)', () => {
    const s = computeDailySummary(trail, stops, office)
    expect(s.departedOfficeAt).toBe(5 * M)
    expect(s.returnedOfficeAt).toBe(70 * M)
  })

  it('ไป 2 งาน → กลับมาพักออฟฟิศ → ออกไปงานที่ 3 → การกลับ(พัก)ถูกยกเลิก = ยังไม่กลับ', () => {
    const threeStops = [...stops, { order: 3, siteName: 'C', lat: 13.9, lng: 100.65 }]
    const midBreak = [
      { lat: 13.7, lng: 100.5, t: 0 * M }, // ออฟฟิศ
      { lat: 13.72, lng: 100.52, t: 5 * M }, // ออก
      { lat: 13.7501, lng: 100.5501, t: 15 * M }, // ถึง A
      { lat: 13.8001, lng: 100.6001, t: 30 * M }, // ถึง B
      { lat: 13.7003, lng: 100.5003, t: 60 * M }, // กลับมาพักออฟฟิศ
      { lat: 13.7004, lng: 100.5004, t: 66 * M }, // พักต่อ (dwell ครบ → นับกลับชั่วคราว)
      { lat: 13.9001, lng: 100.6501, t: 80 * M }, // ออกไปงานที่ 3 → การกลับเดิมถูกยกเลิก
    ]
    const s = computeDailySummary(midBreak, threeStops, office)
    expect(s.returnedOfficeAt).toBeNull() // กำลังวิ่งงาน 3 — ยังไม่กลับ
  })

  it('...แล้วกลับจริงหลังงานที่ 3 → นับการกลับครั้งสุดท้าย', () => {
    const threeStops = [...stops, { order: 3, siteName: 'C', lat: 13.9, lng: 100.65 }]
    const fullDay = [
      { lat: 13.7, lng: 100.5, t: 0 * M },
      { lat: 13.72, lng: 100.52, t: 5 * M },
      { lat: 13.7501, lng: 100.5501, t: 15 * M }, // A
      { lat: 13.8001, lng: 100.6001, t: 30 * M }, // B
      { lat: 13.7003, lng: 100.5003, t: 60 * M }, // พักออฟฟิศ
      { lat: 13.7004, lng: 100.5004, t: 66 * M },
      { lat: 13.9001, lng: 100.6501, t: 80 * M }, // งานที่ 3
      { lat: 13.7005, lng: 100.5002, t: 100 * M }, // กลับจริง
      { lat: 13.7003, lng: 100.5004, t: 106 * M }, // จอดยืนยัน
    ]
    const s = computeDailySummary(fullDay, threeStops, office)
    expect(s.departedOfficeAt).toBe(5 * M)
    expect(s.returnedOfficeAt).toBe(100 * M) // การกลับครั้งสุดท้าย ไม่ใช่ตอนพัก 60
  })

  it('ยังไม่เคยถึงจุดงาน → ต้องจอดยาวพิเศษ (RETURN_DWELL_NO_JOB_MIN) ถึงนับกลับ', () => {
    const base = [
      { lat: 13.7, lng: 100.5, t: 0 * M },
      { lat: 13.72, lng: 100.52, t: 5 * M }, // ออก
      { lat: 13.78, lng: 100.58, t: 20 * M }, // ไกลจริง แต่ไม่ถึงจุดงานใด
      { lat: 13.7003, lng: 100.5003, t: 40 * M }, // กลับเข้ารัศมี
      { lat: 13.7004, lng: 100.5004, t: 50 * M }, // อยู่ 10 นาที — ยังไม่ครบ 20
    ]
    expect(computeDailySummary(base, [], office).returnedOfficeAt).toBeNull()
    const longer = [...base, { lat: 13.7003, lng: 100.5002, t: 61 * M }] // อยู่ครบ 21 นาที
    expect(computeDailySummary(longer, [], office).returnedOfficeAt).toBe(40 * M)
  })

  it('เส้นทางวนผ่านใกล้ออฟฟิศระหว่างทาง → ไม่นับว่ากลับ (เคสไปนครสวรรค์)', () => {
    // ออก → ไปไกลจริง → เส้นทางตัดผ่านใกล้ออฟฟิศ 1 จุด → วิ่งต่อออกไปไกล
    const passBy = [
      { lat: 13.7, lng: 100.5, t: 0 * M }, // ออฟฟิศ
      { lat: 13.72, lng: 100.52, t: 5 * M }, // ออก
      { lat: 13.78, lng: 100.58, t: 20 * M }, // ไกลจริง (>1 กม.)
      { lat: 13.7008, lng: 100.5005, t: 40 * M }, // วิ่งผ่านใกล้ออฟฟิศ (ในรัศมี 250 ม.) แวบเดียว
      { lat: 13.75, lng: 100.47, t: 45 * M }, // หลุดรัศมี วิ่งต่อ
      { lat: 13.9, lng: 100.4, t: 80 * M }, // มุ่งหน้าต่อ ยังไม่กลับ
    ]
    const s = computeDailySummary(passBy, [], office)
    expect(s.departedOfficeAt).toBe(5 * M)
    expect(s.returnedOfficeAt).toBeNull() // แค่ผ่าน — ห้ามนับว่ากลับ
  })

  it('เวลาจอดแต่ละจุดถูก (A=10 นาที, B=5 นาที)', () => {
    const s = computeDailySummary(trail, stops, office)
    expect(s.stops[0].dwellMin).toBe(10)
    expect(s.stops[1].dwellMin).toBe(5)
  })

  it('เวลาเดินทางช่วงถูก (ออฟฟิศ→A=10, A→B=20 นาที)', () => {
    const s = computeDailySummary(trail, stops, office)
    expect(s.stops[0].travelMinFromPrev).toBe(10) // ถึง A(15) − ออกออฟฟิศ(5)
    expect(s.stops[1].travelMinFromPrev).toBe(20) // ถึง B(45) − ออก A(25)
  })

  it('ระยะทาง + ความเร็วเฉลี่ยต่อขา (จับคนขับถ่วงเวลา)', () => {
    const s = computeDailySummary(trail, stops, office)
    const legA = s.stops[0]
    expect(legA.travelKmFromPrev).toBeGreaterThan(0)
    expect(legA.avgSpeedKmh).toBeGreaterThan(0)
    // avgSpeed สอดคล้องกับ km ÷ (นาที/60) — ปัดเป็นจำนวนเต็ม กม/ชม
    const expected = Math.round(legA.travelKmFromPrev! / (legA.travelMinFromPrev! / 60))
    expect(legA.avgSpeedKmh).toBe(expected)
  })

  it('วิ่งสลับลำดับแผน (ไป B ก่อน A) → ขาเดินทางคิดตามลำดับที่ถึงจริง', () => {
    // ออฟฟิศ(0') → ออก(5') → ถึง B(15') → ออก B(20') → ถึง A(40') → ออก A(45')
    const swapped = [
      { lat: 13.7, lng: 100.5, t: 0 * M },
      { lat: 13.72, lng: 100.52, t: 5 * M },
      { lat: 13.8001, lng: 100.6001, t: 15 * M },
      { lat: 13.8, lng: 100.6, t: 20 * M },
      { lat: 13.7501, lng: 100.5501, t: 40 * M },
      { lat: 13.7502, lng: 100.55, t: 45 * M },
    ]
    const s = computeDailySummary(swapped, stops, office)
    const A = s.stops.find((x) => x.siteName === 'A')!
    const B = s.stops.find((x) => x.siteName === 'B')!
    expect(B.travelMinFromPrev).toBe(10) // ถึง B(15) − ออกออฟฟิศ(5) — ขาแรกของจริง
    expect(A.travelMinFromPrev).toBe(20) // ถึง A(40) − ออก B(20) — ไม่ใช่คิดจากแผน (จะติดลบ/หาย)
  })

  it('GPS เด้งใกล้ออฟฟิศตอนเพิ่งออกตัว → ไม่นับว่ากลับ (รถยังวิ่งอยู่)', () => {
    // เคสจริง 1ฒฬ-4427: ออก 08:39 GPS เด้งกลับใกล้ออฟฟิศ 08:41 แล้ววิ่งต่อไปบุรีรัมย์
    // เดิมนับ "กลับ 08:41" → เวลาภารกิจ ~1 นาที ทั้งที่ยังไม่เคยห่างออฟฟิศจริง
    const bounce = [
      { lat: 13.7, lng: 100.5, t: 0 * M }, // ที่ออฟฟิศ
      { lat: 13.703, lng: 100.503, t: 1 * M }, // ออก (~465 ม. พ้นรัศมี)
      { lat: 13.7005, lng: 100.5005, t: 2 * M }, // เด้งกลับใกล้ออฟฟิศ (~78 ม.) — ไม่ควรนับว่ากลับ
      { lat: 13.78, lng: 100.58, t: 30 * M }, // วิ่งออกไปไกลจริง (ยังไม่ถึงจุดงาน/ยังไม่กลับ)
    ]
    const s = computeDailySummary(bounce, stops, office)
    expect(s.departedOfficeAt).toBe(1 * M)
    expect(s.returnedOfficeAt).toBeNull() // ยังไม่กลับ → UI ขึ้น "ยังไม่กลับ", ไม่โชว์เวลาภารกิจ
  })

  it('trail ว่าง → ทุกค่า null, ยังไม่ถึงจุด', () => {
    const s = computeDailySummary([], stops, office)
    expect(s.departedOfficeAt).toBeNull()
    expect(s.returnedOfficeAt).toBeNull()
    expect(s.stops[0].arrivedAt).toBeNull()
    expect(s.stops[0].dwellMin).toBeNull()
  })

  it('ไม่มีพิกัดออฟฟิศ → office เป็น null แต่จุดงานยังคำนวณได้', () => {
    const s = computeDailySummary(trail, stops, null)
    expect(s.departedOfficeAt).toBeNull()
    expect(s.stops[0].dwellMin).toBe(10)
  })

  it('วันปกติ (เริ่มที่ออฟฟิศ) → ไม่ติดธงค้างคืน', () => {
    const s = computeDailySummary(trail, stops, office)
    expect(s.startedAwayFromOffice).toBe(false)
    expect(s.vehicleReturnedAt).toBeNull()
    expect(s.endedAwayFromOffice).toBe(false)
  })
})

describe('tracking: computeDailySummary — รถค้างคืนนอกออฟฟิศ (ตื่นนอกพื้นที่)', () => {
  const M = 60000
  const office = { lat: 13.7, lng: 100.5 }
  const home = { lat: 13.61, lng: 100.5 } // บ้านคนขับ ~10 กม. จากออฟฟิศ
  const stops = [{ order: 1, siteName: 'A', lat: 13.75, lng: 100.55 }]

  it('เช้าขับจากบ้านมาคืนรถ → เวลาออก = ตอนคนอื่นเอารถออกไปงานจริง ไม่ใช่ 6 โมง', () => {
    // บ้าน(0') → ถึงออฟฟิศ(30') จอดคืนรถ → คนใหม่เอารถออก(60') → ถึง A(75') → กลับออฟฟิศ(100')
    const t = [
      { lat: home.lat, lng: home.lng, t: 0 * M },
      { lat: 13.65, lng: 100.5, t: 15 * M }, // ระหว่างทางเข้าออฟฟิศ
      { lat: 13.7001, lng: 100.5001, t: 30 * M }, // ถึงออฟฟิศ (มาคืนรถ)
      { lat: 13.7002, lng: 100.5002, t: 33 * M },
      { lat: 13.7001, lng: 100.5003, t: 36 * M }, // จอดครบ dwell = คืนรถจริง
      { lat: 13.72, lng: 100.52, t: 60 * M }, // คนใหม่เอารถออกไปงาน
      { lat: 13.7501, lng: 100.5501, t: 75 * M }, // ถึง A
      { lat: 13.7002, lng: 100.5001, t: 100 * M }, // กลับออฟฟิศ
      { lat: 13.7003, lng: 100.5002, t: 106 * M }, // จอดยืนยัน
    ]
    const s = computeDailySummary(t, stops, office)
    expect(s.startedAwayFromOffice).toBe(true)
    expect(s.vehicleReturnedAt).toBe(30 * M) // ขาเอารถมาคืน
    expect(s.departedOfficeAt).toBe(60 * M) // ออกงานจริง — ไม่ใช่ 0' (ออกจากบ้าน)
    expect(s.returnedOfficeAt).toBe(100 * M)
  })

  it('ค้างคืนแล้ววิ่งไปงานต่อเลย (ไม่เข้าออฟฟิศทั้งวัน) → นับออกจากจุดค้างคืนเป็นเวลาเริ่มงาน', () => {
    const t = [
      { lat: home.lat, lng: home.lng, t: 0 * M },
      { lat: 13.6101, lng: 100.5001, t: 10 * M }, // ยังอยู่บ้าน (GPS ขยับเล็กน้อย)
      { lat: 13.65, lng: 100.53, t: 20 * M }, // ออกจากจุดค้างคืน → เริ่มงาน
      { lat: 13.9, lng: 100.7, t: 60 * M }, // วิ่งไปงานไกล
    ]
    const s = computeDailySummary(t, [], office)
    expect(s.startedAwayFromOffice).toBe(true)
    expect(s.vehicleReturnedAt).toBeNull()
    expect(s.departedOfficeAt).toBe(20 * M)
    expect(s.returnedOfficeAt).toBeNull()
    expect(s.endedAwayFromOffice).toBe(true)
  })

  it('ทำงานจากจุดค้างคืน (ถึงงานก่อนเข้าออฟฟิศ) → ขาเข้าออฟฟิศตอนเย็น = กลับจริง ไม่ใช่มาคืนรถ', () => {
    const t = [
      { lat: home.lat, lng: home.lng, t: 0 * M },
      { lat: 13.63, lng: 100.52, t: 10 * M }, // ออกจากจุดค้างคืน
      { lat: 13.7501, lng: 100.5501, t: 30 * M }, // ถึงงาน A ก่อนแวะออฟฟิศ
      { lat: 13.7001, lng: 100.5001, t: 60 * M }, // เย็นกลับออฟฟิศ
      { lat: 13.7002, lng: 100.5002, t: 66 * M }, // จอดยืนยัน
    ]
    const s = computeDailySummary(t, stops, office)
    expect(s.vehicleReturnedAt).toBeNull() // ไม่ใช่ขามาคืนรถ — ทำงานมาแล้ว
    expect(s.departedOfficeAt).toBe(10 * M)
    expect(s.returnedOfficeAt).toBe(60 * M)
  })

  it('ขับผ่านรัศมีออฟฟิศแวบเดียวตอนเช้า (ทางผ่าน) → ไม่นับว่ามาคืนรถ', () => {
    const t = [
      { lat: home.lat, lng: home.lng, t: 0 * M },
      { lat: 13.65, lng: 100.5, t: 10 * M }, // ออกจากบ้าน
      { lat: 13.7008, lng: 100.5005, t: 30 * M }, // ผ่านใกล้ออฟฟิศจุดเดียว ไม่จอด
      { lat: 13.72, lng: 100.53, t: 33 * M }, // หลุดรัศมี วิ่งต่อ
      { lat: 13.7501, lng: 100.5501, t: 50 * M }, // ถึง A
    ]
    const s = computeDailySummary(t, stops, office)
    expect(s.vehicleReturnedAt).toBeNull() // แค่ผ่าน ไม่ได้จอดคืนรถ
    expect(s.departedOfficeAt).toBe(10 * M) // เริ่มงานจากจุดค้างคืน
  })

  it('วันไปงานไกลแล้วไม่กลับออฟฟิศ (จบวันที่บ้าน) → ไม่มีเวลากลับ + ติดธงค้างคืน', () => {
    const t = [
      { lat: 13.7, lng: 100.5, t: 0 * M }, // เริ่มที่ออฟฟิศตามปกติ
      { lat: 13.72, lng: 100.52, t: 5 * M }, // ออกงาน
      { lat: 15.7, lng: 100.1, t: 300 * M }, // งานไกล (นครสวรรค์)
      { lat: home.lat, lng: home.lng, t: 800 * M }, // กลับดึก เข้าบ้านเลย
    ]
    const s = computeDailySummary(t, stops, office)
    expect(s.departedOfficeAt).toBe(5 * M)
    expect(s.returnedOfficeAt).toBeNull() // ไม่ได้กลับออฟฟิศ
    expect(s.endedAwayFromOffice).toBe(true) // → UI แสดง "ไม่กลับออฟฟิศ (ค้างคืนนอกพื้นที่)"
  })
})

describe('tracking: detectStops (ตรวจจับจุดจอดจาก trail)', () => {
  const M = 60000
  it('จับจุดที่รถจอดนิ่งนานได้ พร้อมระยะเวลา', () => {
    const trail = [
      { lat: 13.7, lng: 100.5, t: 0 * M }, // วิ่ง
      { lat: 13.72, lng: 100.52, t: 5 * M }, // วิ่ง (ไกล)
      // จอดที่ ~13.75,100.55 ตั้งแต่ 10' ถึง 35' (25 นาที)
      { lat: 13.75, lng: 100.55, t: 10 * M },
      { lat: 13.7501, lng: 100.5501, t: 15 * M },
      { lat: 13.7502, lng: 100.55, t: 20 * M },
      { lat: 13.7501, lng: 100.5502, t: 25 * M },
      { lat: 13.75, lng: 100.5501, t: 30 * M },
      { lat: 13.7502, lng: 100.5501, t: 35 * M },
      { lat: 13.78, lng: 100.58, t: 40 * M }, // วิ่งต่อ
    ]
    const stops = detectStops(trail, { minMinutes: 10 })
    expect(stops).toHaveLength(1)
    expect(stops[0].durationMin).toBe(25)
    expect(stops[0].lat).toBeCloseTo(13.75, 2)
  })

  it('จอดสั้น (ต่ำกว่าเกณฑ์) ไม่ถูกจับ', () => {
    const trail = [
      { lat: 13.75, lng: 100.55, t: 0 * M },
      { lat: 13.7501, lng: 100.5501, t: 3 * M }, // จอดแค่ 3 นาที
      { lat: 13.9, lng: 100.7, t: 8 * M },
    ]
    expect(detectStops(trail, { minMinutes: 10 })).toHaveLength(0)
  })

  it('trail ว่าง → []', () => {
    expect(detectStops([])).toEqual([])
  })
})

describe('tracking: แจ้งเตือนอุปกรณ์ (alarm/overspeed/mileage)', () => {
  it('isPowerCut อ่านบิต 32768', () => {
    expect(isPowerCut(0)).toBe(false)
    expect(isPowerCut(32768)).toBe(true)
    expect(isPowerCut(32768 + 64)).toBe(true) // มีบิตอื่นปนก็ยังจับได้
    expect(isPowerCut(64)).toBe(false)
  })
  it('isOverspeed จากเกณฑ์เรา หรือบิต 64', () => {
    expect(isOverspeed(80)).toBe(false)
    expect(isOverspeed(95)).toBe(true) // เกิน 90
    expect(isOverspeed(50, 64)).toBe(true) // อุปกรณ์แจ้ง overspeed
    expect(isOverspeed(100, 0, 120)).toBe(false) // ปรับเกณฑ์เป็น 120
  })
  it('mileageKm แปลงเมตร→กม.', () => {
    expect(mileageKm(130687680)).toBe(130688)
    expect(mileageKm(0)).toBe(0)
  })
})

describe('tracking: trailDistanceKm', () => {
  it('trail ว่าง/จุดเดียว = 0', () => {
    expect(trailDistanceKm([])).toBe(0)
    expect(trailDistanceKm([{ lat: 13, lng: 100 }])).toBe(0)
  })
  it('รวมระยะหลายช่วง', () => {
    const d = trailDistanceKm([
      { lat: 13, lng: 100 },
      { lat: 13.1, lng: 100 },
      { lat: 13.2, lng: 100 },
    ])
    expect(d).toBeGreaterThan(20) // ~22 กม.
    expect(d).toBeLessThan(24)
  })
})

describe('tracking: จุดแวะประจำนอกจุดงาน (recurring stops)', () => {
  const M = 60000
  const office = { lat: 13.7, lng: 100.5 }
  // 12:00 เวลาไทย ของ epoch วันหนึ่ง = 05:00 UTC
  const thaiNoon = Date.UTC(2026, 7, 10, 5, 0, 0) // 10 ส.ค. 2026 12:00 ไทย

  it('minutesOutsideLunch: หน้าต่างพัก 12:30–13:30 — ในพักล้วน=0, นอกล้วน=ทั้งหมด, คร่อม=ส่วนเกิน', () => {
    expect(minutesOutsideLunch(thaiNoon + 30 * M, thaiNoon + 90 * M)).toBe(0) // 12:30–13:30 พอดี
    expect(minutesOutsideLunch(thaiNoon + 120 * M, thaiNoon + 180 * M)).toBe(60) // 14:00–15:00 นอกล้วน
    expect(minutesOutsideLunch(thaiNoon, thaiNoon + 60 * M)).toBe(30) // 12:00–13:00 → พักจริงแค่ 12:30–13:00 = ในพัก 30, นอก 30
    expect(minutesOutsideLunch(thaiNoon + 60 * M, thaiNoon + 120 * M)).toBe(30) // 13:00–14:00 → ในพัก 13:00–13:30 = 30, นอก 30
  })

  it('จอดที่เดิมซ้ำ 3 วัน → เป็นจุดแวะประจำ ; จุดที่มาแค่ 1 วันถูกตัดทิ้ง', () => {
    const home = { lat: 13.79, lng: 100.55 } // ~10 กม.จากออฟฟิศ
    const daily = [
      { date: '2026-08-10', events: [{ ...home, startT: thaiNoon + 120 * M, endT: thaiNoon + 180 * M, durationMin: 60 }] },
      { date: '2026-08-11', events: [{ lat: home.lat + 0.0005, lng: home.lng, startT: thaiNoon + 60 * M, endT: thaiNoon + 150 * M, durationMin: 90 }] },
      { date: '2026-08-12', events: [
        { ...home, startT: thaiNoon - 60 * M, endT: thaiNoon + 60 * M, durationMin: 120 }, // 11:00–13:00 (คร่อมพัก)
        { lat: 13.95, lng: 100.7, startT: thaiNoon, endT: thaiNoon + 15 * M, durationMin: 15 }, // จุดอื่น มาวันเดียว
      ] },
    ]
    const spots = computeRecurringStops(daily, office)
    expect(spots).toHaveLength(1) // จุดวันเดียวถูกตัด (minDays=3)
    const s = spots[0]
    expect(s.days).toBe(3)
    expect(s.visits).toBe(3)
    expect(s.totalMin).toBe(270)
    expect(s.maxMin).toBe(120)
    // นอกพักเที่ยง: 60 + 90 + 60 (จาก 120 ที่คร่อม 12:00–13:00) = 210
    expect(s.offLunchMin).toBe(210)
    expect(s.distFromOfficeKm).toBeGreaterThan(8)
    expect(s.distFromOfficeKm).toBeLessThan(13)
  })
})

describe('tracking: จบการใช้รถของทริป (ส่งต่อรถให้คนอื่นในวันเดียวกัน)', () => {
  const MIN = 60_000
  const T0 = Date.parse('2026-10-06T08:00:00+07:00')
  const office = OFFICE_LOCATION
  const atOffice = (t: number) => ({ lat: office.lat + 0.0005, lng: office.lng, t }) // ~55 ม.
  const away = (t: number) => ({ lat: office.lat + 0.05, lng: office.lng, t }) // ~5.5 กม.

  it('cutTrailAt: เก็บเฉพาะจุดที่เวลา ≤ เวลาจบ · ไม่ได้ตั้ง = ทั้งหมด', () => {
    const trail = [atOffice(T0), away(T0 + 60 * MIN), atOffice(T0 + 120 * MIN)]
    expect(cutTrailAt(trail, T0 + 60 * MIN)).toEqual(trail.slice(0, 2))
    expect(cutTrailAt(trail, null)).toBe(trail)
    expect(cutTrailAt(trail, undefined)).toBe(trail)
  })

  it('suggestHandoverTime: เวลาที่รถออกจากออฟฟิศอีกรอบหลังกลับมาจอด (จุดสุดท้ายในออฟฟิศของรอบจอดนั้น)', () => {
    const trail = [
      atOffice(T0), away(T0 + 30 * MIN), // ออกงาน
      ...Array.from({ length: 11 }, (_, i) => atOffice(T0 + 540 * MIN + i * 10 * MIN)), // กลับ 17:00 จอดถึง 18:40
      away(T0 + 660 * MIN), // อีกคนเอารถออก 19:00
    ]
    expect(suggestHandoverTime(trail, office)).toBe(T0 + 640 * MIN)
  })

  it('suggestHandoverTime: ไม่มีการออกซ้ำหลังกลับ หรือจอดไม่ถึง 5 นาที → null', () => {
    expect(suggestHandoverTime([atOffice(T0), away(T0 + 30 * MIN), atOffice(T0 + 540 * MIN), atOffice(T0 + 560 * MIN)], office)).toBeNull()
    expect(suggestHandoverTime([away(T0), atOffice(T0 + MIN), away(T0 + 2 * MIN)], office)).toBeNull()
  })

  it('thaiClockToMs: เวลาไทยของวันติดตาม — ก่อนตี 4 = วันถัดไป · รูปแบบผิด = null', () => {
    expect(thaiClockToMs('2026-10-06', '18:30')).toBe(Date.parse('2026-10-06T18:30:00+07:00'))
    expect(thaiClockToMs('2026-10-06', '01:15')).toBe(Date.parse('2026-10-07T01:15:00+07:00'))
    expect(thaiClockToMs('2026-10-06', '25:00')).toBeNull()
    expect(thaiClockToMs('2026-10-06', 'abc')).toBeNull()
  })

  it('msToThaiClock: แสดงเวลาไทย HH:MM', () => {
    expect(msToThaiClock(Date.parse('2026-10-06T18:30:00+07:00'))).toBe('18:30')
  })

  it('suggestHandoverTime: เริ่มวันนอกออฟฟิศ → รอบเข้าออฟฟิศแรกแล้วออกงาน ไม่ใช่การส่งต่อ', () => {
    // ตื่นนอกพื้นที่ 08:00 → เข้าออฟฟิศ 09:00–09:05 → ออกทำงาน 09:10 (ไม่มีการกลับมาอีก)
    const startAway = [away(T0), atOffice(T0 + 60 * MIN), atOffice(T0 + 65 * MIN), away(T0 + 70 * MIN)]
    expect(suggestHandoverTime(startAway, office)).toBeNull()
    // ...แล้วกลับมาจอด 17:00–17:10 และมีคนเอารถออกไปอีก → เสนอรอบหลัง
    const thenHandover = [...startAway, atOffice(T0 + 540 * MIN), atOffice(T0 + 550 * MIN), away(T0 + 560 * MIN)]
    expect(suggestHandoverTime(thenHandover, office)).toBe(T0 + 550 * MIN)
  })

  it('handoverCutMs: ไม่แก้เวลาที่เสนอ = ใช้เวลาเสนอเป๊ะ (มีวินาที) · แก้เอง = สิ้นนาทีนั้น', () => {
    const sug = Date.parse('2026-10-06T17:05:40+07:00')
    expect(handoverCutMs('2026-10-06', '17:05', sug)).toBe(sug)
    expect(handoverCutMs('2026-10-06', '17:10', sug)).toBe(Date.parse('2026-10-06T17:10:00+07:00') + 59_999)
    expect(handoverCutMs('2026-10-06', '17:10', null)).toBe(Date.parse('2026-10-06T17:10:00+07:00') + 59_999)
    expect(handoverCutMs('2026-10-06', '', sug)).toBeNull()
  })

  it('handoverCutMs: เวลาตั้งต้นคนละวันติดตามกับทริป (ดูย้อนหลังแล้วค่าเริ่ม = ตอนนี้) → ใช้นาฬิกาบนวันของทริป', () => {
    const todayNow = Date.parse('2026-10-07T10:15:20+07:00')
    expect(handoverCutMs('2026-10-06', '10:15', todayNow)).toBe(Date.parse('2026-10-06T10:15:00+07:00') + 59_999)
  })

  it('handoverCutMs: พิมพ์นาทีปัจจุบันเอง → ไม่เกินตอนนี้ (ไม่โดนปฏิเสธว่าเป็นอนาคต)', () => {
    const now = Date.parse('2026-10-06T15:30:20+07:00')
    expect(handoverCutMs('2026-10-06', '15:30', null, now)).toBe(now)
    expect(handoverCutMs('2026-10-06', '15:31', null, now)).toBe(Date.parse('2026-10-06T15:31:00+07:00') + 59_999) // อนาคตจริง → ให้ guard ปฏิเสธ
  })

  it('handoverTimeError: เวลาในอนาคต / ก่อนรถออกงาน = ไม่รับ', () => {
    const now = Date.parse('2026-10-06T15:00:00+07:00')
    const dep = Date.parse('2026-10-06T08:00:00+07:00')
    expect(handoverTimeError(Date.parse('2026-10-06T12:00:00+07:00'), { departedAt: dep, now })).toBeNull()
    expect(handoverTimeError(Date.parse('2026-10-06T16:00:00+07:00'), { departedAt: dep, now })).toBe('future')
    expect(handoverTimeError(Date.parse('2026-10-06T07:30:00+07:00'), { departedAt: dep, now })).toBe('before-departure')
    expect(handoverTimeError(Date.parse('2026-10-06T07:30:00+07:00'), { departedAt: null, now })).toBeNull()
  })
})

describe('tracking: ทริปกลับอย่างเดียวที่ออกจากไซต์ตั้งแต่วันก่อน (ขับกลับข้ามคืน)', () => {
  const th = (iso: string) => Date.parse(`${iso}+07:00`)
  const site = { lat: 17.4, lng: 102.8 } // ไซต์อุดร
  const home = { lat: 14.0, lng: 100.6 }
  const at = (p: { lat: number; lng: number }, iso: string, dLat = 0) => ({ lat: p.lat + dLat, lng: p.lng, t: th(iso) })
  const prev = [
    at(site, '2026-10-06T04:00:00'),
    at(site, '2026-10-06T19:39:00', 0.005), // ลานจอดห่างหมุด ~550 ม. (ยังอยู่ในพื้นที่ไซต์)
    at(site, '2026-10-06T19:45:00', 0.05), // ออกพ้นพื้นที่ไซต์ (~5.5 กม.)
    at(home, '2026-10-07T03:56:00'),
  ]
  const today = [at(home, '2026-10-07T04:01:00'), at(home, '2026-10-07T14:30:00'), at(home, '2026-10-07T14:40:00', -0.05)]

  it('วันนี้ไม่อยู่ไซต์ แต่เมื่อวานอยู่ → ต่อ GPS เมื่อวานตั้งแต่จุดสุดท้ายในพื้นที่ไซต์ + เวลาออกจากไซต์', () => {
    const r = returnTripTrail(prev, today, site)
    expect(r.prepended).toBe(true)
    expect(r.trail.map((p) => p.t)).toEqual([th('2026-10-06T19:39:00'), th('2026-10-06T19:45:00'), th('2026-10-07T03:56:00'), ...today.map((p) => p.t)])
    expect(r.siteDepartAt).toBe(th('2026-10-06T19:39:00'))
    expect(r.seenAtSite).toBe(true)
  })

  it('ออกจากไซต์วันนี้ (วันนี้ยังมีจุดที่ไซต์) → ไม่ต่อ ใช้ GPS วันนี้ตามเดิม', () => {
    const todayAtSite = [at(site, '2026-10-07T04:00:00'), at(site, '2026-10-07T08:00:00'), at(site, '2026-10-07T08:10:00', 0.05)]
    const r = returnTripTrail(prev, todayAtSite, site)
    expect(r.prepended).toBe(false)
    expect(r.trail).toBe(todayAtSite)
    expect(r.siteDepartAt).toBe(th('2026-10-07T08:00:00'))
  })

  it('เมื่อวานไม่เคยอยู่ไซต์ / ไม่มีพิกัดไซต์ → ไม่ต่อ ไม่มีเวลาออกจากไซต์', () => {
    const r = returnTripTrail([at(home, '2026-10-06T10:00:00')], today, site)
    expect(r).toMatchObject({ prepended: false, siteDepartAt: null, seenAtSite: false })
    expect(r.trail).toBe(today)
    expect(returnTripTrail(prev, today, null)).toMatchObject({ prepended: false, siteDepartAt: null, seenAtSite: false })
  })

  it('ยังอยู่ไซต์ไม่ออก → เห็นว่าอยู่ไซต์แต่ยังไม่มีเวลาออก', () => {
    const r = returnTripTrail([], [at(site, '2026-10-07T09:00:00'), at(site, '2026-10-07T10:00:00')], site)
    expect(r).toMatchObject({ prepended: false, siteDepartAt: null, seenAtSite: true })
  })

  it('พื้นที่ไซต์กว้างกว่าเกณฑ์ถึงจุดงาน (หมุดไซต์กับลานจอดจริงห่างกันได้)', () => {
    expect(RETURN_SITE_AREA_M).toBeGreaterThan(1000)
  })
})

describe('tracking: clockWithDay — เวลาคนละวันกับที่กำลังดูต้องบอกวันที่', () => {
  const th = (iso: string) => Date.parse(`${iso}+07:00`)
  it('วันเดียวกัน = HH:MM · คนละวัน = HH:MM (วัน เดือนย่อ)', () => {
    expect(clockWithDay(th('2026-10-07T14:33:00'), '2026-10-07')).toBe('14:33')
    expect(clockWithDay(th('2026-10-06T19:40:00'), '2026-10-07')).toBe('19:40 (6 ต.ค.)')
    expect(clockWithDay(th('2026-10-08T00:30:00'), '2026-10-07')).toBe('00:30 (8 ต.ค.)')
    expect(clockWithDay(th('2026-12-31T23:05:00'), '2027-01-01')).toBe('23:05 (31 ธ.ค.)')
  })
})
