/**
 * ตัวช่วยกลางของ "โยกงาน / ขับแทน" ในแผงปิดผลงานจริง (ใบสรุปประจำวัน) — ตรรกะล้วน ไม่แตะฐานข้อมูล
 * งานที่โยกออกเก็บ pointer ไว้ที่จุดต้นทาง (reassignedToTripId) ไม่มี backlink ที่ปลายทาง
 * → ทุกที่ที่ตัดสินว่า "งานไปอยู่คันไหน" ต้องเช็คว่าคันปลายทางยังอยู่จริง ไม่งั้นงานหายเงียบ
 */

interface StopLike {
  outcome?: string | null
  reassignedToTripId?: string | null
  reassignedToDriverName?: string | null
}

interface TripLike {
  id?: string
  status?: string | null
  stops?: StopLike[] | null
  driverName?: string | null
  actualDriverName?: string | null
}

const isMoved = (s: StopLike) => !!s.reassignedToTripId && !!s.outcome && s.outcome !== 'delivered'

/** คันปลายทางของงานที่โยกออก — ยังอยู่ในทริปวันนั้นและไม่ถูกยกเลิก = ทริปนั้น · หาย/ไม่ได้โยก = null */
export function liveMoveTarget<T extends TripLike>(stop: StopLike, trips: T[]): T | null {
  if (!isMoved(stop)) return null
  return trips.find((t) => t.id === stop.reassignedToTripId && t.status !== 'Cancelled') ?? null
}

/** โยกงานออกครบทุกจุด "ไปคันที่ยังอยู่จริง" + ไม่มีงานโยกเข้า = ไม่ได้ออกวิ่ง ซ่อนจากใบสรุป/LINE ได้
 *  คันปลายทางถูกลบ/ยกเลิก = ห้ามซ่อน (ไม่งั้นงานหายจากทุกหน้า) */
export function isFullyMovedOutLive(trip: TripLike, trips: TripLike[], incomingCount: number): boolean {
  const stops = trip.stops || []
  if (stops.length === 0 || incomingCount > 0) return false
  return stops.every((s) => liveMoveTarget(s, trips) != null)
}

/** ทริปเปล่า: ไม่มีงานตัวเองและไม่มีงานโยกเข้า (เช่น สร้างทริปรับโยกแล้วเปลี่ยนใจ) = ไม่ได้วิ่ง */
export function isEmptyTrip(trip: TripLike, incomingCount: number): boolean {
  return (trip.stops?.length ?? 0) === 0 && incomingCount === 0
}

/** กดปุ่มผลที่เลือกอยู่แล้ว (ไม่มีผล = ตามแผน) — ต้องไม่ล้างคันปลายทาง/เหตุผลที่บันทึกไว้
 *  ยกเว้น "ตามแผน" ที่ยังมี pointer โยกค้าง (ข้อมูลเก่า) — กดเพื่อล้างได้ */
export function isSameOutcome(stop: StopLike | null | undefined, outcome: string): boolean {
  if (outcome === 'delivered' && stop?.reassignedToTripId) return false
  return (stop?.outcome || 'delivered') === outcome
}

const MOVE_OUTCOMES = ['reassigned', 'driver-refused']

/** สลับระหว่าง "โยกงาน" ↔ "คนขับปฏิเสธ" = งานยังไปคันเดิม → คงคันปลายทางไว้ (เดิมล้างทิ้ง แถวรับโยกของคันนั้นหายเงียบ) */
export function keepsMoveTarget(prevOutcome: string | null | undefined, outcome: string): boolean {
  return MOVE_OUTCOMES.includes(prevOutcome || '') && MOVE_OUTCOMES.includes(outcome)
}

/** ชื่อคนที่ขับทริปนี้จริง (ขับแทน > คนขับประจำ) */
export function tripDriverLabel(t: { driverName?: string | null; actualDriverName?: string | null }): string {
  return t.actualDriverName || t.driverName || ''
}

/** อัปเดตชื่อผู้รับงานในจุดที่โยกมาคัน tripId (เช่น คันนั้นเปลี่ยนคนขับแทน) — ไม่มีจุดไหนเปลี่ยน = null */
export function renameMoveTarget<S extends StopLike>(stops: S[], tripId: string, name: string): S[] | null {
  let changed = false
  const next = stops.map((s) => {
    if (s.reassignedToTripId !== tripId || !isMoved(s) || s.reassignedToDriverName === name) return s
    changed = true
    return { ...s, reassignedToDriverName: name }
  })
  return changed ? next : null
}
