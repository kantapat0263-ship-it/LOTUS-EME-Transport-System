import { describe, it, expect } from 'vitest'
import { liveMoveTarget, isFullyMovedOutLive, isEmptyTrip, isSameOutcome, keepsMoveTarget, renameMoveTarget, tripDriverLabel } from './reassign'

const trip = (id: string, patch: Record<string, unknown> = {}) => ({ id, driverName: `คนขับ${id}`, vehiclePlate: `รถ${id}`, stops: [] as any[], status: 'Planned', ...patch })

describe('reassign: คันปลายทางของงานที่โยกออก', () => {
  it('liveMoveTarget: ปลายทางยังอยู่ = ทริปนั้น · ถูกลบ/ยกเลิก/ไม่ได้โยก = null', () => {
    const b = trip('B')
    const stop = { outcome: 'reassigned', reassignedToTripId: 'B' }
    expect(liveMoveTarget(stop, [b])).toBe(b)
    expect(liveMoveTarget(stop, [])).toBeNull()
    expect(liveMoveTarget(stop, [trip('B', { status: 'Cancelled' })])).toBeNull()
    expect(liveMoveTarget({ outcome: 'reassigned' }, [b])).toBeNull()
    expect(liveMoveTarget({ outcome: 'delivered', reassignedToTripId: 'B' }, [b])).toBeNull()
  })

  it('isFullyMovedOutLive: โยกออกครบไปคันที่ยังอยู่ = ซ่อนได้ · คันปลายทางหาย = ห้ามซ่อน (งานจะหายเงียบ)', () => {
    const a = trip('A', { stops: [{ outcome: 'reassigned', reassignedToTripId: 'B' }, { outcome: 'driver-refused', reassignedToTripId: 'B' }] })
    expect(isFullyMovedOutLive(a, [a, trip('B')], 0)).toBe(true)
    expect(isFullyMovedOutLive(a, [a], 0)).toBe(false) // B ถูกลบ
    expect(isFullyMovedOutLive(a, [a, trip('B', { status: 'Cancelled' })], 0)).toBe(false)
    expect(isFullyMovedOutLive(a, [a, trip('B')], 1)).toBe(false) // มีงานโยกเข้า
    expect(isFullyMovedOutLive(trip('A'), [trip('B')], 0)).toBe(false) // ไม่มีงานเลย ไม่ใช่ "โยกออก"
    const mixed = trip('A', { stops: [{ outcome: 'reassigned', reassignedToTripId: 'B' }, { outcome: 'postponed' }] })
    expect(isFullyMovedOutLive(mixed, [mixed, trip('B')], 0)).toBe(false) // เลื่อน = การ์ดยังโชว์
  })
})

describe('reassign: ทริปเปล่า / ปุ่มผลเดิม / ชื่อผู้รับงาน', () => {
  it('isEmptyTrip: ไม่มีงานตัวเองและไม่มีงานโยกเข้า', () => {
    expect(isEmptyTrip(trip('A'), 0)).toBe(true)
    expect(isEmptyTrip(trip('A'), 1)).toBe(false)
    expect(isEmptyTrip(trip('A', { stops: [{}] }), 0)).toBe(false)
  })

  it('isSameOutcome: กดปุ่มที่เลือกอยู่แล้ว (ไม่มีผล = ตามแผน)', () => {
    expect(isSameOutcome({ outcome: 'reassigned' }, 'reassigned')).toBe(true)
    expect(isSameOutcome({}, 'delivered')).toBe(true)
    expect(isSameOutcome({ outcome: 'reassigned' }, 'driver-refused')).toBe(false)
    expect(isSameOutcome(undefined, 'delivered')).toBe(true)
    // "ตามแผน" ที่ยังมี pointer โยกค้าง (ข้อมูลเก่า) ต้องกดล้างได้
    expect(isSameOutcome({ reassignedToTripId: 'B' }, 'delivered')).toBe(false)
  })

  it('keepsMoveTarget: สลับ โยกงาน ↔ คนขับปฏิเสธ คงคันปลายทาง · อย่างอื่นไม่คง', () => {
    expect(keepsMoveTarget('reassigned', 'driver-refused')).toBe(true)
    expect(keepsMoveTarget('driver-refused', 'reassigned')).toBe(true)
    expect(keepsMoveTarget('customer-cancelled', 'reassigned')).toBe(false)
    expect(keepsMoveTarget(undefined, 'reassigned')).toBe(false)
    expect(keepsMoveTarget('reassigned', 'customer-cancelled')).toBe(false)
  })

  it('tripDriverLabel: คนขับจริง (ขับแทน) ก่อนคนขับประจำ', () => {
    expect(tripDriverLabel({ driverName: 'อ๊อฟ', actualDriverName: 'เจ' })).toBe('เจ')
    expect(tripDriverLabel({ driverName: 'อ๊อฟ', actualDriverName: '' })).toBe('อ๊อฟ')
  })

  it('renameMoveTarget: อัปเดตชื่อผู้รับงานเฉพาะจุดที่โยกมาคันนั้น · ไม่มีอะไรเปลี่ยน = null', () => {
    const stops = [
      { siteName: 'x', outcome: 'reassigned', reassignedToTripId: 'B', reassignedToDriverName: 'อ๊อฟ' },
      { siteName: 'y', outcome: 'reassigned', reassignedToTripId: 'C', reassignedToDriverName: 'สมชาย' },
      { siteName: 'z' },
    ]
    expect(renameMoveTarget(stops, 'B', 'เจ')).toEqual([{ ...stops[0], reassignedToDriverName: 'เจ' }, stops[1], stops[2]])
    expect(renameMoveTarget(stops, 'B', 'อ๊อฟ')).toBeNull()
    expect(renameMoveTarget(stops, 'D', 'เจ')).toBeNull()
  })
})
