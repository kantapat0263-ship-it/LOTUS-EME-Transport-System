import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QueueBookingSummary } from './QueuePanel'
import type { ContinuousBooking } from '@/types/continuous-queue'

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
})
