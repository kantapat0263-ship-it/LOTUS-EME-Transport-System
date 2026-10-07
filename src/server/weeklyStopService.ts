import { createHash } from 'node:crypto'
import { FieldValue, type Firestore, type QuerySnapshot } from 'firebase-admin/firestore'
import { aggregateWeeklyStops, buildWeeklyStopDays, type StopReview, type WeeklyDay, type WeeklyStopReport } from '@/lib/driverStopSummary'
import { OFFICE_LOCATION } from '@/lib/tracking'
import { tripRouteMode } from '@/lib/routeMode'
import type { Trip, Vehicle, VehicleTrailDoc } from '@/types/models'
import { parseStopReviewCommand, parseWeekStart, weekDates, type StopReviewCommand } from './weeklyStopValidation'
export class WeeklyStopError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409 | 422 = 409) { super(message) }
}
export async function saveStopReview(db: Firestore, input: StopReviewCommand, uid: string): Promise<{ version: number; replayed?: boolean }> {
  const command = parseStopReviewCommand(input)
  const reviewRef = db.doc(`driverStopReviews/${stopReviewId(command.dayKey, command.eventId)}`)
  const auditRef = db.doc(`driverStopReviewAudit/${command.operationId}`)
  const commandFingerprint = hash(command)
  return db.runTransaction(async tx => {
    const profile = (await tx.get(db.doc(`users/${uid}`))).data()
    if (profile?.active !== true || profile?.role !== 'admin') throw new WeeklyStopError('เฉพาะผู้ดูแลที่เปิดใช้งานเท่านั้น', 403)
    const audit = (await tx.get(auditRef)).data()
    if (audit) {
      if (audit.actorId !== uid || audit.commandFingerprint !== commandFingerprint) throw new WeeklyStopError('รหัสคำสั่งนี้ถูกใช้กับข้อมูลอื่นแล้ว')
      return { version: audit.after.version, replayed: true }
    }
    const dayDate = command.dayKey.slice(0, 10)
    const [tripSnap, trailSnap, vehiclesSnap, settingsSnap, reviewSnap] = await Promise.all([
      tx.get(db.collection('trips').where('tripDate', '==', dayDate).limit(1001)), tx.get(db.collection('vehiclePositionTrails').where('date', '==', dayDate).limit(351)), tx.get(db.collection('vehicles').limit(501)), tx.get(db.doc('companySettings/default')), tx.get(reviewRef),
    ])
    bounded(tripSnap, 1000); bounded(trailSnap, 350); bounded(vehiclesSnap, 500)
    const trips = rows<Trip>(tripSnap), trails = rows<VehicleTrailDoc>(trailSnap), vehicles = rows<Vehicle>(vehiclesSnap), office = officeFrom(settingsSnap.data())
    const day = buildWeeklyStopDays(trips, trails, vehicles, office).find(row => row.key === command.dayKey)
    const event = day?.events.find(row => row.eventId === command.eventId && row.kind === 'review')
    if (!day || !event || day.quality === 'ambiguous') throw new WeeklyStopError('จุดจอดหรืองานเปลี่ยนแล้ว กรุณาโหลดรายงานใหม่')
    if (sourceFingerprint(day, trips, trails, vehicles, office) !== command.sourceFingerprint) throw new WeeklyStopError('ข้อมูล GPS หรืองานเปลี่ยนระหว่างเปิด กรุณาโหลดรายงานใหม่')
    const previous = reviewSnap.data() as StopReview | undefined
    if ((previous?.version ?? 0) !== command.expectedVersion) throw new WeeklyStopError('เหตุผลถูกแก้ไขจากอีกหน้าจอแล้ว กรุณาโหลดรายงานใหม่')
    const version = command.expectedVersion + 1
    const next = { eventId: command.eventId, sourceFingerprint: command.sourceFingerprint, version, excluded: command.excluded, reason: command.reason, updatedBy: profile.name || uid }
    tx.set(reviewRef, { ...next, weekStart: command.weekStart, dayKey: command.dayKey, updatedAt: FieldValue.serverTimestamp() })
    tx.create(auditRef, { actorId: uid, actorName: profile.name || uid, commandFingerprint, createdAt: FieldValue.serverTimestamp(), weekStart: command.weekStart, dayKey: command.dayKey, event: { ...event, review: null }, before: previous ?? null, after: next })
    return { version }
  })
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const rows = <T>(snapshot: QuerySnapshot): T[] => snapshot.docs.map(d => ({ ...d.data(), id: d.id } as T))
const bounded = (snapshot: QuerySnapshot, maximum: number) => { if (snapshot.size > maximum) throw new WeeklyStopError('ข้อมูลสัปดาห์นี้เกินขอบเขตที่รองรับ กรุณาติดต่อผู้ดูแล', 422) }
const officeFrom = (settings: Record<string, unknown> | undefined) => {
  const lat = Number(settings?.warehouseLatitude), lng = Number(settings?.warehouseLongitude)
  return settings?.warehouseLatitude != null && settings?.warehouseLongitude != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : OFFICE_LOCATION
}
const sorted = <T extends { id: string }>(data: T[]) => [...data].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
function sourceFingerprint(day: WeeklyDay, trips: Trip[], trails: VehicleTrailDoc[], vehicles: Vehicle[], office: { lat: number; lng: number }) {
  return hash({
    key: day.key, office,
    trips: sorted(trips.filter(t => t.tripDate === day.date)).map(t => ({ id: t.id, tripDate: t.tripDate, vehiclePlate: t.vehiclePlate, driverId: t.driverId, driverName: t.driverName, actualDriverId: t.actualDriverId, actualDriverName: t.actualDriverName, status: t.status, gpsEndAt: t.gpsEndAt, routeMode: tripRouteMode(t), stops: (t.stops ?? []).map(s => ({ order: s.order, lat: s.lat, lng: s.lng, outcome: s.outcome, reassignedToTripId: s.reassignedToTripId, reassignedToVehiclePlate: s.reassignedToVehiclePlate })) })),
    trails: sorted(trails.filter(t => t.date === day.date)).map(t => ({ id: t.id, date: t.date, licensePlate: t.licensePlate, deviceId: t.deviceId, points: t.points })),
    vehicles: sorted(vehicles).map(v => ({ id: v.id, gpsDeviceId: v.gpsDeviceId, licensePlate: v.licensePlate })),
  })
}
export function stopReviewId(dayKey: string, eventId: string): string { return hash([dayKey, eventId]) }
function attachEvidence(days: WeeklyDay[], trips: Trip[], trails: VehicleTrailDoc[], vehicles: Vehicle[], office: { lat: number; lng: number }, reviews: StopReview[]) {
  return days.map(day => {
    const fingerprint = sourceFingerprint(day, trips, trails, vehicles, office)
    return { ...day, sourceFingerprint: fingerprint, events: day.events.map(event => {
      const id = stopReviewId(day.key, event.eventId)
      const review = reviews.find((row: StopReview & { id?: string }) => row.id === id)
      return { ...event, review: review ? { ...review, stale: review.sourceFingerprint !== fingerprint } : null }
    }) }
  })
}
export async function readWeeklyStopReport(db: Firestore, input: string, uid: string): Promise<WeeklyStopReport> {
  const weekStart = parseWeekStart(input), weekEnd = weekDates(weekStart)[6]
  return db.runTransaction(async tx => {
    const profile = (await tx.get(db.doc(`users/${uid}`))).data()
    if (profile?.active !== true || profile?.role !== 'admin') throw new WeeklyStopError('เฉพาะผู้ดูแลที่เปิดใช้งานเท่านั้น', 403)
    const [tripSnap, trailSnap, vehiclesSnap, reviewSnap, settingsSnap] = await Promise.all([
      tx.get(db.collection('trips').where('tripDate', '>=', weekStart).where('tripDate', '<=', weekEnd).limit(1001)),
      tx.get(db.collection('vehiclePositionTrails').where('date', '>=', weekStart).where('date', '<=', weekEnd).limit(351)),
      tx.get(db.collection('vehicles').limit(501)), tx.get(db.collection('driverStopReviews').where('weekStart', '==', weekStart).limit(2001)), tx.get(db.doc('companySettings/default')),
    ])
    bounded(tripSnap, 1000); bounded(trailSnap, 350); bounded(vehiclesSnap, 500); bounded(reviewSnap, 2000)
    const trips = rows<Trip>(tripSnap), trails = rows<VehicleTrailDoc>(trailSnap), vehicles = rows<Vehicle>(vehiclesSnap), office = officeFrom(settingsSnap.data())
    const days = attachEvidence(buildWeeklyStopDays(trips, trails, vehicles, office), trips, trails, vehicles, office, rows<StopReview>(reviewSnap))
    if (days.reduce((sum, day) => sum + day.events.length, 0) > 5000) throw new WeeklyStopError('จุดจอดมากเกินขอบเขตที่รองรับ', 422)
    return { weekStart, weekEnd, days, drivers: aggregateWeeklyStops(days) }
  })
}
