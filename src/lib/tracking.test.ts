import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  computeStopStatuses,
  isPositionStale,
  trailDistanceKm,
  distanceToPolylineMeters,
  isOffRoute,
  computeDailySummary,
  ARRIVAL_RADIUS_M,
} from './tracking'

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
  const trail = [
    { lat: 13.7, lng: 100.5, t: 0 * M },
    { lat: 13.72, lng: 100.52, t: 5 * M },
    { lat: 13.7501, lng: 100.5501, t: 15 * M },
    { lat: 13.7502, lng: 100.55, t: 25 * M },
    { lat: 13.78, lng: 100.58, t: 35 * M },
    { lat: 13.8001, lng: 100.6001, t: 45 * M },
    { lat: 13.8, lng: 100.6, t: 50 * M },
    { lat: 13.7005, lng: 100.5003, t: 70 * M },
  ]

  it('ออก/กลับออฟฟิศตรงเวลา', () => {
    const s = computeDailySummary(trail, stops, office)
    expect(s.departedOfficeAt).toBe(5 * M)
    expect(s.returnedOfficeAt).toBe(70 * M)
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
