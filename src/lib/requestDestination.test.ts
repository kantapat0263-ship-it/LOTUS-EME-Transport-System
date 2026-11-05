import { describe, expect, it } from 'vitest'
import { requestDestinationFingerprint, assertRequestDestinationsUnchanged, dispatchedDestinationIndexes } from './requestDestination'
import { Timestamp as WebTimestamp } from 'firebase/firestore'
import { Timestamp as AdminTimestamp } from 'firebase-admin/firestore'

const request = () => ({ requestId: 'VR-0710-0001', requestDate: '2026-10-07', requestedBy: 'ผู้ขอ', createdAt: { seconds: 100, nanoseconds: 500_000_000 }, destinations: [{ siteName: 'A', jobDescription: 'ส่งของ', lat: 13, lng: 100 }, { siteName: 'B' }] })
it('fingerprint ตรงกันทั้ง SDK/Admin timestamp และ snapshot JSON', () => {
  const value = request()
  expect(requestDestinationFingerprint(value, 0)).toBe(requestDestinationFingerprint({ ...value, createdAt: { toMillis: () => 100_500 } }, 0))
  expect(requestDestinationFingerprint(value, 0)).toBe(requestDestinationFingerprint({ ...value, createdAt: { _seconds: 100, _nanoseconds: 500_000_000 } }, 0))
})
it('SDK/Admin timestamp ที่มีเศษต่ำกว่า millisecond ต้องยังตรงกัน', () => {
  const value = request(), seconds = 100, nanoseconds = 500_123_456
  const serialized = requestDestinationFingerprint({ ...value, createdAt: { seconds, nanoseconds } }, 0)
  expect(requestDestinationFingerprint({ ...value, createdAt: new WebTimestamp(seconds, nanoseconds) }, 0)).toBe(serialized)
  expect(requestDestinationFingerprint({ ...value, createdAt: new AdminTimestamp(seconds, nanoseconds) }, 0)).toBe(serialized)
})
it('หมายเหตุคนจัดรถ/สถานะ/จุดอื่นเปลี่ยนได้โดยไม่เปลี่ยนตัวตนงานที่เลือก', () => {
  const value = request(), original = requestDestinationFingerprint(value, 0)
  const changed = { ...value, status: 'partial', assignedDestinations: [1], stopNotes: { stop_0: 'ล่าสุด' }, destinations: [value.destinations[0], { siteName: 'B ใหม่' }] }
  expect(requestDestinationFingerprint(changed, 0)).toBe(original)
  expect(() => assertRequestDestinationsUnchanged(changed, [0], [original])).not.toThrow()
})
it.each(['siteName', 'jobDescription', 'lat', 'requestTime'])('ตรวจจับการแก้ %s ของจุดที่เลือก', key => {
  const value = request(), original = requestDestinationFingerprint(value, 0)
  expect(() => assertRequestDestinationsUnchanged({ ...value, destinations: [{ ...value.destinations[0], [key]: 'เปลี่ยนแล้ว' }] }, [0], [original])).toThrow('เปลี่ยน')
})
it('snapshot ไม่ครบ/จำนวนไม่ตรง/ลำดับเลื่อนต้องให้เลือกใหม่', () => {
  const value = request(), original = requestDestinationFingerprint(value, 0)
  expect(() => assertRequestDestinationsUnchanged(value, [0], undefined)).toThrow('โหลด')
  expect(() => assertRequestDestinationsUnchanged(value, [0], [original, original])).toThrow()
  expect(() => assertRequestDestinationsUnchanged({ ...value, destinations: [...value.destinations].reverse() }, [0], [original])).toThrow()
})

describe('dispatchedDestinationIndexes (สำเนาคันคู่ที่ถอนแล้วไม่นับเป็นจุดในเที่ยว)', () => {
  it('ตัด index ที่ withdrawn ออก · ข้อมูลขาด = ว่าง', () => {
    const request = { destinations: [{ siteName: 'A' }, { siteName: 'A', pairedCopy: true, withdrawn: true }, { siteName: 'B' }], assignedDestinations: [1, 2] }
    expect(dispatchedDestinationIndexes(request)).toEqual([2])
    expect(dispatchedDestinationIndexes({ ...request, assignedDestinations: [1] })).toEqual([])
    expect(dispatchedDestinationIndexes(undefined)).toEqual([])
    expect(dispatchedDestinationIndexes({ destinations: [] })).toEqual([])
  })
})
