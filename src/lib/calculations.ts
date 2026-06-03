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

// ---------------------------------------------------------------------------
// Actual-outcome reconciliation
// ---------------------------------------------------------------------------

/** Minimal stop shape needed for outcome aggregation. */
export interface OutcomeStopLike {
  outcome?: string | null
  reassignedToTripId?: string | null
}

/** Minimal trip shape needed for outcome aggregation. */
export interface OutcomeTripLike {
  id?: string
  totalDistanceKm?: number | null
  stops?: OutcomeStopLike[] | null
}

/**
 * Crude per-stop distance share for a trip: `totalDistanceKm / stopCount`.
 * Mirrors the allocation already used by the report page (report/page.tsx),
 * so we stay consistent without re-querying Google Maps when jobs move.
 */
export function stopShareKm(trip: OutcomeTripLike): number {
  const stopCount = trip.stops?.length || 0
  if (stopCount === 0) return 0
  return (trip.totalDistanceKm || 0) / stopCount
}

/** A stop with no recorded outcome (or 'delivered') counts as run-as-planned. */
function isDeliveredOutcome(outcome?: string | null): boolean {
  return !outcome || outcome === 'delivered'
}

export interface OutcomeStats {
  counts: {
    delivered: number
    reassigned: number
    postponed: number
    refused: number
    /** Anything that is not 'delivered' (i.e. dispatcher marked an exception). */
    exceptions: number
    total: number
  }
  /** Planned km per trip id (= totalDistanceKm). */
  plannedKmByTrip: Record<string, number>
  /**
   * Actual km credited to each trip's vehicle: its own delivered stops plus
   * any stops reassigned *into* it. Postponed / refused stops are driven by
   * nobody and contribute 0.
   */
  actualKmByTrip: Record<string, number>
  totalPlannedKm: number
  totalActualKm: number
}

/**
 * Aggregate actual outcomes across a day's trips.
 *
 * Distance follows the work: when a stop is reassigned to another truck its
 * per-stop share moves to that truck (if it is one of the supplied trips).
 * Postponed and driver-refused stops are not driven, so their share is dropped.
 */
export function computeOutcomeStats(trips: OutcomeTripLike[]): OutcomeStats {
  const plannedKmByTrip: Record<string, number> = {}
  const actualKmByTrip: Record<string, number> = {}
  const counts = { delivered: 0, reassigned: 0, postponed: 0, refused: 0, exceptions: 0, total: 0 }

  const tripIds = new Set(trips.map((t) => t.id).filter(Boolean) as string[])

  for (const trip of trips) {
    const id = trip.id || ''
    plannedKmByTrip[id] = trip.totalDistanceKm || 0
    if (!(id in actualKmByTrip)) actualKmByTrip[id] = 0
  }

  for (const trip of trips) {
    const id = trip.id || ''
    const share = stopShareKm(trip)

    for (const stop of trip.stops || []) {
      counts.total += 1
      const outcome = stop.outcome

      if (isDeliveredOutcome(outcome)) {
        counts.delivered += 1
        actualKmByTrip[id] += share
        continue
      }

      counts.exceptions += 1
      // Distance follows the job: whenever a stop was handed to another truck
      // — an operational โยกงาน, or a refusal that someone else picked up —
      // credit that truck. Postponed / unpicked refusals are driven by nobody.
      const target = stop.reassignedToTripId || ''
      if (target && tripIds.has(target)) {
        actualKmByTrip[target] = (actualKmByTrip[target] || 0) + share
      }
      if (outcome === 'reassigned') counts.reassigned += 1
      else if (outcome === 'postponed') counts.postponed += 1
      else if (outcome === 'driver-refused') counts.refused += 1
    }
  }

  const totalPlannedKm = Object.values(plannedKmByTrip).reduce((a, b) => a + b, 0)
  const totalActualKm = Object.values(actualKmByTrip).reduce((a, b) => a + b, 0)

  return { counts, plannedKmByTrip, actualKmByTrip, totalPlannedKm, totalActualKm }
}
