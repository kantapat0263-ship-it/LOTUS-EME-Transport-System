import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const load = vi.fn()
vi.mock('@googlemaps/js-api-loader', () => ({ Loader: vi.fn(() => ({ load })) }))

import { planRoute, routeStopsKey, computeTripPlanDistance, DEFAULT_TRIP_ORIGIN } from './planDistance'

const RAYONG = { lat: 12.6991, lng: 101.2038 }
const NEAR = { lat: 14.2, lng: 100.62 }
const trip = (extra: Record<string, unknown> = {}) => ({ id: 'T1', fuelRateUsed: 10, dieselPriceUsed: 30, ...extra }) as any

describe('planRoute — จุดที่ใช้คิดเส้นทางตามแผน', () => {
  it('ไป-กลับ: ออฟฟิศ → ทุกจุด → ออฟฟิศ · ใช้ต้นทางของทริปถ้ามี', () => {
    const r = planRoute(trip({ originLat: 14.09, originLng: 100.69 }), [RAYONG, NEAR] as any)!
    expect(r.origin).toEqual({ lat: 14.09, lng: 100.69 })
    expect(r.destination).toEqual({ lat: 14.09, lng: 100.69 })
    expect(r.waypoints).toEqual([RAYONG, NEAR])
  })
  it('ไม่มีต้นทางในทริป = ค่าเริ่มต้นเดียวกับตอนจัดกลุ่ม', () => {
    expect(planRoute(trip(), [NEAR] as any)!.origin).toEqual(DEFAULT_TRIP_ORIGIN)
  })
  it('จุดไม่มีพิกัด / (0,0) ที่ใช้แทนไม่มีพิกัด / นอกไทย ไม่เอามาคิดเส้นทาง', () => {
    const r = planRoute(trip(), [NEAR, { lat: 0, lng: 0 }, {}, { lat: 35.6, lng: 139.7 }, RAYONG] as any)!
    expect(r.waypoints).toEqual([NEAR, RAYONG])
  })
  it('ไม่มีจุดที่ใช้ได้เลย = null · รูปแบบเส้นทางไปอย่างเดียว/กลับอย่างเดียวตามทริป', () => {
    expect(planRoute(trip(), [{ lat: 0, lng: 0 }] as any)).toBeNull()
    expect(planRoute(trip({ routeMode: 'outbound' }), [NEAR, RAYONG] as any)!.destination).toEqual(RAYONG)
    expect(planRoute(trip({ routeMode: 'return' }), [RAYONG, NEAR] as any)!.origin).toEqual(RAYONG)
  })
})

describe('routeStopsKey — จุดส่งของเปลี่ยนในแง่เส้นทางไหม', () => {
  it('เพิ่ม/ลบ/สลับลำดับ/เปลี่ยนพิกัด = เปลี่ยน · แก้รายละเอียดสินค้าอย่างเดียว = ไม่เปลี่ยน', () => {
    const a = [{ siteId: 'A', ...NEAR, cargoDetails: 'x' }, { siteId: 'B', ...RAYONG }] as any
    expect(routeStopsKey([{ ...a[0], cargoDetails: 'อื่น' }, a[1]])).toBe(routeStopsKey(a))
    expect(routeStopsKey([a[1], a[0]])).not.toBe(routeStopsKey(a))
    expect(routeStopsKey([a[0]])).not.toBe(routeStopsKey(a))
    expect(routeStopsKey([{ ...a[0], lat: 14.3 }, a[1]])).not.toBe(routeStopsKey(a))
  })
})

describe('computeTripPlanDistance — ให้ Google Maps คิดเส้นทาง', () => {
  let route: ReturnType<typeof vi.fn>
  beforeEach(() => {
    route = vi.fn()
    load.mockResolvedValue(undefined)
    ;(globalThis as any).window = { google: { maps: {
      DirectionsService: vi.fn(() => ({ route })),
      LatLng: vi.fn((lat: number, lng: number) => ({ lat, lng })),
      TravelMode: { DRIVING: 'DRIVING' },
    } } }
  })
  afterEach(() => { delete (globalThis as any).window })

  it('สำเร็จ = กม./นาทีจาก legs + ค่าน้ำมันตามอัตราที่ส่งมา (เช่นรถคันใหม่) ไม่งั้นอัตราของทริป', async () => {
    route.mockImplementation((_req: unknown, cb: (r: unknown, s: string) => void) =>
      cb({ routes: [{ legs: [{ distance: { value: 100_000 }, duration: { value: 3600 } }, { distance: { value: 50_000 }, duration: { value: 1800 } }] }] }, 'OK'))
    expect(await computeTripPlanDistance('key', trip(), [NEAR] as any)).toEqual({ km: 150, minutes: 90, fuelCost: 450 })
    expect(await computeTripPlanDistance('key', trip(), [NEAR] as any, 15)).toEqual({ km: 150, minutes: 90, fuelCost: 300 })
  })
  it('ส่งเส้นทางตามลำดับจุดให้ Directions (ไม่จัดลำดับใหม่) ต้นทาง/ปลายทางตามทริป', async () => {
    route.mockImplementation((_req: unknown, cb: (r: unknown, s: string) => void) => cb({ routes: [{ legs: [{ distance: { value: 1000 }, duration: { value: 60 } }] }] }, 'OK'))
    await computeTripPlanDistance('key', trip({ originLat: 14.09, originLng: 100.69 }), [RAYONG, { lat: 0, lng: 0 }, NEAR] as any)
    const req = route.mock.calls[0][0]
    expect(req).toMatchObject({ origin: { lat: 14.09, lng: 100.69 }, destination: { lat: 14.09, lng: 100.69 }, optimizeWaypoints: false, region: 'TH', travelMode: 'DRIVING' })
    expect(req.waypoints.map((w: any) => w.location)).toEqual([RAYONG, NEAR])
  })
  it('ต้นทางในทริปเป็น (0,0) = ใช้ต้นทางเริ่มต้น · โหลดแผนที่ไม่ได้ = failed', async () => {
    expect(planRoute(trip({ originLat: 0, originLng: 0 }), [NEAR] as any)!.origin).toEqual(DEFAULT_TRIP_ORIGIN)
    load.mockRejectedValueOnce(new Error('script blocked'))
    expect(await computeTripPlanDistance('key', trip(), [NEAR] as any)).toBe('failed')
  })
  it('ไม่มีคีย์ / Directions ล้ม / ได้ระยะ 0 = failed · ไม่มีจุดที่ใช้ได้ = no-coords (ไม่เรียก Maps)', async () => {
    expect(await computeTripPlanDistance('', trip(), [NEAR] as any)).toBe('failed')
    route.mockImplementation((_req: unknown, cb: (r: unknown, s: string) => void) => cb(null, 'ZERO_RESULTS'))
    expect(await computeTripPlanDistance('key', trip(), [NEAR] as any)).toBe('failed')
    route.mockImplementation((_req: unknown, cb: (r: unknown, s: string) => void) => cb({ routes: [{ legs: [] }] }, 'OK'))
    expect(await computeTripPlanDistance('key', trip(), [NEAR] as any)).toBe('failed')
    // OK พร้อมเส้นทางแต่ 0 กม. (ทุกจุดอยู่ที่ออฟฟิศ) = เชื่อได้ ไม่ใช่คิดไม่ได้
    route.mockImplementation((_req: unknown, cb: (r: unknown, s: string) => void) => cb({ routes: [{ legs: [{ distance: { value: 0 }, duration: { value: 0 } }] }] }, 'OK'))
    expect(await computeTripPlanDistance('key', trip(), [NEAR] as any)).toEqual({ km: 0, minutes: 0, fuelCost: 0 })
    route.mockClear()
    expect(await computeTripPlanDistance('key', trip(), [{ lat: 0, lng: 0 }] as any)).toBe('no-coords')
    expect(route).not.toHaveBeenCalled()
  })
})
