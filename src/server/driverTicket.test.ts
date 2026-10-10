import { describe, expect, it } from 'vitest'
import { buildDriverTicket } from './driverTicket'

describe('buildDriverTicket — ส่งเฉพาะที่ใบงานแสดง', () => {
  const trip = {
    id: 'T-1', tripId: 'T-1', tripDate: '2026-10-10', driverId: 'D1', driverName: 'ก', fuelCost: 999, vehicleId: 'V1',
    stopNotes: { stop_0: 'ระวังทางแคบ', stop_7: 'จุดที่ถูกลบไปแล้ว' },
    stopNoteAuthors: {},
    stops: [
      { siteName: 'A', outcome: 'driver-refused', reassignedToVehiclePlate: 'กข 1', dispatcherNote: 'โน้ตรุ่นเก่า (ถูกแทนแล้ว)', dispatcherName: 'คนจัดรถเก่า', sourceVRIds: ['VR-1'] },
      { siteName: 'B', outcome: 'delivered', dispatcherNote: 'โน้ตรุ่นเก่าที่ยังใช้', lat: 13.7, lng: '100.5' },
      { siteName: 'C' },
    ],
  }

  it('ผลจุดส่งเหลือแค่ ส่งแล้ว/ยังไม่ส่ง (ไม่ส่งเหตุผลภายในอย่าง driver-refused)', () => {
    const { trip: t } = buildDriverTicket(trip, [], '')
    expect(t.stops.map(s => s.outcome)).toEqual(['not-delivered', 'delivered', undefined])
    expect(JSON.stringify(t)).not.toContain('driver-refused')
  })

  it('หมายเหตุคนจัดรถ = ค่าที่ใบงานแสดงจริงของจุดที่มีอยู่ (ตัวหลักก่อน รุ่นเก่าเป็นสำรอง)', () => {
    const { trip: t } = buildDriverTicket(trip, [], '')
    expect(t.stopNotes).toEqual({ stop_0: 'ระวังทางแคบ', stop_1: 'โน้ตรุ่นเก่าที่ยังใช้' })
    expect(t.stopNoteAuthors).toEqual({ stop_0: 'คนจัดรถเก่า' })
    const raw = JSON.stringify(t)
    for (const hidden of ['โน้ตรุ่นเก่า (ถูกแทนแล้ว)', 'จุดที่ถูกลบไปแล้ว', 'fuelCost', 'vehicleId', 'driverId', 'sourceVRIds']) expect(raw).not.toContain(hidden)
  })

  it('พิกัดส่งเฉพาะตัวเลข', () => {
    const { trip: t } = buildDriverTicket(trip, [], '')
    expect(t.stops[1]).toMatchObject({ lat: 13.7 })
    expect(t.stops[1]).not.toHaveProperty('lng')
  })
})
