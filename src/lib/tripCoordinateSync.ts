import type { Site, Trip } from '@/types/models'

export interface CoordinatePair { lat: number | null; lng: number | null }
export interface CoordinateSelection { stopIndex: number; siteId: string; latitude: number; longitude: number }
export interface CoordinateSyncCommand {
  operationId: string
  tripId: string
  baseline: string
  selections: CoordinateSelection[]
}
export interface CoordinatePreview {
  stopIndex: number
  siteId: string
  siteName: string
  from: CoordinatePair
  to: CoordinatePair
  reason: string | null
}

export function validCoordinates(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180
}

export function canSyncTripCoordinates(trip: Trip): boolean {
  return (trip.status === 'Planned' || trip.status === 'In Progress') && trip.gpsEndAt == null
}

// Compare every job field except the dispatcher's independently editable notes.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export function coordinateSyncBaseline(trip: Trip): string {
  return canonical({
    date: trip.tripDate || (trip as Trip & { date?: string }).date,
    status: trip.status, gpsEndAt: trip.gpsEndAt ?? null, queueLink: trip.queueLink ?? null,
    stops: (trip.stops || []).map(({ dispatcherNote: _note, dispatcherName: _name, ...stop }) => stop),
  })
}

export async function coordinateSyncDigest(trip: Trip): Promise<string> {
  const bytes = new TextEncoder().encode(coordinateSyncBaseline(trip))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

export function coordinateSyncPreview(trip: Trip, sites: Site[]): CoordinatePreview[] {
  const byId = new Map(sites.map(site => [site.id, site]))
  return (trip.stops || []).map((stop, stopIndex) => {
    const site = byId.get(stop.siteId)
    const from = { lat: numberOrNull(stop.lat), lng: numberOrNull(stop.lng) }
    const to = { lat: numberOrNull(site?.latitude), lng: numberOrNull(site?.longitude) }
    const reason = !canSyncTripCoordinates(trip) ? 'ใบคิวจบหรือยกเลิกแล้ว'
      : stop.outcome ? 'จุดนี้ปิดผลงานแล้ว'
      : !site ? 'ไม่พบสถานที่ที่เชื่อมกับจุดนี้'
      : !validCoordinates(site.latitude, site.longitude) ? 'สถานที่ยังไม่มีพิกัดที่ถูกต้อง'
      : stop.lat === site.latitude && stop.lng === site.longitude ? 'ใช้พิกัดล่าสุดแล้ว' : null
    return { stopIndex, siteId: stop.siteId, siteName: stop.siteName, from, to, reason }
  })
}
