import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FUEL_RATE,
  DEFAULT_DIESEL_PRICE,
  resolveFuelRate,
  resolveDieselPrice,
  calculateFuelCost,
  sumDistance,
  sumStops,
  isDateInRange,
  formatTripSequence,
  nextStopOrder,
  stopShareKm,
  computeOutcomeStats,
  monthRange,
  computeDriverLeaderboard,
  computeDriverReliability,
  type TripLike,
  type OutcomeTripLike,
  type LeaderboardTripLike,
} from './calculations'

describe('resolveFuelRate', () => {
  it('uses the provided rate when positive', () => {
    expect(resolveFuelRate(8)).toBe(8)
  })
  it('falls back to default when missing, zero, or negative', () => {
    expect(resolveFuelRate(undefined)).toBe(DEFAULT_FUEL_RATE)
    expect(resolveFuelRate(null)).toBe(DEFAULT_FUEL_RATE)
    expect(resolveFuelRate(0)).toBe(DEFAULT_FUEL_RATE)
    expect(resolveFuelRate(-5)).toBe(DEFAULT_FUEL_RATE)
  })
})

describe('resolveDieselPrice', () => {
  it('uses the provided price when positive', () => {
    expect(resolveDieselPrice(40)).toBe(40)
  })
  it('falls back to default when missing or non-positive', () => {
    expect(resolveDieselPrice(undefined)).toBe(DEFAULT_DIESEL_PRICE)
    expect(resolveDieselPrice(0)).toBe(DEFAULT_DIESEL_PRICE)
  })
})

describe('calculateFuelCost', () => {
  it('applies (distance / rate) * price', () => {
    // 100 km / 10 km-per-litre * 32.5 THB = 325 THB
    expect(calculateFuelCost(100, 10, 32.5)).toBe(325)
  })
  it('uses defaults when rate/price omitted', () => {
    expect(calculateFuelCost(20)).toBe((20 / DEFAULT_FUEL_RATE) * DEFAULT_DIESEL_PRICE)
  })
  it('returns 0 for missing or non-positive distance', () => {
    expect(calculateFuelCost(0)).toBe(0)
    expect(calculateFuelCost(undefined)).toBe(0)
    expect(calculateFuelCost(null)).toBe(0)
    expect(calculateFuelCost(-10)).toBe(0)
  })
  it('matches the inline formula used in the report page', () => {
    const distance = 137.4
    const rate = 12
    const price = 31.9
    expect(calculateFuelCost(distance, rate, price)).toBeCloseTo((distance / rate) * price, 6)
  })
})

describe('sumDistance', () => {
  it('sums totalDistanceKm and ignores missing values', () => {
    const trips: TripLike[] = [
      { totalDistanceKm: 10 },
      { totalDistanceKm: 5.5 },
      {},
      { totalDistanceKm: null },
    ]
    expect(sumDistance(trips)).toBe(15.5)
  })
  it('returns 0 for an empty list', () => {
    expect(sumDistance([])).toBe(0)
  })
})

describe('sumStops', () => {
  it('counts stops across trips', () => {
    const trips: TripLike[] = [
      { stops: [{ siteName: 'A' }, { siteName: 'B' }] },
      { stops: [{ siteName: 'C' }] },
      { stops: null },
      {},
    ]
    expect(sumStops(trips)).toBe(3)
  })
})

describe('isDateInRange', () => {
  it('is inclusive of both ends', () => {
    expect(isDateInRange('2026-06-01', '2026-06-01', '2026-06-30')).toBe(true)
    expect(isDateInRange('2026-06-30', '2026-06-01', '2026-06-30')).toBe(true)
  })
  it('excludes dates outside the range', () => {
    expect(isDateInRange('2026-05-31', '2026-06-01', '2026-06-30')).toBe(false)
    expect(isDateInRange('2026-07-01', '2026-06-01', '2026-06-30')).toBe(false)
  })
})

describe('formatTripSequence', () => {
  it('produces a 1-based zero-padded sequence', () => {
    expect(formatTripSequence(0)).toBe('001')
    expect(formatTripSequence(8)).toBe('009')
    expect(formatTripSequence(11)).toBe('012')
  })
  it('does not truncate sequences past 999', () => {
    expect(formatTripSequence(999)).toBe('1000')
  })
})

describe('nextStopOrder', () => {
  it('starts at 1 when there are no stops', () => {
    expect(nextStopOrder([])).toBe(1)
    expect(nextStopOrder(null)).toBe(1)
    expect(nextStopOrder(undefined)).toBe(1)
  })
  it('returns one past the current maximum order', () => {
    expect(nextStopOrder([{ order: 1 }, { order: 3 }, { order: 2 }])).toBe(4)
  })
  it('treats missing order values as 0', () => {
    expect(nextStopOrder([{}, { order: 2 }])).toBe(3)
  })
})

describe('stopShareKm', () => {
  it('divides total distance by the number of stops', () => {
    expect(stopShareKm({ totalDistanceKm: 80, stops: [{}, {}, {}, {}] })).toBe(20)
  })
  it('returns 0 when there are no stops or no distance', () => {
    expect(stopShareKm({ totalDistanceKm: 80, stops: [] })).toBe(0)
    expect(stopShareKm({ totalDistanceKm: 80, stops: null })).toBe(0)
    expect(stopShareKm({ stops: [{}, {}] })).toBe(0)
  })
})

describe('computeOutcomeStats', () => {
  it('treats unset and delivered outcomes as run-as-planned', () => {
    const trips: OutcomeTripLike[] = [
      { id: 'A', totalDistanceKm: 40, stops: [{}, { outcome: 'delivered' }] },
    ]
    const { counts, actualKmByTrip, totalActualKm } = computeOutcomeStats(trips)
    expect(counts.delivered).toBe(2)
    expect(counts.exceptions).toBe(0)
    expect(actualKmByTrip['A']).toBe(40)
    expect(totalActualKm).toBe(40)
  })

  it('moves a reassigned stop’s km share to the receiving truck', () => {
    const trips: OutcomeTripLike[] = [
      // 4 stops, 80km -> 20km/stop. Stop 3 reassigned to B, stop 4 refused.
      {
        id: 'A',
        totalDistanceKm: 80,
        stops: [
          {},
          {},
          { outcome: 'reassigned', reassignedToTripId: 'B' },
          { outcome: 'driver-refused' },
        ],
      },
      { id: 'B', totalDistanceKm: 30, stops: [{}, {}] }, // 15km/stop
    ]
    const { counts, actualKmByTrip } = computeOutcomeStats(trips)
    expect(counts.reassigned).toBe(1)
    expect(counts.refused).toBe(1)
    // A keeps only its 2 delivered stops = 40km
    expect(actualKmByTrip['A']).toBe(40)
    // B keeps its own 30km + 20km share moved in from A
    expect(actualKmByTrip['B']).toBe(50)
  })

  it('drops postponed and refused km (driven by nobody)', () => {
    const trips: OutcomeTripLike[] = [
      { id: 'A', totalDistanceKm: 60, stops: [{}, { outcome: 'postponed' }, { outcome: 'driver-refused' }] },
    ]
    const { actualKmByTrip, totalActualKm, totalPlannedKm, counts } = computeOutcomeStats(trips)
    expect(counts.postponed).toBe(1)
    expect(actualKmByTrip['A']).toBe(20) // only 1 of 3 stops driven
    expect(totalActualKm).toBe(20)
    expect(totalPlannedKm).toBe(60)
  })

  it('credits the receiving truck when a refused stop is picked up by someone else', () => {
    const trips: OutcomeTripLike[] = [
      // A: 2 stops, 40km -> 20km/stop. Stop 2 refused but picked up by B.
      { id: 'A', totalDistanceKm: 40, stops: [{}, { outcome: 'driver-refused', reassignedToTripId: 'B' }] },
      { id: 'B', totalDistanceKm: 20, stops: [{}] }, // 20km/stop
    ]
    const { counts, actualKmByTrip } = computeOutcomeStats(trips)
    expect(counts.refused).toBe(1) // still flagged as a refusal (accountability kept)
    expect(actualKmByTrip['A']).toBe(20) // A only keeps its one delivered stop
    expect(actualKmByTrip['B']).toBe(40) // B's own 20km + 20km moved in from A
  })

  it('does not credit km when the reassign target is not in the set', () => {
    const trips: OutcomeTripLike[] = [
      { id: 'A', totalDistanceKm: 40, stops: [{}, { outcome: 'reassigned', reassignedToTripId: 'Z' }] },
    ]
    const { actualKmByTrip, totalActualKm } = computeOutcomeStats(trips)
    expect(actualKmByTrip['A']).toBe(20)
    expect(totalActualKm).toBe(20)
  })
})

describe('monthRange', () => {
  it('returns the first and last day of the month', () => {
    expect(monthRange('2026-06-03')).toEqual({ start: '2026-06-01', end: '2026-06-30' })
    expect(monthRange('2026-02-15')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(monthRange('2024-02-10')).toEqual({ start: '2024-02-01', end: '2024-02-29' }) // leap year
    expect(monthRange('2026-12-31')).toEqual({ start: '2026-12-01', end: '2026-12-31' })
  })
})

describe('computeDriverLeaderboard', () => {
  it('ranks drivers by actual km driven and counts days/stops', () => {
    const trips: LeaderboardTripLike[] = [
      // Day 1
      { id: 'T1', tripDate: '2026-06-01', driverId: 'd1', driverName: 'สมชาย', totalDistanceKm: 100, stops: [{}, {}] },
      { id: 'T2', tripDate: '2026-06-01', driverId: 'd2', driverName: 'สมหญิง', totalDistanceKm: 40, stops: [{}, {}] },
      // Day 2 — สมชาย works again
      { id: 'T3', tripDate: '2026-06-02', driverId: 'd1', driverName: 'สมชาย', totalDistanceKm: 60, stops: [{}] },
    ]
    const board = computeDriverLeaderboard(trips)
    expect(board.map(b => b.driverId)).toEqual(['d1', 'd2'])
    expect(board[0]).toMatchObject({ rank: 1, actualKm: 160, completedStops: 3, workingDays: 2 })
    expect(board[1]).toMatchObject({ rank: 2, actualKm: 40, completedStops: 2, workingDays: 1 })
  })

  it('moves credit to the driver who actually did a reassigned/refused stop', () => {
    const trips: LeaderboardTripLike[] = [
      // d1: 2 stops, 40km -> 20/stop. stop2 refused but picked up by d2's trip.
      { id: 'A', tripDate: '2026-06-01', driverId: 'd1', driverName: 'A', totalDistanceKm: 40,
        stops: [{}, { outcome: 'driver-refused', reassignedToTripId: 'B' }] },
      { id: 'B', tripDate: '2026-06-01', driverId: 'd2', driverName: 'B', totalDistanceKm: 20, stops: [{}] },
    ]
    const board = computeDriverLeaderboard(trips)
    const a = board.find(b => b.driverId === 'd1')!
    const b = board.find(b => b.driverId === 'd2')!
    expect(a.actualKm).toBe(20)        // d1 keeps only its delivered stop
    expect(a.completedStops).toBe(1)
    expect(b.actualKm).toBe(40)        // d2's own 20 + 20 taken over from d1
    expect(b.completedStops).toBe(2)
  })
})

describe('computeDriverReliability', () => {
  it('นับผลรายคนขับ + completion/refusal rate (จุดที่ไม่มี outcome = ตามแผน)', () => {
    const trips = [
      {
        driverId: 'd1', driverName: 'สมชาย',
        stops: [
          {},                                  // ไม่มี outcome = delivered
          { outcome: 'delivered' },
          { outcome: 'driver-refused' },
          { outcome: 'postponed' },
        ],
      },
    ]
    const [a] = computeDriverReliability(trips)
    expect(a.assignedStops).toBe(4)
    expect(a.delivered).toBe(2)
    expect(a.refused).toBe(1)
    expect(a.postponed).toBe(1)
    expect(a.exceptions).toBe(2)         // 4 - delivered(2)
    expect(a.completionRate).toBe(0.5)
    expect(a.refusalRate).toBe(0.25)
  })

  it('เรียงคนปฏิเสธมากสุดขึ้นก่อน (เพื่อจับ pattern)', () => {
    const trips = [
      { driverId: 'd1', driverName: 'A', stops: [{ outcome: 'driver-refused' }] },
      { driverId: 'd2', driverName: 'B', stops: [{ outcome: 'driver-refused' }, { outcome: 'driver-refused' }] },
      { driverId: 'd3', driverName: 'C', stops: [{ outcome: 'delivered' }] },
    ]
    const ranked = computeDriverReliability(trips)
    expect(ranked.map((r) => r.driverName)).toEqual(['B', 'A', 'C'])
  })

  it('รวมหลายทริปของคนเดียวกัน + ข้ามทริปที่ไม่มีคนขับ', () => {
    const trips = [
      { driverId: 'd1', driverName: 'สมหญิง', stops: [{ outcome: 'delivered' }] },
      { driverId: 'd1', driverName: 'สมหญิง', stops: [{ outcome: 'reassigned' }] },
      { driverId: '', driverName: '', stops: [{ outcome: 'driver-refused' }] }, // ไม่มีคนขับ → ข้าม
    ]
    const result = computeDriverReliability(trips)
    expect(result).toHaveLength(1)
    expect(result[0].assignedStops).toBe(2)
    expect(result[0].reassigned).toBe(1)
    expect(result[0].refused).toBe(0)
  })
})
