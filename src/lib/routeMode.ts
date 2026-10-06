/**
 * รูปแบบเส้นทางของทริป — ใช้คิดระยะทางตามแผน (Google Directions) → กม./ค่าน้ำมัน/อันดับนักขับ
 * ปกติทุกทริปคิดแบบไป-กลับคลัง · เคสไม่บ่อย (ผู้ใช้กำหนด 2026-10-06): เอารถไปทิ้งที่ไซต์ = "ไปอย่างเดียว",
 * ไปรับรถอีกคันกลับมาจากไซต์ = "กลับอย่างเดียว" — เลือกทีหลังได้ในแผงปิดผลงานของใบสรุป
 */

export type RouteMode = 'round' | 'outbound' | 'return'

export const ROUTE_MODES: { value: RouteMode; label: string; hint: string }[] = [
  { value: 'round', label: 'ไป-กลับ (ปกติ)', hint: 'คลัง → งาน → คลัง' },
  { value: 'outbound', label: 'ไปอย่างเดียว (รถไม่กลับ)', hint: 'คลัง → งาน' },
  { value: 'return', label: 'กลับอย่างเดียว (เริ่มจากไซต์)', hint: 'งาน → คลัง' },
]

/** รูปแบบเส้นทางของทริป — ไม่มี field / ค่าแปลก = ไป-กลับ */
export function tripRouteMode(trip: { routeMode?: unknown } | null | undefined): RouteMode {
  const m = trip?.routeMode
  return m === 'outbound' || m === 'return' ? m : 'round'
}

/** ต้นทาง/ปลายทาง/จุดแวะ สำหรับคิดระยะ ตามรูปแบบเส้นทาง · ไม่มีจุดที่มีพิกัด = null */
export function routePlan<P>(mode: RouteMode, office: P, pts: P[]): { origin: P; destination: P; waypoints: P[] } | null {
  if (pts.length === 0) return null
  if (mode === 'outbound') return { origin: office, destination: pts[pts.length - 1], waypoints: pts.slice(0, -1) }
  if (mode === 'return') return { origin: pts[0], destination: office, waypoints: pts.slice(1) }
  return { origin: office, destination: office, waypoints: pts }
}
