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
  type TripLike,
  type OutcomeTripLike,
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
