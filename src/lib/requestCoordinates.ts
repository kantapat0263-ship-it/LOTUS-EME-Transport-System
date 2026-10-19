// พิกัดของจุดหมายในใบขอรถ — ฟอร์มขอรถกับ server (api/vehicle-requests) ใช้ตัวตรวจ/ข้อความเดียวกัน
// ผู้ใช้กำหนด 2026-10-19: ทุกจุดต้องมีพิกัดในไทยก่อนส่ง (งานไม่มีพิกัดคิด กม.ตามแผนไม่ได้)
import { inThailand } from './roadFlood'

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
