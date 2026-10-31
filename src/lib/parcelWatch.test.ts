import { describe, expect, it } from 'vitest'
import type { ParcelWatch, Trip, TripStop } from '@/types/models'
import { addDaysIso, matchParcelRuns, parcelAlertMessage, parcelDeadlineWarning, pendingParcelAlerts, runDateLabel } from './parcelWatch'

const TODAY = '2026-10-31'
const stop = (siteId: string, siteName: string, patch: Partial<TripStop> = {}): TripStop => ({ siteId, siteName, order: 1, cargoDetails: '', ...patch })
const trip = (id: string, date: string, stops: TripStop[], patch: Partial<Trip> = {}): Trip => ({
  id, tripId: `T-${id}`, tripDate: date, driverId: `drv-${id}`, driverName: `คนขับ ${id}`, vehicleId: `car-${id}`, vehiclePlate: `ทะเบียน ${id}`,
  departureSiteId: '', stops, status: 'Planned', ...patch,
}) as Trip
const parcel = (patch: Partial<ParcelWatch> = {}): ParcelWatch => ({ id: 'p1', userId: 'u1', siteId: 'drf', siteName: 'DRF สามพราน', item: 'Notebook', status: 'waiting', ...patch })

describe('matchParcelRuns — หาเที่ยวรถที่ไปไซต์ที่ฝากของ', () => {
  it('จับคู่ด้วยรหัสไซต์ เรียงใกล้สุดก่อน และบอกคนขับ/ทะเบียน/ไซต์อื่นในเที่ยว', () => {
    const runs = matchParcelRuns(parcel(), [
      trip('b', '2026-11-03', [stop('drf', 'DRF สามพราน')]),
      trip('a', '2026-11-01', [stop('x', 'ไซต์ X'), stop('drf', 'DRF (ชื่อเก่า)'), stop('y', 'ไซต์ Y')], { actualDriverId: 'drv-sub', actualDriverName: 'คนขับแทน' }),
      trip('c', '2026-11-01', [stop('x', 'ไซต์ X')]),
    ], TODAY)
    expect(runs.map(r => r.tripDocId)).toEqual(['a', 'b'])
    expect(runs[0]).toEqual({ tripDocId: 'a', tripCode: 'T-a', date: '2026-11-01', plate: 'ทะเบียน a', driverId: 'drv-sub', driverName: 'คนขับแทน', otherSites: ['ไซต์ X', 'ไซต์ Y'] })
  })

  it('จุดงานที่ไม่มีรหัสไซต์ (พิมพ์ชื่อเอง) ใช้ชื่อเทียบ ไม่สนช่องว่าง/ตัวพิมพ์', () => {
    const runs = matchParcelRuns(parcel({ siteName: 'Site  ABC' }), [
      trip('a', TODAY, [stop('', ' site abc ')]),
      trip('b', TODAY, [stop('', 'Site ABCD')]),
    ], TODAY)
    expect(runs.map(r => r.tripDocId)).toEqual(['a'])
  })

  it('ไม่นับทริปยกเลิก จบงานแล้ว จบการใช้รถแล้ว ย้อนหลัง และเที่ยวที่กดรอรอบถัดไป', () => {
    const runs = matchParcelRuns(parcel({ skippedTripIds: ['skip'] }), [
      trip('cancel', TODAY, [stop('drf', 'DRF')], { status: 'Cancelled' }),
      trip('done', TODAY, [stop('drf', 'DRF')], { status: 'Completed' }),
      trip('ended', TODAY, [stop('drf', 'DRF')], { gpsEndAt: 1 }),
      trip('past', '2026-10-30', [stop('drf', 'DRF')]),
      trip('skip', TODAY, [stop('drf', 'DRF')]),
      trip('ok', '2026-11-02', [stop('drf', 'DRF')]),
    ], TODAY)
    expect(runs.map(r => r.tripDocId)).toEqual(['ok'])
  })

  it('จุดงานที่เลื่อนวันไม่นับ และหนึ่งเที่ยวนับครั้งเดียวแม้มีหลายจุดที่ไซต์เดียวกัน', () => {
    expect(matchParcelRuns(parcel(), [trip('a', TODAY, [stop('drf', 'DRF', { outcome: 'postponed', postponedToDate: '2026-11-05' })])], TODAY)).toEqual([])
    expect(matchParcelRuns(parcel(), [trip('a', TODAY, [stop('drf', 'DRF'), stop('drf', 'DRF', { order: 2 })])], TODAY)).toHaveLength(1)
  })

  it('งานที่โยกไปคันอื่นตามไปคันที่รับจริง · คันปลายทางยกเลิก = งานยังอยู่คันเดิม', () => {
    const moved = stop('drf', 'DRF', { outcome: 'reassigned', reassignedToTripId: 'target' })
    expect(matchParcelRuns(parcel(), [trip('source', TODAY, [moved, stop('x', 'ไซต์ X')]), trip('target', TODAY, [stop('y', 'ไซต์ Y')])], TODAY))
      .toMatchObject([{ tripDocId: 'target', otherSites: ['ไซต์ Y'] }])
    expect(matchParcelRuns(parcel(), [trip('source', TODAY, [moved]), trip('target', TODAY, [stop('y', 'ไซต์ Y')], { status: 'Cancelled' })], TODAY))
      .toMatchObject([{ tripDocId: 'source' }])
  })

  it('คันที่รับงานโยกจบการใช้รถแล้ว = ไม่มีรถไป (ไม่ย้อนกลับไปนับคันต้นทาง)', () => {
    const moved = stop('drf', 'DRF', { outcome: 'reassigned', reassignedToTripId: 'target' })
    expect(matchParcelRuns(parcel(), [trip('source', TODAY, [moved]), trip('target', TODAY, [], { gpsEndAt: 1 })], TODAY)).toEqual([])
  })
})

describe('parcelDeadlineWarning — เตือนเมื่อรถอาจไปไม่ทันวันที่ต้องถึง', () => {
  const run = (date: string) => ({ tripDocId: 'a', tripCode: 'T-a', date, plate: '', driverId: '', driverName: '', otherSites: [] })
  it('ไม่มีวันที่ต้องถึง / ฝากแล้ว / รถไปทัน = ไม่เตือน', () => {
    expect(parcelDeadlineWarning(parcel(), undefined, TODAY)).toBeNull()
    expect(parcelDeadlineWarning(parcel({ deadline: '2026-11-01', status: 'handed' }), undefined, TODAY)).toBeNull()
    expect(parcelDeadlineWarning(parcel({ deadline: '2026-11-03' }), run('2026-11-03'), TODAY)).toBeNull()
    expect(parcelDeadlineWarning(parcel({ deadline: '2026-11-10' }), undefined, TODAY)).toBeNull()
  })
  it('รถเที่ยวแรกไปหลังวันที่ต้องถึง / ใกล้ถึงแล้วยังไม่มีรถ / เลยวันแล้ว', () => {
    expect(parcelDeadlineWarning(parcel({ deadline: '2026-11-02' }), run('2026-11-04'), TODAY)).toContain('หลังวันที่ต้องถึง')
    expect(parcelDeadlineWarning(parcel({ deadline: '2026-11-02' }), undefined, TODAY)).toContain('ยังไม่มีรถ')
    expect(parcelDeadlineWarning(parcel({ deadline: '2026-10-30' }), undefined, TODAY)).toContain('เลยวันที่ต้องถึง')
  })
})

describe('การแจ้งเตือน popup', () => {
  const runA = { tripDocId: 'a', tripCode: 'T-a', date: '2026-11-01', plate: '1ฒษ-4413', driverId: 'd', driverName: 'เก๋', otherSites: [] }
  const runB = { ...runA, tripDocId: 'b', date: '2026-11-03' }
  it('แจ้งเฉพาะเที่ยวแรกของรายการที่รอรถ และไม่ซ้ำกับที่เคยแจ้งบนเครื่องนี้', () => {
    const entries = [
      { parcel: parcel(), runs: [runA, runB] },
      { parcel: parcel({ id: 'p2', status: 'handed' }), runs: [runA] },
      { parcel: parcel({ id: 'p3' }), runs: [] },
      { parcel: parcel({ id: 'p4', item: 'จอ' }), runs: [runB] },
    ]
    expect(pendingParcelAlerts(entries, new Set()).map(a => a.key)).toEqual(['p1:a', 'p4:b'])
    expect(pendingParcelAlerts(entries, new Set(['p1:a'])).map(a => a.key)).toEqual(['p4:b'])
  })
  it('ข้อความ: รายการเดียวบอกไซต์/วัน/ของ/รถ · หลายรายการบอกจำนวน', () => {
    const one = parcelAlertMessage([{ key: 'p1:a', parcelId: 'p1', item: 'Notebook', siteName: 'DRF สามพราน', run: runA }], TODAY)
    expect(one.title).toBe('มีรถไป DRF สามพราน พรุ่งนี้')
    expect(one.body).toContain('Notebook')
    expect(one.body).toContain('1ฒษ-4413')
    const many = parcelAlertMessage([
      { key: 'p1:a', parcelId: 'p1', item: 'Notebook', siteName: 'DRF', run: runA },
      { key: 'p4:b', parcelId: 'p4', item: 'จอ', siteName: 'ไซต์ Y', run: runB },
    ], TODAY)
    expect(many.title).toBe('มีรถไปไซต์ที่คุณฝากของ 2 รายการ')
    expect(many.body).toContain('จอ → ไซต์ Y')
  })
})

describe('วันที่', () => {
  it('runDateLabel: วันนี้ / พรุ่งนี้ / วันในสัปดาห์ + วันที่', () => {
    expect(runDateLabel(TODAY, TODAY)).toBe('วันนี้')
    expect(runDateLabel('2026-11-01', TODAY)).toBe('พรุ่งนี้')
    expect(runDateLabel('2026-11-02', TODAY)).toBe('จ. 2 พ.ย.')
  })
  it('addDaysIso ข้ามเดือน/ปี', () => {
    expect(addDaysIso('2026-10-31', 14)).toBe('2026-11-14')
    expect(addDaysIso('2026-12-25', 10)).toBe('2027-01-04')
  })
})
