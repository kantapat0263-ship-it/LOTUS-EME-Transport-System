// ระยะ/เวลา/ค่าน้ำมัน "ตามแผน" ของทริป จาก Google Directions — ตัวกลางที่หน้าสรุปคิวและหน้าประวัติใช้ร่วมกัน
// (ผู้ใช้กำหนด 2026-10-19: แก้จุดส่งของที่ไหนก็ต้องคิด กม. ใหม่ ตัวเลขตรงกันทุกหน้า)
import { Loader } from '@googlemaps/js-api-loader'
import type { Trip, TripStop } from '@/types/models'
import { routePlan, sumRouteLegs, tripRouteMode } from './routeMode'
import { inThailand } from './roadFlood'

type LatLng = { lat: number; lng: number }

/** ต้นทางตามแผนเมื่อทริปไม่ได้เก็บ originLat/originLng — ค่าเดียวกับตอนจัดกลุ่มและหน้ารายละเอียดทริป */
export const DEFAULT_TRIP_ORIGIN: LatLng = { lat: 14.0815, lng: 100.7129 }

export type PlanDistance = { km: number; minutes: number; fuelCost: number }
/** "no-coords" = ไม่มีจุดที่มีพิกัดให้คิด · "failed" = คิดไม่ได้ (ไม่มีคีย์/แผนที่ไม่พร้อม/เน็ต/Directions ล้ม) */
export type PlanDistanceResult = PlanDistance | 'no-coords' | 'failed'

type RouteTrip = Pick<Trip, 'routeMode' | 'originLat' | 'originLng'>
type CoordStop = Pick<TripStop, 'lat' | 'lng'>

/** เส้นทางที่จะส่งให้ Directions — ใช้เฉพาะจุดที่พิกัดอยู่ในไทย ((0,0) ที่ใช้แทน "ไม่มีพิกัด" ไม่นับ) · ไม่มีเลย = null */
export function planRoute(trip: RouteTrip, stops: CoordStop[]) {
  const pts = stops.filter(s => inThailand(s.lat, s.lng)).map(s => ({ lat: s.lat as number, lng: s.lng as number }))
  const origin = inThailand(trip.originLat, trip.originLng)
    ? { lat: trip.originLat as number, lng: trip.originLng as number }
    : DEFAULT_TRIP_ORIGIN
  return routePlan(tripRouteMode(trip), origin, pts)
}

/** ลายมือชื่อเส้นทางของรายการจุด — เพิ่ม/ลบ/สลับลำดับ/เปลี่ยนพิกัด = เปลี่ยน · แก้รายละเอียดอย่างเดียว = ไม่เปลี่ยน */
export function routeStopsKey(stops: (CoordStop & Pick<TripStop, 'siteId'>)[]): string {
  return JSON.stringify(stops.map(s => [s.siteId ?? '', s.lat ?? null, s.lng ?? null]))
}

/**
 * ให้ Google Directions คิดเส้นทางตามแผน (ไม่จัดลำดับจุดใหม่) แล้วคืน กม./นาที/ค่าน้ำมัน
 * — ค่าน้ำมันใช้ fuelRate ที่ส่งมา (เช่นรถคันใหม่ตอนเปลี่ยนรถ) ไม่งั้นอัตราที่ freeze ไว้กับทริป · ราคาดีเซลใช้ค่าที่ freeze ไว้
 */
export async function computeTripPlanDistance(
  apiKey: string,
  trip: RouteTrip & Pick<Trip, 'fuelRateUsed' | 'dieselPriceUsed'>,
  stops: CoordStop[],
  fuelRate?: number,
): Promise<PlanDistanceResult> {
  const plan = planRoute(trip, stops)
  if (!plan) return 'no-coords'
  if (!apiKey) {
    console.error('[computeTripPlanDistance] ไม่พบคีย์ Google Maps (env/ตั้งค่าระบบ)')
    return 'failed'
  }
  try {
    // options ต้องเหมือน Loader ตัวอื่นทั้งแอป (singleton — ต่างกันแล้ว throw ตอนสลับหน้า)
    await new Loader({ apiKey, version: 'weekly', libraries: ['places', 'geometry'] }).load()
    const g = (window as any).google
    const svc = new g.maps.DirectionsService()
    const result: any = await new Promise((resolve, reject) => {
      svc.route(
        {
          origin: plan.origin,
          destination: plan.destination,
          waypoints: plan.waypoints.map(p => ({ location: new g.maps.LatLng(p.lat, p.lng), stopover: true })),
          optimizeWaypoints: false,
          travelMode: g.maps.TravelMode.DRIVING,
          region: 'TH',
        },
        (res: any, status: any) => (status === 'OK' && res ? resolve(res) : reject(status)),
      )
    })
    const legs = result.routes?.[0]?.legs
    if (!legs?.length) return 'failed'
    // Google ตอบ OK พร้อมเส้นทาง = เชื่อได้แม้ได้ 0 กม. (ทุกจุดอยู่ที่ออฟฟิศ) — เดิมตีเป็นคิดไม่ได้ ทำให้บันทึกไม่ได้ตลอด
    const { km, minutes } = sumRouteLegs(legs)
    const rate = fuelRate && fuelRate > 0 ? fuelRate : trip.fuelRateUsed || 10
    return { km, minutes, fuelCost: (km / rate) * (trip.dieselPriceUsed || 32.5) }
  } catch (e) {
    console.error('[computeTripPlanDistance]', e)
    return 'failed'
  }
}
