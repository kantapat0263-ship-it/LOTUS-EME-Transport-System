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

// ---------------------------------------------------------------------------
// Driver leaderboard (monthly motivation stats)
// ---------------------------------------------------------------------------

/** Inclusive `YYYY-MM-DD` first/last day of the month that `dateStr` falls in. */
export function monthRange(dateStr: string): { start: string; end: string } {
  const [y, m] = dateStr.split('-').map(Number)
  const mm = String(m).padStart(2, '0')
  const lastDay = new Date(y, m, 0).getDate() // day 0 of next month = last day of this one
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

export interface LeaderboardTripLike extends OutcomeTripLike {
  driverId?: string | null
  driverName?: string | null
  tripDate?: string | null
}

export interface DriverStat {
  driverId: string
  driverName: string
  /** Actual km driven (work follows the truck: reassigned-in counts, moved-away does not). */
  actualKm: number
  completedStops: number
  workingDays: number
  /** 1-based rank by actualKm (desc). */
  rank: number
}

/**
 * Aggregate per-driver monthly stats and rank them by actual km driven.
 *
 * Reassignment credit is resolved per day (a job can only move to a truck
 * that ran the same day), then summed across the month. Positive metrics
 * only — refusals are never surfaced here.
 */
export function computeDriverLeaderboard(trips: LeaderboardTripLike[]): DriverStat[] {
  const byDate = new Map<string, LeaderboardTripLike[]>()
  for (const t of trips) {
    const d = t.tripDate || ''
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d)!.push(t)
  }

  interface Acc { driverId: string; driverName: string; actualKm: number; completedStops: number; days: Set<string> }
  const accs = new Map<string, Acc>()
  const ensure = (driverId: string, driverName: string): Acc => {
    let a = accs.get(driverId)
    if (!a) {
      a = { driverId, driverName, actualKm: 0, completedStops: 0, days: new Set() }
      accs.set(driverId, a)
    }
    if (driverName) a.driverName = driverName
    return a
  }

  for (const [date, dayTrips] of byDate) {
    const tripIds = new Set<string>()
    const driverByTrip = new Map<string, { driverId: string; driverName: string }>()
    for (const t of dayTrips) {
      if (t.id) {
        tripIds.add(t.id)
        driverByTrip.set(t.id, { driverId: t.driverId || '', driverName: t.driverName || '' })
      }
    }

    for (const t of dayTrips) {
      if (t.driverId) ensure(t.driverId, t.driverName || '').days.add(date)
      const share = stopShareKm(t)
      for (const stop of t.stops || []) {
        // Which truck actually performed this stop?
        let creditTripId: string | null = null
        if (isDeliveredOutcome(stop.outcome)) {
          creditTripId = t.id || null
        } else {
          const target = stop.reassignedToTripId || ''
          if (target && tripIds.has(target)) creditTripId = target
        }
        if (!creditTripId) continue
        const cd = driverByTrip.get(creditTripId)
        if (!cd || !cd.driverId) continue
        const acc = ensure(cd.driverId, cd.driverName)
        acc.actualKm += share
        acc.completedStops += 1
      }
    }
  }

  const result = Array.from(accs.values())
    .map((a) => ({
      driverId: a.driverId,
      driverName: a.driverName,
      actualKm: a.actualKm,
      completedStops: a.completedStops,
      workingDays: a.days.size,
      rank: 0,
    }))
    .sort((x, y) => y.actualKm - x.actualKm)
  result.forEach((r, i) => { r.rank = i + 1 })
  return result
}

// ---------------------------------------------------------------------------
// Driver reliability (admin-only — completion + refusal pattern)
// ---------------------------------------------------------------------------

export interface ReliabilityTripLike {
  driverId?: string | null
  driverName?: string | null
  stops?: OutcomeStopLike[] | null
}

export interface DriverReliabilityStat {
  driverId: string
  driverName: string
  /** Stops assigned to this driver's own trips (the denominator). */
  assignedStops: number
  /** Ran as planned (delivered / unset outcome). */
  delivered: number
  /** Dispatcher moved the job to another truck (โยกงาน) — not the driver's fault. */
  reassigned: number
  /** Postponed (external reason) — not the driver's fault. */
  postponed: number
  /** Driver refused the job — the metric that flags an อู้ pattern. */
  refused: number
  /** Anything that did not run as planned (= assigned - delivered). */
  exceptions: number
  /** delivered / assignedStops (0..1). */
  completionRate: number
  /** refused / assignedStops (0..1). */
  refusalRate: number
}

/**
 * Per-driver completion / refusal pattern, attributing every stop to the
 * driver it was originally assigned to (i.e. the trip's own driver).
 *
 * Unlike the public leaderboard, this is the *private admin* view: refusals
 * are counted and surfaced so a dispatcher/admin can have a quiet 1-on-1 —
 * never shown in the LINE group. Sorted by refusals (desc) so the people who
 * decline most float to the top; ties broken by refusal rate then name.
 */
export function computeDriverReliability(trips: ReliabilityTripLike[]): DriverReliabilityStat[] {
  interface Acc {
    driverId: string
    driverName: string
    assignedStops: number
    delivered: number
    reassigned: number
    postponed: number
    refused: number
  }
  const accs = new Map<string, Acc>()

  for (const t of trips) {
    const key = t.driverId || t.driverName || ''
    if (!key) continue
    let a = accs.get(key)
    if (!a) {
      a = { driverId: t.driverId || '', driverName: t.driverName || '', assignedStops: 0, delivered: 0, reassigned: 0, postponed: 0, refused: 0 }
      accs.set(key, a)
    }
    if (t.driverName) a.driverName = t.driverName

    for (const stop of t.stops || []) {
      a.assignedStops += 1
      const outcome = stop.outcome
      if (isDeliveredOutcome(outcome)) a.delivered += 1
      else if (outcome === 'reassigned') a.reassigned += 1
      else if (outcome === 'postponed') a.postponed += 1
      else if (outcome === 'driver-refused') a.refused += 1
    }
  }

  return Array.from(accs.values())
    .map((a) => {
      const exceptions = a.assignedStops - a.delivered
      return {
        driverId: a.driverId,
        driverName: a.driverName,
        assignedStops: a.assignedStops,
        delivered: a.delivered,
        reassigned: a.reassigned,
        postponed: a.postponed,
        refused: a.refused,
        exceptions,
        completionRate: a.assignedStops ? a.delivered / a.assignedStops : 0,
        refusalRate: a.assignedStops ? a.refused / a.assignedStops : 0,
      }
    })
    .sort((x, y) => y.refused - x.refused || y.refusalRate - x.refusalRate || x.driverName.localeCompare(y.driverName))
}

// ---------------------------------------------------------------------------
// Incoming reassignments (so the *destination* truck knows work moved to it)
// ---------------------------------------------------------------------------

export interface IncomingStopLike extends OutcomeStopLike {
  siteName?: string | null
  cargoDetails?: string | null
}

export interface IncomingTripLike {
  id?: string
  driverName?: string | null
  vehiclePlate?: string | null
  stops?: IncomingStopLike[] | null
}

export interface IncomingJob {
  /** Source trip the job was moved from. */
  fromTripId: string
  fromDriverName: string
  fromVehiclePlate: string
  siteName: string
  cargoDetails: string
  /** True if the source stop was a refusal someone picked up — kept for internal
   *  logic only; the destination UI must stay public-safe and never show "ปฏิเสธ". */
  wasRefused: boolean
}

/**
 * Jobs handed *to* `tripId` from other trips — the missing other half of the
 * one-directional reassignment record. We read every other trip's stops and
 * collect the ones whose `reassignedToTripId` points here, so the destination
 * driver/dispatcher can see incoming work that was never written onto this trip.
 *
 * Pure & derived: no distance is recomputed (computeOutcomeStats already credits
 * the destination truck), nothing is written — this only surfaces existing data.
 */
export function incomingStopsForTrip(allTrips: IncomingTripLike[], tripId: string): IncomingJob[] {
  if (!tripId) return []
  const out: IncomingJob[] = []
  for (const t of allTrips) {
    if (t.id === tripId) continue // a trip never reassigns to itself
    for (const s of t.stops || []) {
      if (s.reassignedToTripId === tripId) {
        out.push({
          fromTripId: t.id || '',
          fromDriverName: t.driverName || '',
          fromVehiclePlate: t.vehiclePlate || '',
          siteName: s.siteName || '',
          cargoDetails: s.cargoDetails || '',
          wasRefused: s.outcome === 'driver-refused',
        })
      }
    }
  }
  return out
}
