/**
 * Pure calculation helpers for the LOTUS EME Transport System.
 *
 * These mirror the inline aggregation logic currently embedded in the
 * dashboard/report/trip-grouping pages so it can be unit-tested in isolation.
 * They are intentionally free of React/Firebase dependencies.
 */

/** Default kilometres travelled per litre of diesel. */
export const DEFAULT_FUEL_RATE = 10
/** Default diesel price (THB per litre). */
export const DEFAULT_DIESEL_PRICE = 32.5

/**
 * Resolve a fuel rate, falling back to the default when the value is
 * missing or non-positive. Mirrors `settings?.defaultFuelRate || 10`.
 */
export function resolveFuelRate(rate?: number | null): number {
  return rate && rate > 0 ? rate : DEFAULT_FUEL_RATE
}

/**
 * Resolve a diesel price, falling back to the default when missing or
 * non-positive. Mirrors `settings?.dieselPrice || 32.5`.
 */
export function resolveDieselPrice(price?: number | null): number {
  return price && price > 0 ? price : DEFAULT_DIESEL_PRICE
}

/**
 * Estimated fuel cost for a given distance.
 * Formula: (distance / fuelRate) * dieselPrice
 */
export function calculateFuelCost(
  distanceKm: number | undefined | null,
  fuelRate?: number | null,
  dieselPrice?: number | null
): number {
  const distance = distanceKm && distanceKm > 0 ? distanceKm : 0
  if (distance === 0) return 0
  return (distance / resolveFuelRate(fuelRate)) * resolveDieselPrice(dieselPrice)
}

/** Minimal shape of a trip needed for aggregation. */
export interface TripLike {
  totalDistanceKm?: number | null
  stops?: { siteName?: string }[] | null
  driverName?: string | null
  vehiclePlate?: string | null
}

/** Sum of distances across trips, ignoring missing values. */
export function sumDistance(trips: TripLike[]): number {
  return trips.reduce((sum, t) => sum + (t.totalDistanceKm || 0), 0)
}

/** Total number of stops across trips. */
export function sumStops(trips: TripLike[]): number {
  return trips.reduce((sum, t) => sum + (t.stops?.length || 0), 0)
}

/**
 * Whether a `YYYY-MM-DD` date string falls within an inclusive range.
 * Relies on ISO date strings being lexicographically comparable, which
 * avoids per-row `new Date()` parsing.
 */
export function isDateInRange(dateStr: string, startStr: string, endStr: string): boolean {
  return dateStr >= startStr && dateStr <= endStr
}

/**
 * Zero-padded running sequence for a trip id given how many trips already
 * exist for that date. Mirrors `String(snap.size + 1).padStart(3, '0')`.
 */
export function formatTripSequence(existingCount: number): string {
  return String(existingCount + 1).padStart(3, '0')
}

/**
 * Next `order` value when appending stops to an existing trip.
 * Mirrors the merge logic in trip-grouping.
 */
export function nextStopOrder(stops: { order?: number }[] | null | undefined): number {
  if (!stops || stops.length === 0) return 1
  return Math.max(...stops.map((s) => s.order || 0)) + 1
}
