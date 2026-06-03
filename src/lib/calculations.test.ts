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
  type TripLike,
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
