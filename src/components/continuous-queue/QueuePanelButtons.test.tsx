import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContinuousBooking } from '@/types/continuous-queue'
import type { Trip } from '@/types/models'

let bookings: ContinuousBooking[] = []
vi.mock('@/firebase', () => ({ useUser: () => ({ user: null }) }))
vi.mock('@/hooks/use-continuous-queues', () => ({ useContinuousQueues: () => ({ status: 'ready', bookings, notices: [], refresh: () => {} }) }))
const { QueuePanel } = await import('./QueuePanel')

const booking: ContinuousBooking = {
  id: 'booking-a', startDate: '2026-10-28', endDate: '2026-11-15', driverId: 'driver-a', driverName: 'เก๋',
  vehicleId: 'truck-a', vehiclePlate: '40-1234', siteName: 'ดอนเมือง', createdBy: 'dispatcher', createdAt: '2026-10-28T00:00:00Z',
  dayTripIds: { '2026-10-29': 'day-29', '2026-10-30': 'day-30', '2026-10-31': 'day-31' },
  template: { tripDate: '2026-10-28', driverId: 'driver-a', driverName: 'เก๋', vehicleId: 'truck-a', vehiclePlate: '40-1234', stops: [] },
  overrides: {},
}
const day = (id: string, date: string, patch: Partial<Trip> = {}): Trip => ({ id, tripId: id, tripDate: date, driverId: 'driver-a', driverName: 'เก๋', vehicleId: 'truck-a', vehiclePlate: '40-1234', departureSiteId: '', stops: [{ order: 1, siteName: 'ดอนเมือง', cargoDetails: '' }], status: 'Planned', queueLink: { bookingId: 'booking-a', kind: 'day', date }, ...patch }) as Trip
const render = (date: string, trips: Trip[]) => renderToStaticMarkup(<QueuePanel date={date} trips={trips} onChanged={() => {}} checkAssignments={async () => true} />)

describe('ปุ่มปลดล็อคในแผงคิวต่อเนื่อง', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T03:00:00Z')); bookings = [booking] })
  afterEach(() => { vi.useRealTimers() })

  it('ขึ้นพร้อมวันที่ที่เลือก เฉพาะวันนี้/วันข้างหน้าที่ใบรายวันยังไม่เริ่ม', () => {
    expect(render('2026-10-30', [day('day-30', '2026-10-30')])).toContain('ปลดล็อควันที่ 30/10/2026')
    expect(render('2026-10-31', [day('day-31', '2026-10-31')])).toContain('ปลดล็อควันที่ 31/10/2026')
    expect(render('2026-10-29', [day('day-29', '2026-10-29')])).not.toContain('ปลดล็อควันที่') // ย้อนหลัง
    expect(render('2026-10-30', [day('day-30', '2026-10-30', { gpsEndAt: 1 })])).not.toContain('ปลดล็อควันที่') // จบการใช้รถแล้ว
  })

  it('วันที่ปลดล็อคแล้ว ไม่ขึ้นปุ่มปลดล็อคซ้ำ แต่ขึ้นคืนคิว และบอกงานที่ทำแทน', () => {
    bookings = [{ ...booking, overrides: { '2026-10-30': { state: 'released', targetTripId: '', targetSiteName: '', borrowDriver: true, borrowVehicle: true, compensation: 'not-required', reason: 'ไซต์แจ้งงด', approvedBy: 'u1', approvedAt: '2026-10-30T01:00:00Z' } } }]
    const html = render('2026-10-30', [day('day-30', '2026-10-30', { status: 'Cancelled' })])
    expect(html.split('ปลดล็อควันที่ 30/10/2026').length - 1).toBe(1) // มีแค่ข้อความสรุป ไม่มีปุ่ม
    expect(html).toContain('คืนคิวให้ไซต์เดิม')
    expect(html).toContain('เก๋ ยังไม่มีงาน')
    expect(html).not.toContain('ยืนยันทำงานวันนี้แล้ว')
  })
})
