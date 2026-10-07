import { describe, expect, it } from 'vitest'
import { coordinateSyncBaseline, coordinateSyncPreview, canSyncTripCoordinates } from './tripCoordinateSync'
import type { Site, Trip } from '@/types/models'

const trip = (patch: Partial<Trip> = {}): Trip => ({ id: 't1', tripId: 'T-0710-0001', tripDate: '2026-10-07', driverId: 'd1', driverName: 'คนขับ', vehicleId: 'v1', vehiclePlate: '40-1000', departureSiteId: '', status: 'Planned', stops: [{ siteId: 's1', siteName: 'ไซต์ A', order: 1, cargoDetails: 'งานเดิม', lat: 13, lng: 100 }], ...patch })
const site = (patch: Partial<Site> = {}): Site => ({ id: 's1', name: 'ไซต์ A', address: '', projectTypeTag: 'LOTUS EME', status: 'Active', latitude: 14, longitude: 101, ...patch })

describe('trip coordinate refresh preview', () => {
  it('shows old and latest coordinates without changing the trip', () => {
    const original = trip()
    expect(coordinateSyncPreview(original, [site()])[0]).toMatchObject({ stopIndex: 0, siteId: 's1', from: { lat: 13, lng: 100 }, to: { lat: 14, lng: 101 }, reason: null })
    expect(original.stops[0]).toMatchObject({ lat: 13, lng: 100, cargoDetails: 'งานเดิม' })
  })
  it('does not match a custom site by its name', () => {
    const custom = trip({ stops: [{ ...trip().stops[0], siteId: 'custom-1' }] })
    expect(coordinateSyncPreview(custom, [site()])[0].reason).toContain('ไม่พบสถานที่')
  })
  it.each([NaN, Infinity, 91, undefined])('rejects invalid latitude %s', latitude => {
    expect(coordinateSyncPreview(trip(), [site({ latitude })])[0].reason).toContain('พิกัด')
  })
  it('accepts zero coordinates and preserves missing coordinates as null in the preview', () => {
    const missing = trip({ stops: [{ siteId: 's1', siteName: 'ไซต์ A', order: 1, cargoDetails: 'งานเดิม' }] })
    expect(coordinateSyncPreview(missing, [site({ latitude: 0, longitude: 0 })])[0]).toMatchObject({ from: { lat: null, lng: null }, to: { lat: 0, lng: 0 }, reason: null })
  })
  it('does not offer unchanged or reconciled stops', () => {
    expect(coordinateSyncPreview(trip(), [site({ latitude: 13, longitude: 100 })])[0].reason).toContain('ล่าสุดแล้ว')
    expect(coordinateSyncPreview(trip({ stops: [{ ...trip().stops[0], outcome: 'delivered' }] }), [site()])[0].reason).toContain('ปิดผลงาน')
  })
  it('allows an active managed day but protects ended and cancelled trips', () => {
    expect(canSyncTripCoordinates(trip({ queueLink: { bookingId: 'b1', date: '2026-10-07', kind: 'day' } }))).toBe(true)
    for (const patch of [{ status: 'Completed' as const }, { status: 'Cancelled' as const }, { gpsEndAt: 123 }]) expect(canSyncTripCoordinates(trip(patch))).toBe(false)
  })
  it('baseline tolerates dispatcher-note races but detects reordered jobs, outcome and coordinates', () => {
    const original = trip()
    expect(coordinateSyncBaseline(trip({ stops: [{ ...original.stops[0], dispatcherNote: 'ใหม่', dispatcherName: 'คนจัดรถ' }] }))).toBe(coordinateSyncBaseline(original))
    for (const patch of [{ cargoDetails: 'เปลี่ยนงาน' }, { lat: 14 }, { outcome: 'delivered' as const }]) expect(coordinateSyncBaseline(trip({ stops: [{ ...original.stops[0], ...patch }] }))).not.toBe(coordinateSyncBaseline(original))
  })
})
