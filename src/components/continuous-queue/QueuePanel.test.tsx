import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QueueBookingSummary, releasedDayWork } from './QueuePanel'
import type { ContinuousBooking } from '@/types/continuous-queue'
import type { Trip } from '@/types/models'

const booking: ContinuousBooking = {
  id: 'booking-a', startDate: '2026-10-03', endDate: '2026-10-10', driverId: 'driver-a', driverName: 'สมคิด',
  vehicleId: 'truck-a', vehiclePlate: '40-1234', siteName: 'ไซต์ A', createdBy: 'dispatcher', createdAt: '2026-10-03T00:00:00Z',
  dayTripIds: { '2026-10-05': 'base-day5' },
  template: { tripDate: '2026-10-03', driverId: 'driver-a', driverName: 'สมคิด', vehicleId: 'truck-a', vehiclePlate: '40-1234', stops: [] },
  overrides: { '2026-10-05': { state: 'borrowed', targetTripId: 'borrow-day5', targetSiteName: 'ไซต์ B', borrowDriver: true, borrowVehicle: false, compensation: 'owed', reason: 'ยืมส่งของเร่งด่วน', approvedBy: 'คนจัดรถ', approvedAt: '2026-10-04T12:00:00Z' } },
}

describe('continuous booking summary', () => {
  it('shows compensation still owed before opening the history details', () => {
    const html = renderToStaticMarkup(<QueueBookingSummary booking={booking} date="2026-10-05" />)
    expect(html).toContain('ค้างชดเชย 1 วัน')
    expect(html).toContain('รถ 40-1234 ยังจองให้ ไซต์ A')
  })
  it('does not mark scheduled compensation completed just because its date passed', () => {
    const scheduled: ContinuousBooking = { ...booking, overrides: { '2026-10-05': { ...booking.overrides['2026-10-05'], compensation: 'scheduled', compensationDate: '2026-10-11', compensationTripId: 'comp-day11' } } }
    const html = renderToStaticMarkup(<QueueBookingSummary booking={scheduled} date="2026-10-12" />)
    expect(html).toContain('นัดชดเชย 1 วัน ยังไม่ได้ยืนยันทำงาน')
    expect(html).not.toContain('ทำงานชดเชยแล้ว')
    expect(html).not.toContain('วันที่ 12/10/2026 ทำงานให้')
  })

  describe('วันที่ปลดล็อค — ระบบบอกเองว่าคนขับ/รถไปทำอะไรแทน จากทริปของวันนั้น', () => {
    const released: ContinuousBooking = { ...booking, overrides: { '2026-10-05': { state: 'released', targetTripId: '', targetSiteName: '', borrowDriver: true, borrowVehicle: true, compensation: 'not-required', reason: 'ไซต์แจ้งงด', approvedBy: 'คนจัดรถ', approvedAt: '2026-10-04T12:00:00Z' } } }
    const trip = (patch: Partial<Trip>): Trip => ({ id: 'X', tripId: 'X', tripDate: '2026-10-05', driverId: 'other', driverName: 'อ๊อฟ', vehicleId: 'car-x', vehiclePlate: '1ฒษ-4413', departureSiteId: '', stops: [], status: 'Planned', ...patch }) as Trip
    // อ๊อฟมีงาน DRF สามพราน แล้วโยกจุดนั้นให้ทริปใหม่ของสมคิด (ทริปรับโยกไม่มี stop ของตัวเอง)
    const offTrip = trip({ id: 'OFF', vehicleId: 'pickup-off', vehiclePlate: '2กข-1111', stops: [{ order: 1, siteName: 'DRF สามพราน', cargoDetails: '', outcome: 'reassigned', reassignedToTripId: 'GEK' } as any, { order: 2, siteName: 'ไซต์อ๊อฟ', cargoDetails: '' } as any, { order: 3, siteName: 'ไซต์เลื่อน', cargoDetails: '', outcome: 'postponed', postponedToDate: '2026-10-06' } as any] })
    const gekTrip = trip({ id: 'GEK', driverId: 'driver-a', driverName: 'สมคิด' })
    const cancelledDay = trip({ id: 'base-day5', driverId: 'driver-a', vehicleId: 'truck-a', vehiclePlate: '40-1234', status: 'Cancelled', stops: [{ order: 1, siteName: 'ไซต์ A', cargoDetails: '' } as any] })

    it('บอกว่าคนขับไปงานที่โยกมาด้วยรถคันไหน และรถเดิมว่าง โดยไม่นับใบรายวันที่ยกเลิก', () => {
      expect(releasedDayWork(released, '2026-10-05', [offTrip, gekTrip, cancelledDay])).toEqual({ driver: 'สมคิด ไป DRF สามพราน (1ฒษ-4413)', vehicle: 'รถ 40-1234 ว่าง' })
      const html = renderToStaticMarkup(<QueueBookingSummary booking={released} date="2026-10-05" trips={[offTrip, gekTrip, cancelledDay]} />)
      expect(html).toContain('ปลดล็อควันที่ 5/10/2026 (งด ไซต์ A)')
      expect(html).toContain('สมคิด ไป DRF สามพราน (1ฒษ-4413)')
      expect(html).not.toContain('ทำงานให้ ไซต์ A')
    })

    it('ข้อความเปลี่ยนตามทริปจริง: ยังไม่มีงาน / รถเดิมถูกคนอื่นใช้', () => {
      const truckTrip = trip({ id: 'T2', driverId: 'driver-b', driverName: 'เจ', vehicleId: 'truck-a', vehiclePlate: '40-1234', stops: [{ order: 1, siteName: 'ไซต์ C', cargoDetails: '' } as any] })
      expect(releasedDayWork(released, '2026-10-05', [truckTrip])).toEqual({ driver: 'สมคิด ยังไม่มีงาน', vehicle: 'รถ 40-1234 ไป ไซต์ C (เจ)' })
    })

    it('ใช้กฎโยกงานกลาง: คันปลายทางถูกยกเลิก = งานกลับเป็นของต้นทาง · โยกออกหมด = บอกรหัสทริปที่ยังค้าง', () => {
      const deadTarget = trip({ id: 'GEK2', driverId: 'driver-a', driverName: 'สมคิด', status: 'Cancelled' })
      const own = trip({ id: 'MINE', tripId: 'T-0510-0070', driverId: 'driver-a', driverName: 'สมคิด', stops: [{ order: 1, siteName: 'ไซต์ D', cargoDetails: '', outcome: 'reassigned', reassignedToTripId: 'GEK2' } as any] })
      expect(releasedDayWork(released, '2026-10-05', [own, deadTarget]).driver).toBe('สมคิด ไป ไซต์ D (1ฒษ-4413)')
      const other = trip({ id: 'OTHER', vehicleId: 'car-y', vehiclePlate: '3คค-3333' })
      const movedOut = trip({ id: 'MINE', tripId: 'T-0510-0070', driverId: 'driver-a', driverName: 'สมคิด', stops: [{ order: 1, siteName: 'ไซต์ D', cargoDetails: '', outcome: 'reassigned', reassignedToTripId: 'OTHER' } as any] })
      expect(releasedDayWork(released, '2026-10-05', [movedOut, other]).driver).toBe('สมคิด ไป ยังไม่มีจุดงาน · ทริป T-0510-0070 (1ฒษ-4413)')
    })
  })
})
