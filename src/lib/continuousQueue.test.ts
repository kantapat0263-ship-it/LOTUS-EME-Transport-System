import { describe, expect, it } from 'vitest'
import { expandQueueDates, queueNotice, effectiveTrips, resourceGuardKeys } from './continuousQueue'
import type { ContinuousBooking } from '@/types/continuous-queue'

describe('ช่วงคิวต่อเนื่อง', () => {
  it('รักษาทุกวันรวมวันเริ่มและวันสุดท้ายเมื่อข้ามเดือน', () => {
    expect(expandQueueDates('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
  it.each([['2026-02-30', '2026-03-02'], ['2026-10-10', '2026-10-03'], ['2026-01-01', '2026-05-01'], ['', '2026-10-03']])('ไม่รับวันที่ไม่จริง ย้อนกลับ หรือช่วงเกิน 90 วัน (%s)', (from, to) => {
    expect(() => expandQueueDates(from, to)).toThrow()
  })
})

const booking: ContinuousBooking = {
  id: 'B1', startDate: '2026-10-03', endDate: '2026-10-10', driverId: 'D1', driverName: 'สมคิด', vehicleId: 'V1', vehiclePlate: '40-1234', siteName: 'ไซต์ A', dayTripIds: {}, template: { tripDate: '2026-10-03', driverId: 'D1', driverName: 'สมคิด', vehicleId: 'V1', vehiclePlate: '40-1234', stops: [] }, createdBy: 'staff', createdAt: '',
  overrides: { '2026-10-05': { state: 'borrowed', targetTripId: 'T-B', targetSiteName: 'ไซต์ B', borrowDriver: true, borrowVehicle: false, reason: 'ตกลงทางโทรศัพท์', approvedBy: 'staff', approvedAt: '', compensation: 'owed' } },
}

it('แจ้งวันยืมเป็นไซต์ B เฉพาะวันนั้น โดยเก็บช่วงเดิมและแยกทรัพยากร', () => {
  expect(queueNotice(booking, '2026-10-05')).toMatchObject({ startDate: '2026-10-03', endDate: '2026-10-10', effectiveSiteName: 'ไซต์ B', borrowedDriver: true, borrowedVehicle: false })
  expect(queueNotice(booking, '2026-10-06')).toMatchObject({ effectiveSiteName: 'ไซต์ A', borrowedDriver: false, borrowedVehicle: false })
  expect(queueNotice(booking, '2026-10-11')).toBeNull()
  expect(queueNotice({ ...booking, overrides: { '2026-10-05': { ...booking.overrides['2026-10-05'], state: 'returned' } } }, '2026-10-05')).toMatchObject({ effectiveSiteName: 'ไซต์ A', borrowedDriver: false })
})

it('รายงานนับเฉพาะคิวที่ยังใช้งานและ guard ใช้คนขับจริง', () => {
  expect(effectiveTrips([{ id: 'A', status: 'Cancelled' }, { id: 'B', status: 'Planned' }])).toEqual([{ id: 'B', status: 'Planned' }])
  expect(resourceGuardKeys({ tripDate: '2026-10-05', driverId: 'D1', actualDriverId: 'D2', vehicleId: 'V1' })).toEqual(['driver__D2__2026-10-05', 'vehicle__V1__2026-10-05'])
})
