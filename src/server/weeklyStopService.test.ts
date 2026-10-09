import { describe, it, expect } from 'vitest'
import { sourceFingerprint } from './weeklyStopService'
import type { WeeklyDay } from '@/lib/driverStopSummary'
import type { Vehicle } from '@/types/models'

// fingerprint ของวัน = หลักฐานที่ใช้คิดเวลาจอด — เปลี่ยน = เหตุผลที่แอดมินบันทึกไว้กลายเป็น stale
const day = { key: '2026-10-05|D1', date: '2026-10-05' } as WeeklyDay
const office = { lat: 13.7, lng: 100.5 }
const withGps: Vehicle[] = [{ id: 'v1', licensePlate: '1ฒษ-4407', type: 'Pickup', maxLoadCapacityKg: 1000, gpsDeviceId: 'D-1' }]

describe('sourceFingerprint (weekly stop report)', () => {
  it('adding cars without GPS does not change the evidence (they never match a trail)', () => {
    const before = sourceFingerprint(day, [], [], withGps, office)
    const added: Vehicle[] = [...withGps, { id: 'imp1', licensePlate: 'รถแบ็คโฮว์', type: 'Pickup', maxLoadCapacityKg: 1 }]
    expect(sourceFingerprint(day, [], [], added, office)).toBe(before)
  })
  it('pairing / changing a GPS device still changes it', () => {
    const before = sourceFingerprint(day, [], [], withGps, office)
    expect(sourceFingerprint(day, [], [], [{ ...withGps[0], gpsDeviceId: 'D-2' }], office)).not.toBe(before)
    const paired: Vehicle[] = [...withGps, { id: 'v2', licensePlate: 'ถอ-7673', type: 'Pickup', maxLoadCapacityKg: 1000, gpsDeviceId: 'D-9' }]
    expect(sourceFingerprint(day, [], [], paired, office)).not.toBe(before)
  })
})
