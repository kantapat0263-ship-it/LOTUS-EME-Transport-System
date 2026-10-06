import { createHash } from 'node:crypto'
import { FieldValue, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { expandQueueDates, MAX_QUEUE_DAYS, queueNotice, resourceGuardKeys } from '@/lib/continuousQueue'
import type { ContinuousBooking, QueueAuditEvent, QueueCommand, QueueCommandResult, QueueResourceGuard, QueueSnapshot, QueueSourceAssignment, QueueTripInput } from '@/types/continuous-queue'
import type { Trip } from '@/types/models'
import { assertRequestDestinationsUnchanged } from '@/lib/requestDestination'

const MAX_SNAPSHOT_BOOKINGS = 500
const MAX_DAY_TRIPS = 500
const GROUPABLE = new Set(['pending', 'in_progress', 'partial', 'rescheduled'])
type Actor = { id: string; name: string }
type Write = { collection: string; id: string; data: DocumentData; merge?: boolean }

export class QueueServiceError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 409) { super(message); this.name = 'QueueServiceError' }
}

function requireValue(condition: unknown, message: string, status: 400 | 409 = 409): asserts condition {
  if (!condition) throw new QueueServiceError(message, status)
}

function dateValue(date: string): string {
  try { expandQueueDates(date, date) } catch { throw new QueueServiceError('วันที่ไม่ถูกต้อง', 400) }
  return date
}

function rangeDates(from: string, to: string): string[] {
  try { return expandQueueDates(from, to) } catch (error) { throw new QueueServiceError(error instanceof Error ? error.message : 'ช่วงวันที่ไม่ถูกต้อง', 400) }
}

function unstarted(trip: Trip): boolean {
  return trip.status === 'Planned' && trip.gpsEndAt == null && !trip.actualDriverId && !trip.actualDriverName && !trip.vehicleChangedFromPlate && !hasRecordedWork(trip.stops)
}

function hasRecordedWork(stops: Trip['stops']): boolean {
  const fields = ['outcome', 'outcomeReason', 'outcomeAt', 'outcomeRecordedBy', 'actualCargoDescription', 'reassignedToTripId', 'reassignedToVehiclePlate', 'reassignedToDriverName', 'postponedToDate', 'postponedRequestId'] as const
  return stops.some(stop => fields.some(key => !!stop[key]))
}

function planningStops(stops: Trip['stops']): Trip['stops'] {
  const fields = ['siteId', 'siteName', 'cargoDetails', 'lat', 'lng', 'requestedBy', 'requestedByPhone', 'requestedByUserId', 'requestedAt', 'requestTime', 'address', 'note', 'dispatcherNote', 'dispatcherName'] as const
  return stops.map((stop, index) => ({ ...Object.fromEntries(fields.filter(key => stop[key] !== undefined).map(key => [key, stop[key]])), order: index + 1 }) as Trip['stops'][number])
}

function reservedDayInput(template: QueueTripInput, date: string): QueueTripInput {
  // Reserving an onsite day does not establish another journey from the depot.
  const input: QueueTripInput = { ...template, tripDate: date, totalDistanceKm: 0, totalEstimatedTimeMinutes: 0, fuelCost: 0 }
  if (template.stops.length === 1) {
    const site = template.stops[0]
    input.departurePoint = site.siteName
    if (typeof site.lat === 'number' && Number.isFinite(site.lat) && typeof site.lng === 'number' && Number.isFinite(site.lng)) {
      input.originLat = site.lat
      input.originLng = site.lng
    } else {
      delete input.originLat
      delete input.originLng
    }
  }
  return input
}

function documentId(value: string): string {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') && value !== '.' && value !== '..', 'รหัสข้อมูลไม่ถูกต้อง', 400)
  return value
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, withoutUndefined(item)])) as T
  return value
}

class QueueTransaction {
  readonly writes: Write[] = []
  auditDate?: string
  private readonly guards = new Map<string, QueueResourceGuard>()
  private readonly reservations = new Map<string, { bookingId: string; tripId: string } | null>()
  private readonly dailyTrips = new Map<string, Trip[]>()
  constructor(readonly db: Firestore, readonly tx: Transaction, readonly actor: Actor, readonly today: string, readonly stamp: string) {}

  async read<T>(collection: string, id: string): Promise<T | undefined> {
    const snap = await this.tx.get(this.db.collection(collection).doc(documentId(id)))
    return snap.exists ? { ...snap.data(), id: snap.id } as T : undefined
  }

  async trips(date: string): Promise<Trip[]> {
    const cached = this.dailyTrips.get(date)
    if (cached) return cached
    const found = new Map<string, Trip>()
    for (const field of ['tripDate', 'date']) {
      const snap = await this.tx.get(this.db.collection('trips').where(field, '==', date).limit(MAX_DAY_TRIPS + 1))
      requireValue(snap.size <= MAX_DAY_TRIPS, 'ข้อมูลคิววันนี้มากเกินกว่าจะตรวจความพร้อมได้ กรุณาติดต่อผู้ดูแล')
      for (const doc of snap.docs) found.set(doc.id, { ...doc.data(), id: doc.id, tripDate: doc.data().tripDate || doc.data().date } as Trip)
    }
    requireValue(found.size <= MAX_DAY_TRIPS, 'ข้อมูลคิววันนี้มากเกินกว่าจะตรวจความพร้อมได้ กรุณาติดต่อผู้ดูแล')
    const trips = [...found.values()].filter(trip => trip.tripDate === date)
    this.dailyTrips.set(date, trips)
    return trips
  }

  async guard(key: string): Promise<QueueResourceGuard> {
    const cached = this.guards.get(key)
    if (cached) return cached
    const snap = await this.tx.get(this.db.collection('queueResourceDays').doc(key))
    const data = snap.exists ? snap.data() as QueueResourceGuard : { version: 0 }
    requireValue(Number.isSafeInteger(data.version) && data.version >= 0, 'ข้อมูลล็อกคิวไม่ถูกต้อง กรุณาติดต่อผู้ดูแล')
    this.guards.set(key, data)
    return data
  }

  async reserve(input: Pick<Trip, 'tripDate' | 'driverId' | 'vehicleId'>, bookingId: string, tripId: string, ignoreTripIds: string[] = []): Promise<void> {
    const trips = await this.trips(input.tripDate)
    requireValue(!trips.some(t => !ignoreTripIds.includes(t.id) && t.status !== 'Cancelled' && ((t.actualDriverId || t.driverId) === input.driverId || t.vehicleId === input.vehicleId)), `คนขับหรือรถมีคิวอยู่แล้ว วันที่ ${input.tripDate}`)
    for (const key of resourceGuardKeys(input)) {
      const guard = await this.guard(key)
      requireValue(!guard.bookingId || (guard.bookingId === bookingId && !!guard.tripId && ignoreTripIds.includes(guard.tripId)), `คนขับหรือรถถูกจองคิวต่อเนื่องแล้ว วันที่ ${input.tripDate}`)
      this.reservations.set(key, { bookingId, tripId })
    }
  }

  async resources(input: QueueTripInput): Promise<QueueTripInput> {
    requireValue(Array.isArray(input.stops) && input.stops.length > 0 && input.stops.length <= 100, 'ต้องมีจุดหมาย 1–100 จุด', 400)
    requireValue(!hasRecordedWork(input.stops), 'คิวใหม่ต้องไม่มีผลการทำงานที่บันทึกไว้', 400)
    documentId(input.driverId); documentId(input.vehicleId); dateValue(input.tripDate)
    const driver = await this.read<{ name: string }>('drivers', input.driverId)
    const vehicle = await this.read<{ licensePlate: string; type: string }>('vehicles', input.vehicleId)
    requireValue(driver?.name && vehicle?.licensePlate, 'คนขับหรือรถที่เลือกไม่มีในระบบ')
    const trip: QueueTripInput = {
      tripDate: input.tripDate, driverId: input.driverId, driverName: driver.name, vehicleId: input.vehicleId,
      vehiclePlate: vehicle.licensePlate, vehicleType: vehicle.type, stops: planningStops(input.stops),
    }
    for (const key of ['totalDistanceKm', 'totalEstimatedTimeMinutes', 'fuelCost', 'dieselPriceUsed', 'fuelRateUsed', 'departurePoint', 'originLat', 'originLng'] as const) {
      if (input[key] !== undefined) Object.assign(trip, { [key]: input[key] })
    }
    return withoutUndefined(trip)
  }

  async booking(id: string): Promise<ContinuousBooking> {
    const booking = await this.read<ContinuousBooking>('continuousBookings', id)
    requireValue(booking, 'ไม่พบคิวต่อเนื่อง')
    return booking
  }

  async originalDay(booking: ContinuousBooking, date: string): Promise<Trip> {
    dateValue(date)
    requireValue(date >= booking.startDate && date <= booking.endDate && !!booking.dayTripIds[date], 'วันที่เลือกอยู่นอกช่วงคิวเดิม')
    const original = await this.read<Trip>('trips', booking.dayTripIds[date])
    requireValue(original && original.queueLink?.bookingId === booking.id && original.queueLink.kind === 'day' && original.tripDate === date, 'ไม่พบใบคิวรายวันที่ตรงกับคิวเดิม')
    return original
  }

  async preserveReservations(trip: Trip, bookingId: string): Promise<void> {
    for (const key of resourceGuardKeys(trip)) {
      const guard = await this.guard(key)
      requireValue(guard.bookingId === bookingId && guard.tripId === trip.id, 'ข้อมูลล็อกคนขับหรือรถไม่ตรงกับใบคิว กรุณารีเฟรช')
      this.reservations.set(key, { bookingId, tripId: trip.id })
    }
  }

  async newTripId(date: string): Promise<string> {
    const daily = await this.trips(date)
    const prefix = `T-${date.slice(8, 10)}${date.slice(5, 7)}-`
    for (let sequence = daily.length + 1; sequence <= daily.length + 2000; sequence++) {
      const id = `${prefix}${String(sequence).padStart(3, '0')}0`
      const exists = await this.tx.get(this.db.collection('trips').doc(id))
      if (!exists.exists) return id
    }
    throw new QueueServiceError('จองรหัสเที่ยววิ่งไม่ได้ กรุณาติดต่อผู้ดูแล')
  }

  async assignSources(assignments: QueueSourceAssignment[], input: QueueTripInput, tripIds: string[]): Promise<string[]> {
    requireValue(assignments.length <= 100, 'จำนวนใบขอมากเกินไป', 400)
    requireValue(assignments.length === 0 || assignments.reduce((count, item) => count + item.destinationIndexes.length, 0) === input.stops.length, 'จำนวนจุดหมายไม่ตรงกับใบขอที่เลือก', 400)
    const seen = new Set<string>()
    const vrIds: string[] = []
    for (const assignment of assignments) {
      requireValue(!seen.has(assignment.requestId), 'เลือกใบขอซ้ำ', 400)
      seen.add(assignment.requestId)
      const request = await this.read<DocumentData>('vehicleRequests', assignment.requestId)
      requireValue(request && GROUPABLE.has(request.status), 'ใบขอที่เลือกถูกยกเลิกหรือเปลี่ยนสถานะแล้ว')
      requireValue(request.requestDate === input.tripDate, 'ใบขอที่เลือกต้องเป็นวันเริ่มคิวเดียวกัน')
      requireValue(Array.isArray(request.destinations), 'ข้อมูลจุดหมายในใบขอไม่ถูกต้อง')
      const indexes = assignment.destinationIndexes
      const assigned: number[] = request.assignedDestinations || []
      requireValue(indexes.length > 0 && new Set(indexes).size === indexes.length && indexes.every(index => Number.isSafeInteger(index) && index >= 0 && index < request.destinations.length && !assigned.includes(index)), 'จุดหมายถูกจัดรถแล้วหรือไม่พบในใบขอ')
      try { assertRequestDestinationsUnchanged(request, indexes, assignment.expectedDestinationFingerprints) }
      catch (error) { throw new QueueServiceError(error instanceof Error ? error.message : 'ข้อมูลจุดหมายเปลี่ยนแล้ว กรุณาเลือกงานใหม่') }
      const humanId = request.requestId || request.vrId
      requireValue(typeof humanId === 'string' && !!humanId, 'ใบขอไม่มีรหัสอ้างอิง')
      vrIds.push(humanId)
      const newAssigned = [...new Set([...assigned, ...indexes])]
      const complete = newAssigned.length === request.destinations.length
      const oldTripIds = Array.isArray(request.tripIds) ? request.tripIds : request.tripId ? [request.tripId] : []
      this.writes.push({ collection: 'vehicleRequests', id: assignment.requestId, merge: true, data: {
        assignedDestinations: newAssigned, status: complete ? 'approved' : 'partial',
        tripId: complete ? tripIds[0] : request.tripId || null, tripIds: [...new Set([...oldTripIds, ...tripIds])], updatedAt: FieldValue.serverTimestamp(),
      } })
    }
    return [...new Set(vrIds)]
  }

  async unassignSources(assignments: QueueSourceAssignment[], tripId: string): Promise<void> {
    for (const assignment of assignments) {
      const request = await this.read<DocumentData>('vehicleRequests', assignment.requestId)
      if (!request) continue
      const assigned = (request.assignedDestinations || []).filter((index: number) => !assignment.destinationIndexes.includes(index))
      const tripIds = (Array.isArray(request.tripIds) ? request.tripIds : request.tripId ? [request.tripId] : []).filter((id: string) => id !== tripId)
      const status = request.status === 'cancelled' || request.status === 'rejected' ? request.status : assigned.length === 0 ? 'in_progress' : assigned.length === request.destinations.length ? 'approved' : 'partial'
      this.writes.push({ collection: 'vehicleRequests', id: assignment.requestId, merge: true, data: { assignedDestinations: assigned, tripIds, tripId: request.tripId === tripId ? tripIds[0] || null : request.tripId || null, status, updatedAt: FieldValue.serverTimestamp() } })
    }
  }

  plannedTrip(input: QueueTripInput, id: string, bookingId: string, kind: 'day' | 'borrow' | 'compensation', originalDate?: string): Trip {
    const departureSiteId = input.stops.length === 1 && input.departurePoint === input.stops[0].siteName ? input.stops[0].siteId || '' : ''
    const trip: Trip = withoutUndefined({ ...input, id, tripId: id, departureSiteId, status: 'Planned', requestedBy: this.actor.name,
      queueLink: { bookingId, kind, date: input.tripDate, originalDate } })
    return { ...trip, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }
  }

  async create(command: Extract<QueueCommand, { action: 'create' }>): Promise<{ booking: ContinuousBooking; result: QueueCommandResult }> {
    const dates = rangeDates(command.trip.tripDate, command.endDate)
    requireValue(dates[0] >= this.today, 'สร้างคิวต่อเนื่องย้อนหลังไม่ได้')
    const input = await this.resources(command.trip)
    const id = `BQ-${command.operationId}`
    requireValue(!(await this.read('continuousBookings', id)), 'รหัสคิวต่อเนื่องถูกใช้แล้ว')
    const dayTripIds: Record<string, string> = {}
    for (const date of dates) {
      const tripId = await this.newTripId(date)
      dayTripIds[date] = tripId
      await this.reserve({ ...input, tripDate: date }, id, tripId)
    }
    const tripIds = Object.values(dayTripIds)
    input.sourceVRIds = await this.assignSources(command.assignments, input, tripIds)
    for (const date of dates) this.writes.push({ collection: 'trips', id: dayTripIds[date], data: this.plannedTrip(date === dates[0] ? input : reservedDayInput(input, date), dayTripIds[date], id, 'day') })
    const booking: ContinuousBooking = { id, startDate: dates[0], endDate: command.endDate, driverId: input.driverId, driverName: input.driverName, vehicleId: input.vehicleId,
      vehiclePlate: input.vehiclePlate, siteName: input.stops[0].siteName, dayTripIds, overrides: {}, template: input, createdBy: this.actor.id, createdAt: this.stamp }
    return { booking, result: { bookingId: id, tripIds } }
  }

  async extend(command: Extract<QueueCommand, { action: 'extend' }>): Promise<{ booking: ContinuousBooking; result: QueueCommandResult }> {
    const stored = await this.read<Trip & { date?: string }>('trips', command.tripId)
    const original = stored ? { ...stored, tripDate: stored.tripDate || stored.date || '' } : undefined
    requireValue(original && !original.queueLink && unstarted(original), 'ขยายได้เฉพาะคิวเดิมที่ยังไม่เริ่มงานและไม่มีการเปลี่ยนคนขับหรือรถ')
    const dates = rangeDates(original.tripDate, command.endDate)
    requireValue(dates[0] >= this.today && dates.length > 1, 'ระบุวันสิ้นสุดหลังวันเริ่ม และห้ามขยายคิวย้อนหลัง')
    const input = await this.resources({ ...original, stops: planningStops(original.stops) })
    input.sourceVRIds = original.sourceVRIds || []
    const id = `BQ-${command.operationId}`
    requireValue(!(await this.read('continuousBookings', id)), 'รหัสคิวต่อเนื่องถูกใช้แล้ว')
    const dayTripIds: Record<string, string> = {}
    for (const date of dates) {
      const tripId = date === original.tripDate ? original.id : await this.newTripId(date)
      dayTripIds[date] = tripId
      await this.reserve({ ...input, tripDate: date }, id, tripId, date === original.tripDate ? [original.id] : [])
    }
    const tripIds = Object.values(dayTripIds)
    const requests = new Map<string, DocumentData>()
    for (const field of ['tripId', 'tripIds'] as const) {
      const snapshot = await this.tx.get(this.db.collection('vehicleRequests').where(field, field === 'tripIds' ? 'array-contains' : '==', original.id).limit(101))
      requireValue(snapshot.size <= 100, 'ใบขอที่ผูกกับคิวมากเกินกว่าจะตรวจครบได้')
      for (const doc of snapshot.docs) requests.set(doc.id, doc.data())
    }
    requireValue(input.sourceVRIds.length <= 100, 'ใบขอที่ผูกกับคิวมากเกินกว่าจะตรวจครบได้')
    for (let offset = 0; offset < input.sourceVRIds.length; offset += 30) {
      for (const field of ['requestId', 'vrId']) {
        const snapshot = await this.tx.get(this.db.collection('vehicleRequests').where(field, 'in', input.sourceVRIds.slice(offset, offset + 30)).limit(101))
        requireValue(snapshot.size <= 100, 'ใบขอที่ผูกกับคิวมากเกินกว่าจะตรวจครบได้')
        for (const doc of snapshot.docs) requests.set(doc.id, doc.data())
      }
    }
    requireValue(requests.size <= 100, 'ใบขอที่ผูกกับคิวมากเกินกว่าจะตรวจครบได้')
    for (const [requestId, request] of requests) {
      requireValue(request.status !== 'cancelled' && request.status !== 'rejected', 'ใบขอเดิมถูกยกเลิกแล้ว จึงขยายคิวไม่ได้')
      const previous = Array.isArray(request.tripIds) ? request.tripIds : request.tripId ? [request.tripId] : []
      this.writes.push({ collection: 'vehicleRequests', id: requestId, merge: true, data: { tripIds: [...new Set([...previous, ...tripIds])], updatedAt: FieldValue.serverTimestamp() } })
    }
    for (const date of dates) this.writes.push(date === original.tripDate
      ? { collection: 'trips', id: original.id, merge: true, data: { tripDate: original.tripDate, queueLink: { bookingId: id, kind: 'day', date }, updatedAt: this.stamp } }
      : { collection: 'trips', id: dayTripIds[date], data: this.plannedTrip(reservedDayInput(input, date), dayTripIds[date], id, 'day') })
    const booking: ContinuousBooking = { id, startDate: dates[0], endDate: command.endDate, driverId: input.driverId, driverName: input.driverName, vehicleId: input.vehicleId,
      vehiclePlate: input.vehiclePlate, siteName: input.stops[0].siteName, dayTripIds, overrides: {}, template: input, createdBy: this.actor.id, createdAt: this.stamp }
    return { booking, result: { bookingId: id, tripIds } }
  }

  async borrow(command: Extract<QueueCommand, { action: 'borrow' }>): Promise<{ booking: ContinuousBooking; result: QueueCommandResult }> {
    const booking = await this.booking(command.bookingId)
    const original = await this.originalDay(booking, command.date)
    requireValue(command.date >= this.today && unstarted(original), 'ยืมได้เฉพาะวันที่ยังไม่เริ่มงาน และห้ามยืมย้อนหลัง')
    requireValue(booking.overrides[command.date]?.state !== 'borrowed', 'วันที่เลือกมีคิวยืมอยู่แล้ว ต้องคืนคิวก่อน')
    requireValue(command.borrowDriver || command.borrowVehicle, 'ต้องเลือกยืมคนขับหรือรถอย่างน้อยหนึ่งรายการ', 400)
    requireValue(command.trip.tripDate === command.date, 'วันของใบคิวยืมไม่ตรงกับวันที่เลือก', 400)
    const reason = command.reason.trim()
    requireValue(reason.length > 0 && reason.length <= 1000, 'ระบุเหตุผลการยืมคิว 1–1000 ตัวอักษร', 400)
    requireValue((command.trip.driverId === booking.driverId) === command.borrowDriver && (command.trip.vehicleId === booking.vehicleId) === command.borrowVehicle, 'คนขับหรือรถไม่ตรงกับรายการที่เลือกยืม', 400)
    const input = await this.resources(command.trip)
    const tripId = await this.newTripId(command.date)
    await this.preserveReservations(original, booking.id)
    await this.reserve(input, booking.id, tripId, [original.id])
    input.sourceVRIds = await this.assignSources(command.assignments, input, [tripId])
    booking.overrides[command.date] = { state: 'borrowed', targetTripId: tripId, targetSiteName: input.stops[0].siteName, borrowDriver: command.borrowDriver,
      borrowVehicle: command.borrowVehicle, reason, approvedBy: this.actor.id, approvedByName: this.actor.name, approvedAt: this.stamp, compensation: command.compensationRequired ? 'owed' : 'not-required', assignments: command.assignments }
    this.writes.push({ collection: 'trips', id: original.id, merge: true, data: { status: 'Cancelled', updatedAt: this.stamp } },
      { collection: 'trips', id: tripId, data: this.plannedTrip(input, tripId, booking.id, 'borrow') })
    return { booking, result: { bookingId: booking.id, tripIds: [tripId] } }
  }

  async return(command: Extract<QueueCommand, { action: 'return' }>): Promise<{ booking: ContinuousBooking; result: QueueCommandResult }> {
    const booking = await this.booking(command.bookingId)
    const original = await this.originalDay(booking, command.date)
    const override = booking.overrides[command.date]
    requireValue(override?.state === 'borrowed', 'ไม่พบคิวยืมที่ต้องคืนในวันที่เลือก')
    const target = await this.read<Trip>('trips', override.targetTripId)
    requireValue(target && target.queueLink?.bookingId === booking.id && target.queueLink.kind === 'borrow' && target.tripDate === command.date, 'ไม่พบใบคิวยืมที่ตรงกับวันที่เลือก')
    requireValue(command.date >= this.today && unstarted(target) && original.status === 'Cancelled' && unstarted({ ...original, status: 'Planned' }), 'คืนคิวได้ก่อนเริ่มงานเท่านั้น และห้ามคืนย้อนหลัง')
    requireValue(override.compensation !== 'scheduled' && override.compensation !== 'completed', 'มีคิวชดเชยแล้ว ต้องยกเลิกคิวชดเชยก่อนคืนคิว')
    requireValue(command.reason.trim().length > 0 && command.reason.trim().length <= 1000, 'ระบุเหตุผลการคืนคิว 1–1000 ตัวอักษร', 400)
    await this.preserveReservations(target, booking.id)
    await this.reserve(original, booking.id, original.id, [original.id, target.id])
    const originalKeys = new Set(resourceGuardKeys(original))
    for (const key of resourceGuardKeys(target)) if (!originalKeys.has(key)) this.reservations.set(key, null)
    await this.unassignSources(override.assignments || [], target.id)
    override.state = 'returned'
    override.compensation = 'not-required'
    this.writes.push({ collection: 'trips', id: target.id, merge: true, data: { status: 'Cancelled', updatedAt: this.stamp } },
      { collection: 'trips', id: original.id, merge: true, data: { status: 'Planned', updatedAt: this.stamp } })
    return { booking, result: { bookingId: booking.id, tripIds: [original.id, target.id] } }
  }

  async scheduleCompensation(command: Extract<QueueCommand, { action: 'schedule-compensation' }>): Promise<{ booking: ContinuousBooking; result: QueueCommandResult }> {
    const booking = await this.booking(command.bookingId)
    await this.originalDay(booking, command.originalDate)
    const override = booking.overrides[command.originalDate]
    requireValue(override?.state === 'borrowed' && override.compensation === 'owed', 'วันที่เลือกไม่มีวันชดเชยค้างอยู่')
    dateValue(command.date)
    requireValue(command.date >= this.today, 'จัดคิวชดเชยย้อนหลังไม่ได้')
    const input = await this.resources({ ...booking.template, tripDate: command.date, driverId: booking.driverId, vehicleId: booking.vehicleId, stops: planningStops(booking.template.stops) })
    input.sourceVRIds = booking.template.sourceVRIds || []
    const tripId = await this.newTripId(command.date)
    await this.reserve(input, booking.id, tripId)
    override.compensation = 'scheduled'
    override.compensationTripId = tripId
    override.compensationDate = command.date
    this.writes.push({ collection: 'trips', id: tripId, data: this.plannedTrip(input, tripId, booking.id, 'compensation', command.originalDate) })
    return { booking, result: { bookingId: booking.id, tripIds: [tripId] } }
  }

  async closeCompensation(command: Extract<QueueCommand, { action: 'complete-compensation' | 'cancel-compensation' }>): Promise<{ booking: ContinuousBooking; result: QueueCommandResult }> {
    const booking = await this.booking(command.bookingId)
    const override = booking.overrides[dateValue(command.originalDate)]
    requireValue(override?.state === 'borrowed' && override.compensation === 'scheduled' && override.compensationTripId && override.compensationDate, 'ไม่มีคิวชดเชยที่รอทำงานในวันที่เลือก')
    const trip = await this.read<Trip>('trips', override.compensationTripId)
    requireValue(trip && trip.queueLink?.bookingId === booking.id && trip.queueLink.kind === 'compensation' && trip.queueLink.originalDate === command.originalDate && trip.tripDate === override.compensationDate, 'ใบคิวชดเชยไม่ตรงกับรายการที่เลือก')
    const completed = command.action === 'complete-compensation'
    if (completed) {
      requireValue(trip.tripDate <= this.today, 'ยืนยันทำงานชดเชยล่วงหน้าไม่ได้')
      requireValue(trip.status === 'Planned' || trip.status === 'In Progress', 'คิวชดเชยถูกยกเลิกหรือปิดงานไปแล้ว')
    } else {
      requireValue(trip.tripDate >= this.today && unstarted(trip), 'ยกเลิกคิวชดเชยได้ก่อนเริ่มงานเท่านั้น และห้ามยกเลิกย้อนหลัง')
    }
    await this.preserveReservations(trip, booking.id)
    override.compensation = completed ? 'completed' : 'owed'
    if (completed) override.completedAt = this.stamp
    else {
      delete override.compensationTripId
      delete override.compensationDate
      delete override.completedAt
      for (const key of resourceGuardKeys(trip)) this.reservations.set(key, null)
    }
    this.auditDate = trip.tripDate
    this.writes.push({ collection: 'trips', id: trip.id, merge: true, data: { status: completed ? 'Completed' : 'Cancelled', updatedAt: this.stamp } })
    return { booking, result: { bookingId: booking.id, tripIds: [trip.id] } }
  }

  async completeDay(command: Extract<QueueCommand, { action: 'complete-day' }>): Promise<{ booking: ContinuousBooking; result: QueueCommandResult }> {
    const booking = await this.booking(command.bookingId)
    const original = await this.originalDay(booking, command.date)
    requireValue(command.date <= this.today, 'ยืนยันทำงานล่วงหน้าไม่ได้')
    const override = booking.overrides[command.date]
    const target = override?.state === 'borrowed' ? await this.read<Trip>('trips', override.targetTripId) : original
    requireValue(target && target.queueLink?.bookingId === booking.id && target.tripDate === command.date && (target.status === 'Planned' || target.status === 'In Progress'), 'คิววันที่เลือกถูกยกเลิกหรือปิดงานไปแล้ว')
    await this.preserveReservations(target, booking.id)
    this.writes.push({ collection: 'trips', id: target.id, merge: true, data: { status: 'Completed', updatedAt: this.stamp } })
    return { booking, result: { bookingId: booking.id, tripIds: [target.id] } }
  }

  flush(): void {
    for (const write of this.writes) {
      // Ordinary trips already use Firestore timestamps for chronological history.
      const data = write.collection === 'trips' ? { ...write.data, updatedAt: FieldValue.serverTimestamp() } : write.data
      this.tx.set(this.db.collection(write.collection).doc(write.id), data, { merge: !!write.merge })
    }
    for (const [key, reservation] of this.reservations) this.tx.set(this.db.collection('queueResourceDays').doc(key), { version: this.guards.get(key)!.version + 1, ...(reservation || {}) })
  }
}

export async function executeQueueCommand(db: Firestore, command: QueueCommand, actor: Actor, now = new Date()): Promise<QueueCommandResult> {
  documentId(command.operationId); documentId(actor.id)
  const stamp = now.toISOString()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now)
  const hash = createHash('sha256').update(canonical(command)).digest('hex')
  return db.runTransaction(async tx => {
    const context = new QueueTransaction(db, tx, actor, today, stamp)
    const operation = await context.read<DocumentData>('continuousQueueOperations', command.operationId)
    if (operation) {
      requireValue(operation.actorId === actor.id && operation.hash === hash, 'รหัสการดำเนินการนี้ถูกใช้กับข้อมูลอื่นแล้ว')
      return operation.result as QueueCommandResult
    }
    let outcome: { booking: ContinuousBooking; result: QueueCommandResult }
    switch (command.action) {
      case 'create': outcome = await context.create(command); break
      case 'extend': outcome = await context.extend(command); break
      case 'borrow': outcome = await context.borrow(command); break
      case 'return': outcome = await context.return(command); break
      case 'schedule-compensation': outcome = await context.scheduleCompensation(command); break
      case 'complete-compensation':
      case 'cancel-compensation': outcome = await context.closeCompensation(command); break
      case 'complete-day': outcome = await context.completeDay(command); break
      default: throw new QueueServiceError('คำสั่งนี้ยังไม่รองรับ', 400)
    }
    const { booking, result } = outcome
    const event: QueueAuditEvent = withoutUndefined({ action: command.action, bookingId: booking.id, date: context.auditDate || ('date' in command ? command.date : 'originalDate' in command ? command.originalDate : booking.startDate), actorId: actor.id, actorName: actor.name, recordedAt: stamp, tripIds: result.tripIds, reason: 'reason' in command ? command.reason.trim() : undefined })
    const overrides = Object.values(booking.overrides).filter(item => item.state === 'borrowed')
    const hasOpenCompensation = overrides.some(item => item.compensation === 'owed' || item.compensation === 'scheduled')
    const compensationDates = [...new Set(overrides.filter(item => (item.compensation === 'scheduled' || item.compensation === 'completed') && item.compensationTripId && item.compensationDate).map(item => item.compensationDate!))]
    context.writes.push({ collection: 'continuousBookings', id: booking.id, data: { ...booking, hasOpenCompensation, compensationDates } },
      { collection: 'continuousQueueEvents', id: command.operationId, data: event },
      { collection: 'continuousQueueOperations', id: command.operationId, data: { actorId: actor.id, hash, result, recordedAt: stamp } })
    context.flush()
    return result
  })
}

export async function readQueueSnapshot(db: Firestore, date: string, staff: boolean): Promise<QueueSnapshot> {
  dateValue(date)
  const earliestStart = new Date(`${date}T00:00:00Z`)
  earliestStart.setUTCDate(earliestStart.getUTCDate() - MAX_QUEUE_DAYS + 1)
  const collection = db.collection('continuousBookings')
  // A range covers at most 90 days. Compensation can outlive that range, so it
  // has separate single-field indexes maintained atomically with every command.
  const queries = [collection.where('startDate', '>=', earliestStart.toISOString().slice(0, 10)).where('startDate', '<=', date), collection.where('compensationDates', 'array-contains', date)]
  if (staff) queries.push(collection.where('hasOpenCompensation', '==', true))
  const snapshots = await Promise.all(queries.map(query => query.limit(MAX_SNAPSHOT_BOOKINGS + 1).get()))
  const found = new Map<string, ContinuousBooking>()
  for (const snapshot of snapshots) {
    requireValue(snapshot.size <= MAX_SNAPSHOT_BOOKINGS, 'ข้อมูลคิวต่อเนื่องมากเกินกว่าจะตรวจครบได้ กรุณาติดต่อผู้ดูแล')
    for (const doc of snapshot.docs) found.set(doc.id, { ...doc.data(), id: doc.id } as ContinuousBooking)
  }
  const all = [...found.values()]
  const notices = all.flatMap(booking => {
    const covering = queueNotice(booking, date)
    if (covering) return [covering]
    const compensation = Object.values(booking.overrides).some(item => item.state === 'borrowed' && (item.compensation === 'scheduled' || item.compensation === 'completed') && item.compensationDate === date && item.compensationTripId)
    return compensation ? [{ bookingId: booking.id, startDate: date, endDate: date, date, driverId: booking.driverId, driverName: booking.driverName,
      vehicleId: booking.vehicleId, vehiclePlate: booking.vehiclePlate, siteName: booking.siteName, effectiveSiteName: booking.siteName, borrowedDriver: false, borrowedVehicle: false }] : []
  })
  const noticeIds = new Set(notices.map(notice => notice.bookingId))
  const bookings = staff ? all.filter(booking => noticeIds.has(booking.id) || Object.values(booking.overrides).some(item => item.compensation === 'owed' || item.compensation === 'scheduled')) : []
  return { date, notices, bookings }
}
