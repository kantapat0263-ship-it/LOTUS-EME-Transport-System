/**
 * ลำดับรถใน dropdown เลือกรถ (หน้าจัดคิว) — ผู้ใช้กำหนด 2026-10-04: PICK UP → กระบะคอก → แคป → ประเภทอื่น
 * เทียบจากชื่อประเภท (`vehicle.type` ที่ตั้งในหน้า Fleet → แท็บประเภทรถ) ไม่สนตัวพิมพ์/ช่องว่าง/ขีด
 * เช็ก "คอก"/"แคป" ก่อน "pickup" — ชื่ออย่าง "PICK UP คอก" นับเป็นกระบะคอก (เจาะจงกว่า)
 */
export function vehicleTypeRank(type: unknown): number {
  if (typeof type !== 'string') return 3
  const t = type.toLowerCase().replace(/[\s-]/g, '')
  if (t.includes('คอก')) return 1
  if (t.includes('แคป')) return 2
  if (t.includes('pickup')) return 0
  return 3
}

/** เรียงตาม vehicleTypeRank · ในกลุ่มเดียวกันคงลำดับเดิม (Array.sort เสถียร) · ไม่แก้ array เดิม */
export function sortVehiclesByType<T extends { type?: unknown }>(vehicles: readonly T[]): T[] {
  return [...vehicles].sort((a, b) => vehicleTypeRank(a.type) - vehicleTypeRank(b.type))
}
