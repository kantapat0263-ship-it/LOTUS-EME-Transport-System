// พิกัดของจุดหมายในใบขอรถ — ฟอร์มขอรถกับ server (api/vehicle-requests) ใช้ตัวตรวจ/ข้อความเดียวกัน
// ผู้ใช้กำหนด 2026-10-19: ทุกจุดต้องมีพิกัดในไทยก่อนส่ง (งานไม่มีพิกัดคิด กม.ตามแผนไม่ได้)
import { inThailand } from './roadFlood'
import { haversineMeters, OFFICE_LOCATION, OFFICE_RADIUS_M, type LatLng } from './tracking'

export const COORDINATE_EXAMPLE = '13.709811, 100.523629'

const DECIMAL = /^-?\d+(\.\d+)?$/

/** "lat, lng" (เลขฐานสิบ) → ตัวเลขที่อยู่ในไทย · ว่าง / รูปแบบผิด / (0,0) / นอกไทย = null */
export function parseThaiCoordinates(value: string): { lat: number; lng: number } | null {
  const parts = value.split(',').map(s => s.trim())
  if (parts.length !== 2 || !parts.every(p => DECIMAL.test(p))) return null
  const [lat, lng] = parts.map(Number)
  return inThailand(lat, lng) ? { lat, lng } : null
}

/** ข้อความชี้ปัญหาพิกัดของจุดหมาย (ไม่มีปัญหา = null) · where เช่น "จุดที่ 2 (โกดังลูกค้า)" */
export function destinationCoordinateProblem(dest: { category: string; coordinates: string }, where: string): string | null {
  if (parseThaiCoordinates(dest.coordinates)) return null
  if (dest.category !== 'custom') return `${where}: สถานที่นี้ยังไม่มีพิกัดในระบบ — เลือก "กำหนดเอง" แล้วใส่พิกัด หรือแจ้งทีมจัดรถให้เติมพิกัด`
  if (!dest.coordinates.trim()) return `${where}: ยังไม่มีพิกัด — ใส่พิกัด เช่น ${COORDINATE_EXAMPLE} (คลิกขวาบนจุดใน Google Maps แล้วคัดลอกพิกัด)`
  return `${where}: พิกัดไม่ถูกต้องหรืออยู่นอกประเทศไทย — ใช้รูปแบบ ${COORDINATE_EXAMPLE}`
}

/** พิกัดออฟฟิศที่ระบบใช้: ค่าคลังสินค้าในหน้าตั้งค่า (companySettings) ก่อน ไม่มี = ค่าคงที่ — แบบเดียวกับหน้าติดตามรถ */
export function officeLocationFrom(settings: { warehouseLatitude?: unknown; warehouseLongitude?: unknown } | null | undefined): LatLng {
  const lat = Number(settings?.warehouseLatitude)
  const lng = Number(settings?.warehouseLongitude)
  return settings?.warehouseLatitude != null && settings?.warehouseLongitude != null && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : OFFICE_LOCATION
}

/**
 * จุดหมายที่เป็นออฟฟิศ (ในรัศมีที่ระบบติดตามรถนับว่า "อยู่ออฟฟิศ") — ไม่รับ เพราะทุกเที่ยวออกจากและกลับออฟฟิศอยู่แล้ว
 * (ผู้ใช้กำหนด 2026-11-10: มีผู้ขอใส่ออฟฟิศเป็นจุดส่งของกลับ → ใบสรุปมีแถวเกิน + หน้าติดตามรถขึ้น "ถึงแล้ว" ตั้งแต่เช้า)
 * ไม่มีปัญหา = null · ใช้เฉพาะตอนส่งใบใหม่ ใบเก่าที่มีจุดออฟฟิศอยู่แล้วไม่ถูกตรวจซ้ำ
 */
export function officeStopProblem(coordinates: string, office: LatLng, where: string): string | null {
  const place = parseThaiCoordinates(coordinates)
  if (!place || haversineMeters(place, office) > OFFICE_RADIUS_M) return null
  return `${where}: เป็นออฟฟิศ — รถออกจากออฟฟิศและกลับออฟฟิศทุกเที่ยวอยู่แล้ว ไม่ต้องใส่เป็นจุดหมาย · ถ้าจะเอาของกลับออฟฟิศ เลือก 🚚 งานปกติ ที่หมาย = ที่ไปรับของ แล้วเขียนว่ารับอะไรกลับ`
}
