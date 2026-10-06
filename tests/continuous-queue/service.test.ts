import { Firestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import type { Firestore as ClientFirestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { executeQueueCommand, readQueueSnapshot } from '@/server/continuousQueueService'
import { createTripWithQueueGuard } from '@/lib/tripQueueGuard'
import type { ContinuousBooking, QueueCommand, QueueTripInput } from '@/types/continuous-queue'
import { requestDestinationFingerprint } from '@/lib/requestDestination'

const PROJECT = 'demo-continuous-queue-service'
const NOW = new Date('2026-10-03T05:00:00Z')
const actor = { id: 'dispatcher-1', name: 'คนจัดรถ' }
let db: Firestore
let env: RulesTestEnvironment
let op = 0
const operationId = () => `service-${++op}`
const sourceRequest = (which: 'A' | 'B') => ({ requestId: which === 'A' ? 'VR-0310-0001' : 'VR-0510-0001', requestDate: which === 'A' ? '2026-10-03' : '2026-10-05', status: 'in_progress', destinations: [{ siteId: `SITE-${which}`, siteName: `ไซต์ ${which}` }] })
const assignment = (which: 'A' | 'B') => ({ requestId: `REQ-${which}`, destinationIndexes: [0], expectedDestinationFingerprints: [requestDestinationFingerprint(sourceRequest(which), 0)] })
const tripInput = (date = '2026-10-03', site = 'ไซต์ A'): QueueTripInput => ({
  tripDate: date, driverId: 'D1', driverName: 'ชื่อเก่า', vehicleId: 'V1', vehiclePlate: 'ทะเบียนเก่า',
  stops: [{ siteId: 'SITE-A', siteName: site, order: 1, cargoDetails: 'ประจำไซต์', lat: 13.7, lng: 100.5 }],
  sourceVRIds: ['SPOOFED'], totalDistanceKm: 10,
})
const create = (patch: Partial<Extract<QueueCommand, { action: 'create' }>> = {}) => executeQueueCommand(db, {
  operationId: operationId(), action: 'create', trip: tripInput(), endDate: '2026-10-10',
  assignments: [assignment('A')], ...patch,
}, actor, NOW)
const booking = async (id: string) => (await db.collection('continuousBookings').doc(id).get()).data() as ContinuousBooking
const trip = async (id: string) => (await db.collection('trips').doc(id).get()).data()!
const borrow = (bookingId: string, patch: Partial<Extract<QueueCommand, { action: 'borrow' }>> = {}) => executeQueueCommand(db, {
  operationId: operationId(), action: 'borrow', bookingId, date: '2026-10-05', trip: { ...tripInput('2026-10-05', 'ไซต์ B'), vehicleId: 'V2' },
  assignments: [assignment('B')], borrowDriver: true, borrowVehicle: false,
  reason: 'ตกลงทางโทรศัพท์แล้ว', compensationRequired: true, ...patch,
}, actor, NOW)

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Use a local Firestore emulator only')
  db = new Firestore({ projectId: PROJECT, credentials: { client_email: 'emulator@demo.invalid', private_key: 'unused-in-local-emulator' } })
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: host.split(':')[0], port: Number(host.split(':')[1]), rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Cannot clear the isolated test project: ${res.status}`)
  await Promise.all([
    db.collection('users').doc(actor.id).set({ role: 'dispatcher', active: true, name: actor.name }),
    db.collection('drivers').doc('D1').set({ name: 'สมคิด' }),
    db.collection('drivers').doc('D2').set({ name: 'คนขับ 2' }),
    db.collection('vehicles').doc('V1').set({ licensePlate: '40-1000', type: '6-wheel truck' }),
    db.collection('vehicles').doc('V2').set({ licensePlate: '40-2000', type: '6-wheel truck' }),
    db.collection('vehicleRequests').doc('REQ-A').set({ requestId: 'VR-0310-0001', requestDate: '2026-10-03', status: 'in_progress', destinations: [{ siteId: 'SITE-A', siteName: 'ไซต์ A' }] }),
    db.collection('vehicleRequests').doc('REQ-B').set({ requestId: 'VR-0510-0001', requestDate: '2026-10-05', status: 'in_progress', destinations: [{ siteId: 'SITE-B', siteName: 'ไซต์ B' }] }),
  ])
})
afterAll(async () => { await env?.cleanup(); await db?.terminate() })

describe('continuous queue service on an isolated Firestore project', () => {
  it.each(['create', 'borrow'] as const)('stale destination in %s rejects atomically without changing reservations or original booking', async action => {
    const original = action === 'borrow' ? await create() : null
    const which = action === 'borrow' ? 'B' : 'A'
    const before = original ? await booking(original.bookingId) : null
    const priorTrips = (await db.collection('trips').get()).size
    await db.collection('vehicleRequests').doc(`REQ-${which}`).update({ destinations: [{ siteId: 'NEW', siteName: 'งานใหม่ที่ index เดิม' }] })
    await expect(original ? borrow(original.bookingId) : create()).rejects.toThrow('เปลี่ยนระหว่าง')
    expect((await db.collection('trips').get()).size).toBe(priorTrips)
    expect((await db.collection('vehicleRequests').doc(`REQ-${which}`).get()).data()?.assignedDestinations).toBeUndefined()
    if (original) expect(await booking(original.bookingId)).toEqual(before)
    else { expect((await db.collection('queueResourceDays').get()).empty).toBe(true); expect((await db.collection('continuousBookings').get()).empty).toBe(true) }
  })
  it('create from an old tab without fingerprints fails closed', async () => {
    await expect(create({ assignments: [{ requestId: 'REQ-A', destinationIndexes: [0] }] })).rejects.toThrow('โหลดหน้าใหม่')
    expect((await db.collection('trips').get()).empty).toBe(true)
  })
  it('return supports historical assignments without fingerprints', async () => {
    const original = await create()
    await borrow(original.bookingId)
    await db.collection('continuousBookings').doc(original.bookingId).update({ 'overrides.2026-10-05.assignments': [{ requestId: 'REQ-B', destinationIndexes: [0] }] })
    await executeQueueCommand(db, { operationId: operationId(), action: 'return', bookingId: original.bookingId, date: '2026-10-05', reason: 'คืนคิวเดิม' }, actor, NOW)
    expect((await db.collection('vehicleRequests').doc('REQ-B').get()).data()?.assignedDestinations).toEqual([])
  })
  it('creates every day, keeps human IDs, assigns the source atomically and reserves actual resources', async () => {
    const result = await create()
    const range = await booking(result.bookingId)
    expect(range.startDate).toBe('2026-10-03')
    expect(range.endDate).toBe('2026-10-10')
    expect(result.tripIds).toHaveLength(8)
    const records = await Promise.all(result.tripIds.map(trip))
    expect(records.map(t => t.tripDate)).toEqual(Object.keys(range.dayTripIds))
    expect(records.every(t => /^T-\d{4}-\d{4,}$/.test(t.tripId))).toBe(true)
    expect(records.every(t => t.driverName === 'สมคิด' && t.vehiclePlate === '40-1000')).toBe(true)
    expect(records[0].sourceVRIds).toEqual(['VR-0310-0001'])
    expect(records.every(t => t.queueLink.bookingId === result.bookingId && t.queueLink.kind === 'day')).toBe(true)
    const request = (await db.collection('vehicleRequests').doc('REQ-A').get()).data()!
    expect(request.status).toBe('approved')
    expect(request.assignedDestinations).toEqual([0])
    expect(request.tripId).toBe(result.tripIds[0])
    expect(request.tripIds).toEqual(result.tripIds)
    expect((await db.collection('queueResourceDays').doc('driver__D1__2026-10-05').get()).data()).toMatchObject({ version: 1, bookingId: result.bookingId, tripId: range.dayTripIds['2026-10-05'] })
    expect((await db.collection('continuousQueueEvents').get()).size).toBe(1)
    const publicView = await readQueueSnapshot(db, '2026-10-05', false)
    expect(publicView.bookings).toEqual([])
    expect(publicView.notices[0]).toMatchObject({ driverName: 'สมคิด', siteName: 'ไซต์ A', effectiveSiteName: 'ไซต์ A' })
  })

  it('keeps trip timestamps compatible with chronological history when a newer ordinary trip is created', async () => {
    const result = await create()
    await db.collection('trips').doc('LATER').set({ ...tripInput(), status: 'Planned', createdAt: Timestamp.fromMillis(Date.now() + 1000) })
    const history = await db.collection('trips').orderBy('createdAt', 'desc').limit(1).get()
    expect(history.docs[0].id).toBe('LATER')
    const managed = await trip(result.tripIds[0])
    expect(managed.createdAt).toBeInstanceOf(Timestamp)
    expect(managed.updatedAt).toBeInstanceOf(Timestamp)
  })

  it('extends an untouched planned trip while keeping its ID, original fields and clean future templates', async () => {
    const original = { ...tripInput(), id: 'EXISTING', tripId: 'T-0310-0999', status: 'Planned', departureSiteId: 'DEPOT', createdAt: 'original-stamp', requestedBy: 'ผู้ขอเดิม', sourceVRIds: ['VR-0310-0001'] }
    await db.collection('trips').doc('EXISTING').set(original)
    await db.collection('vehicleRequests').doc('REQ-A').update({ status: 'approved', assignedDestinations: [0], tripId: 'EXISTING' })
    const result = await executeQueueCommand(db, { operationId: operationId(), action: 'extend', tripId: 'EXISTING', endDate: '2026-10-06' }, actor, NOW)
    const range = await booking(result.bookingId)
    expect(result.tripIds).toHaveLength(4)
    expect(range.dayTripIds['2026-10-03']).toBe('EXISTING')
    expect(await trip('EXISTING')).toMatchObject({ id: 'EXISTING', tripId: original.tripId, createdAt: 'original-stamp', departureSiteId: 'DEPOT', requestedBy: 'ผู้ขอเดิม', stops: original.stops })
    expect((await trip(result.tripIds[1])).stops[0]).not.toHaveProperty('outcome')
    expect((await db.collection('vehicleRequests').doc('REQ-A').get()).data()!.tripIds).toEqual(result.tripIds)
  })

  it('borrows only the chosen day and resources, keeps the range and does not expose the approval reason', async () => {
    const original = await create()
    const before = await booking(original.bookingId)
    const result = await borrow(original.bookingId)
    const after = await booking(original.bookingId)
    expect(after.startDate).toBe(before.startDate)
    expect(after.endDate).toBe(before.endDate)
    expect(after.dayTripIds).toEqual(before.dayTripIds)
    expect(after.overrides['2026-10-05']).toMatchObject({ state: 'borrowed', borrowDriver: true, borrowVehicle: false, targetTripId: result.tripIds[0], compensation: 'owed', approvedBy: actor.id, reason: 'ตกลงทางโทรศัพท์แล้ว' })
    expect((await trip(before.dayTripIds['2026-10-05'])).status).toBe('Cancelled')
    expect((await trip(before.dayTripIds['2026-10-06'])).status).toBe('Planned')
    const target = await trip(result.tripIds[0])
    expect(target).toMatchObject({ status: 'Planned', driverId: 'D1', vehicleId: 'V2', queueLink: { bookingId: original.bookingId, kind: 'borrow', date: '2026-10-05' }, sourceVRIds: ['VR-0510-0001'] })
    expect(target).not.toHaveProperty('reason')
    expect((await db.collection('queueResourceDays').doc('driver__D1__2026-10-05').get()).data()).toMatchObject({ version: 2, tripId: result.tripIds[0] })
    expect((await db.collection('queueResourceDays').doc('vehicle__V1__2026-10-05').get()).data()).toMatchObject({ version: 2, tripId: before.dayTripIds['2026-10-05'] })
    expect((await db.collection('queueResourceDays').doc('vehicle__V2__2026-10-05').get()).data()).toMatchObject({ version: 1, tripId: result.tripIds[0] })
    const publicView = await readQueueSnapshot(db, '2026-10-05', false)
    expect(publicView.bookings).toEqual([])
    expect(publicView.notices[0]).toMatchObject({ borrowedDriver: true, borrowedVehicle: false, effectiveSiteName: 'ไซต์ B' })
    expect(JSON.stringify(publicView)).not.toContain('ตกลงทางโทรศัพท์แล้ว')
  })

  it('does not extend an ordinary planned trip after vehicle use has been ended', async () => {
    await db.collection('trips').doc('ENDED').set({ ...tripInput(), id: 'ENDED', tripId: 'ENDED', status: 'Planned', gpsEndAt: NOW.getTime() })
    await expect(executeQueueCommand(db, { operationId: operationId(), action: 'extend', tripId: 'ENDED', endDate: '2026-10-06' }, actor, NOW)).rejects.toThrow('ยังไม่เริ่มงาน')
    expect((await db.collection('continuousBookings').get()).empty).toBe(true)
    expect(await trip('ENDED')).not.toHaveProperty('queueLink')
  })

  it('does not borrow an original day after vehicle use has been ended', async () => {
    const original = await create()
    const range = await booking(original.bookingId)
    await db.collection('trips').doc(range.dayTripIds['2026-10-05']).update({ gpsEndAt: NOW.getTime() })
    await expect(borrow(original.bookingId)).rejects.toThrow('ยังไม่เริ่มงาน')
    expect((await booking(original.bookingId)).overrides).toEqual({})
  })

  it('does not return a borrowed trip after vehicle use has been ended', async () => {
    const original = await create()
    const result = await borrow(original.bookingId)
    await db.collection('trips').doc(result.tripIds[0]).update({ gpsEndAt: NOW.getTime() })
    await expect(executeQueueCommand(db, { operationId: operationId(), action: 'return', bookingId: original.bookingId, date: '2026-10-05', reason: 'คืนหลังจบการใช้รถ' }, actor, NOW)).rejects.toThrow('ก่อนเริ่มงาน')
    expect((await booking(original.bookingId)).overrides['2026-10-05'].state).toBe('borrowed')
  })

  it('does not cancel a compensation trip after vehicle use has been ended', async () => {
    const original = await create()
    await borrow(original.bookingId)
    const result = await executeQueueCommand(db, { operationId: operationId(), action: 'schedule-compensation', bookingId: original.bookingId, originalDate: '2026-10-05', date: '2026-10-11' }, actor, NOW)
    await db.collection('trips').doc(result.tripIds[0]).update({ gpsEndAt: NOW.getTime() })
    await expect(executeQueueCommand(db, { operationId: operationId(), action: 'cancel-compensation', bookingId: original.bookingId, originalDate: '2026-10-05' }, actor, NOW)).rejects.toThrow('ก่อนเริ่มงาน')
    expect((await booking(original.bookingId)).overrides['2026-10-05'].compensation).toBe('scheduled')
  })

  it('returns an unstarted loan, restores the original trip and atomically releases the target request and extra resource', async () => {
    const original = await create()
    const borrowed = await borrow(original.bookingId)
    const targetId = borrowed.tripIds[0]
    await executeQueueCommand(db, { operationId: operationId(), action: 'return', bookingId: original.bookingId, date: '2026-10-05', reason: 'ยกเลิกงานไซต์ B' }, actor, NOW)
    const range = await booking(original.bookingId)
    expect(range.overrides['2026-10-05']).toMatchObject({ state: 'returned', compensation: 'not-required', targetTripId: targetId })
    expect((await trip(targetId)).status).toBe('Cancelled')
    expect((await trip(range.dayTripIds['2026-10-05'])).status).toBe('Planned')
    const request = (await db.collection('vehicleRequests').doc('REQ-B').get()).data()!
    expect(request).toMatchObject({ status: 'in_progress', assignedDestinations: [], tripId: null, tripIds: [] })
    expect((await db.collection('queueResourceDays').doc('driver__D1__2026-10-05').get()).data()).toMatchObject({ version: 3, tripId: range.dayTripIds['2026-10-05'] })
    expect((await db.collection('queueResourceDays').doc('vehicle__V2__2026-10-05').get()).data()).toEqual({ version: 2 })
    expect((await readQueueSnapshot(db, '2026-10-05', false)).notices[0].effectiveSiteName).toBe('ไซต์ A')
    expect((await db.collection('continuousQueueEvents').get()).size).toBe(3)
  })

  it('schedules an owed compensation on a free date without extending the original range or silently clearing debt', async () => {
    const original = await create()
    await borrow(original.bookingId)
    const result = await executeQueueCommand(db, { operationId: operationId(), action: 'schedule-compensation', bookingId: original.bookingId, originalDate: '2026-10-05', date: '2026-10-11' }, actor, NOW)
    const range = await booking(original.bookingId)
    expect(range.endDate).toBe('2026-10-10')
    expect(range.overrides['2026-10-05']).toMatchObject({ compensation: 'scheduled', compensationDate: '2026-10-11', compensationTripId: result.tripIds[0] })
    expect(await trip(result.tripIds[0])).toMatchObject({ tripDate: '2026-10-11', status: 'Planned', driverId: 'D1', vehicleId: 'V1', stops: [{ siteName: 'ไซต์ A' }], queueLink: { kind: 'compensation', originalDate: '2026-10-05', date: '2026-10-11' } })
    expect((await readQueueSnapshot(db, '2026-11-01', true)).bookings).toHaveLength(1)
    expect(range.overrides['2026-10-05']).not.toHaveProperty('completedAt')
  })

  it('clears compensation debt only after explicit completion on or after its work date', async () => {
    const original = await create()
    await borrow(original.bookingId)
    const scheduled = await executeQueueCommand(db, { operationId: operationId(), action: 'schedule-compensation', bookingId: original.bookingId, originalDate: '2026-10-05', date: '2026-10-11' }, actor, NOW)
    const command: QueueCommand = { operationId: operationId(), action: 'complete-compensation', bookingId: original.bookingId, originalDate: '2026-10-05' }
    await expect(executeQueueCommand(db, command, actor, NOW)).rejects.toThrow('ล่วงหน้า')
    expect((await booking(original.bookingId)).overrides['2026-10-05'].compensation).toBe('scheduled')
    const completedAt = new Date('2026-10-11T05:00:00Z')
    await executeQueueCommand(db, command, actor, completedAt)
    expect((await booking(original.bookingId)).overrides['2026-10-05']).toMatchObject({ compensation: 'completed', completedAt: completedAt.toISOString() })
    expect((await trip(scheduled.tripIds[0])).status).toBe('Completed')
    expect((await readQueueSnapshot(db, '2026-11-01', true)).bookings).toEqual([])
  })

  it('cancels an unstarted compensation while retaining its trip history and returning debt to owed', async () => {
    const original = await create()
    await borrow(original.bookingId)
    const scheduled = await executeQueueCommand(db, { operationId: operationId(), action: 'schedule-compensation', bookingId: original.bookingId, originalDate: '2026-10-05', date: '2026-10-11' }, actor, NOW)
    await executeQueueCommand(db, { operationId: operationId(), action: 'cancel-compensation', bookingId: original.bookingId, originalDate: '2026-10-05' }, actor, NOW)
    const override = (await booking(original.bookingId)).overrides['2026-10-05']
    expect(override.compensation).toBe('owed')
    expect(override).not.toHaveProperty('compensationTripId')
    expect(override).not.toHaveProperty('compensationDate')
    expect((await trip(scheduled.tripIds[0]))).toMatchObject({ status: 'Cancelled', queueLink: { kind: 'compensation', originalDate: '2026-10-05' } })
    expect((await db.collection('queueResourceDays').doc('driver__D1__2026-10-11').get()).data()).toEqual({ version: 2 })
    expect((await db.collection('queueResourceDays').doc('vehicle__V1__2026-10-11').get()).data()).toEqual({ version: 2 })
  })

  it('explicitly closes only the effective borrowed day and leaves compensation owed', async () => {
    const original = await create()
    const borrowed = await borrow(original.bookingId)
    const command: QueueCommand = { operationId: operationId(), action: 'complete-day', bookingId: original.bookingId, date: '2026-10-05' }
    await expect(executeQueueCommand(db, command, actor, NOW)).rejects.toThrow('ล่วงหน้า')
    const workDate = new Date('2026-10-05T06:00:00Z')
    await executeQueueCommand(db, command, actor, workDate)
    const range = await booking(original.bookingId)
    expect((await trip(borrowed.tripIds[0])).status).toBe('Completed')
    expect((await trip(range.dayTripIds['2026-10-05'])).status).toBe('Cancelled')
    expect((await trip(range.dayTripIds['2026-10-06'])).status).toBe('Planned')
    expect(range.overrides['2026-10-05'].compensation).toBe('owed')
    await expect(executeQueueCommand(db, { operationId: operationId(), action: 'return', bookingId: range.id, date: '2026-10-05', reason: 'คืนหลังทำงาน' }, actor, workDate)).rejects.toThrow('ก่อนเริ่มงาน')
  })

  it('warns requesters about a scheduled compensation date outside the original range without exposing debt details', async () => {
    const original = await create()
    await borrow(original.bookingId)
    await executeQueueCommand(db, { operationId: operationId(), action: 'schedule-compensation', bookingId: original.bookingId, originalDate: '2026-10-05', date: '2026-10-11' }, actor, NOW)
    const snapshot = await readQueueSnapshot(db, '2026-10-11', false)
    expect(snapshot.bookings).toEqual([])
    expect(snapshot.notices).toEqual([{ bookingId: original.bookingId, startDate: '2026-10-11', endDate: '2026-10-11', date: '2026-10-11', driverId: 'D1', driverName: 'สมคิด', vehicleId: 'V1', vehiclePlate: '40-1000', siteName: 'ไซต์ A', effectiveSiteName: 'ไซต์ A', borrowedDriver: false, borrowedVehicle: false }])
    expect(JSON.stringify(snapshot)).not.toContain('compensation')
    expect((await booking(original.bookingId)).endDate).toBe('2026-10-10')
  })

  it('rejects a new queue template carrying a recorded outcome instead of copying actual work into future days', async () => {
    const input = tripInput()
    input.stops[0].outcome = 'delivered'
    input.stops[0].outcomeAt = NOW.toISOString()
    await expect(create({ trip: input })).rejects.toThrow('ผลการทำงาน')
    expect((await db.collection('trips').get()).size).toBe(0)
    expect((await db.collection('continuousBookings').get()).size).toBe(0)
  })

  it('extends legacy partial-request links found by source human ID even when primary tripId is still null', async () => {
    await db.collection('trips').doc('PARTIAL').set({ ...tripInput(), id: 'PARTIAL', tripId: 'T-0310-0999', status: 'Planned', sourceVRIds: ['VR-0310-0001'] })
    await db.collection('vehicleRequests').doc('REQ-A').update({ status: 'partial', assignedDestinations: [0], tripId: null, destinations: [{ siteName: 'ไซต์ A' }, { siteName: 'อีกไซต์' }] })
    const result = await executeQueueCommand(db, { operationId: operationId(), action: 'extend', tripId: 'PARTIAL', endDate: '2026-10-04' }, actor, NOW)
    const request = (await db.collection('vehicleRequests').doc('REQ-A').get()).data()!
    expect(request.tripIds).toEqual(result.tripIds)
    expect(request).toMatchObject({ status: 'partial', assignedDestinations: [0], tripId: null })
  })

  it('returns the same result for concurrent retries and rejects reuse with a changed body or actor', async () => {
    const command: QueueCommand = { operationId: 'same-operation', action: 'create', trip: tripInput(), endDate: '2026-10-05', assignments: [] }
    const results = await Promise.all([executeQueueCommand(db, command, actor, NOW), executeQueueCommand(db, command, actor, NOW)])
    expect(results[0]).toEqual(results[1])
    expect((await db.collection('trips').get()).size).toBe(3)
    expect((await db.collection('continuousQueueEvents').get()).size).toBe(1)
    await expect(executeQueueCommand(db, { ...command, endDate: '2026-10-06' }, actor, NOW)).rejects.toThrow('ข้อมูลอื่น')
    await expect(executeQueueCommand(db, command, { id: 'another-staff', name: 'คนอื่น' }, NOW)).rejects.toThrow('ข้อมูลอื่น')
    expect((await db.collection('trips').get()).size).toBe(3)
  })

  it('serializes competing range creations so only one allocation owns the resources', async () => {
    const attempts = await Promise.allSettled([create({ assignments: [], endDate: '2026-10-05' }), create({ assignments: [], endDate: '2026-10-05' })])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await db.collection('continuousBookings').get()).size).toBe(1)
    expect((await db.collection('trips').get()).size).toBe(3)
    expect((await db.collection('continuousQueueEvents').get()).size).toBe(1)
  })

  it('serializes a real guarded browser-client trip against server range creation without double allocation', async () => {
    const client = env.authenticatedContext(actor.id, { email: 'dispatcher@example.test' }).firestore() as unknown as ClientFirestore
    const ordinary = { ...tripInput(), id: 'NORMAL', tripId: 'T-0310-9999', status: 'Planned' }
    const results = await Promise.allSettled([create({ assignments: [], endDate: '2026-10-05' }), createTripWithQueueGuard(client, 'NORMAL', ordinary)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const day = await db.collection('trips').where('tripDate', '==', '2026-10-03').get()
    expect(day.docs.filter(doc => doc.data().status !== 'Cancelled')).toHaveLength(1)
    const guard = (await db.collection('queueResourceDays').doc('driver__D1__2026-10-03').get()).data()!
    if (results[0].status === 'fulfilled') expect(guard.bookingId).toBe(results[0].value.bookingId)
    else expect(guard).not.toHaveProperty('bookingId')
  })

  it('claims the same request destination once even when ordinary and continuous queues choose different resources', async () => {
    const client = env.authenticatedContext(actor.id).firestore() as unknown as ClientFirestore
    const ordinary = { ...tripInput(), driverId: 'D2', vehicleId: 'V2', id: 'NORMAL', tripId: 'NORMAL', status: 'Planned' }
    const results = await Promise.allSettled([create({ endDate: '2026-10-05' }), createTripWithQueueGuard(client, 'NORMAL', ordinary, { assignments: [assignment('A')] })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const request = (await db.collection('vehicleRequests').doc('REQ-A').get()).data()!
    expect(request.assignedDestinations).toEqual([0])
    expect(request.tripIds).toEqual(results[0].status === 'fulfilled' ? results[0].value.tripIds : ['NORMAL'])
  })

  it('does not overwrite a human trip ID already used in an earlier year', async () => {
    await db.collection('trips').doc('T-0310-0010').set({ tripDate: '2025-10-03', status: 'Completed', marker: 'historical' })
    const result = await create({ endDate: '2026-10-03' })
    expect(result.tripIds[0]).not.toBe('T-0310-0010')
    expect((await trip('T-0310-0010')).marker).toBe('historical')
  })

  it.each(['cancelled', 'rejected', 'approved', 'missing'])('rolls back every write when a selected source is %s', async status => {
    if (status === 'missing') await db.collection('vehicleRequests').doc('REQ-A').delete()
    else await db.collection('vehicleRequests').doc('REQ-A').update({ status })
    await expect(create()).rejects.toThrow('ใบขอ')
    expect((await db.collection('trips').get()).size).toBe(0)
    expect((await db.collection('queueResourceDays').get()).size).toBe(0)
    expect((await db.collection('continuousBookings').get()).size).toBe(0)
    expect((await db.collection('continuousQueueEvents').get()).size).toBe(0)
  })

  it.each([
    { name: 'out-of-range index', count: 1, assignments: [{ requestId: 'REQ-A', destinationIndexes: [1] }] },
    { name: 'duplicate index', count: 2, assignments: [{ requestId: 'REQ-A', destinationIndexes: [0, 0] }] },
    { name: 'duplicate request', count: 2, assignments: [assignment('A'), assignment('A')] },
  ])('rejects $name without partial assignment', async ({ assignments, count }) => {
    const input = tripInput()
    input.stops = Array.from({ length: count }, () => ({ ...input.stops[0] }))
    await expect(create({ assignments, trip: input })).rejects.toThrow()
    expect((await db.collection('trips').get()).size).toBe(0)
    expect((await db.collection('vehicleRequests').doc('REQ-A').get()).data()!.status).toBe('in_progress')
  })

  it('uses the actual driver when checking ordinary trip conflicts', async () => {
    await db.collection('trips').doc('ACTUAL').set({ tripDate: '2026-10-03', driverId: 'D2', actualDriverId: 'D1', vehicleId: 'V2', status: 'Planned' })
    await expect(create()).rejects.toThrow('มีคิวอยู่แล้ว')
    expect((await db.collection('continuousBookings').get()).size).toBe(0)
  })

  it('rejects a range that overlaps an active legacy trip stored under date', async () => {
    await db.collection('trips').doc('LEGACY').set({ date: '2026-10-05', driverId: 'D1', vehicleId: 'V1', status: 'Planned' })
    await expect(create()).rejects.toThrow('มีคิวอยู่แล้ว')
    expect((await db.collection('continuousBookings').get()).empty).toBe(true)
  })

  it('extends a legacy date trip without changing its ID or losing its old date field', async () => {
    const { tripDate, ...legacy } = tripInput()
    await db.collection('trips').doc('LEGACY').set({ ...legacy, date: tripDate, status: 'Planned' })
    const result = await executeQueueCommand(db, { operationId: operationId(), action: 'extend', tripId: 'LEGACY', endDate: '2026-10-05' }, actor, NOW)
    expect(result.tripIds[0]).toBe('LEGACY')
    expect(await trip('LEGACY')).toMatchObject({ date: tripDate, tripDate, queueLink: { kind: 'day', date: tripDate } })
    expect((await readQueueSnapshot(db, '2026-10-05', false)).notices).toHaveLength(1)
  })

  it('uses canonical tripDate when a moved legacy trip retains an old date field', async () => {
    await db.collection('trips').doc('MOVED').set({ date: '2026-10-05', tripDate: '2026-10-11', driverId: 'D1', vehicleId: 'V1', status: 'Planned' })
    expect((await create()).tripIds).toHaveLength(8)
  })

  it('keeps compensation visible long after its original range and updates lookup fields on cancellation and return', async () => {
    const original = await create()
    await borrow(original.bookingId)
    await executeQueueCommand(db, { operationId: operationId(), action: 'schedule-compensation', bookingId: original.bookingId, originalDate: '2026-10-05', date: '2027-01-15' }, actor, NOW)
    expect((await readQueueSnapshot(db, '2027-01-15', false)).notices.map(notice => notice.bookingId)).toEqual([original.bookingId])
    expect((await readQueueSnapshot(db, '2027-02-01', true)).bookings.map(item => item.id)).toEqual([original.bookingId])
    await executeQueueCommand(db, { operationId: operationId(), action: 'cancel-compensation', bookingId: original.bookingId, originalDate: '2026-10-05' }, actor, NOW)
    expect((await readQueueSnapshot(db, '2027-01-15', false)).notices).toEqual([])
    expect((await readQueueSnapshot(db, '2027-02-01', true)).bookings.map(item => item.id)).toEqual([original.bookingId])
    await executeQueueCommand(db, { operationId: operationId(), action: 'return', bookingId: original.bookingId, date: '2026-10-05', reason: 'คืนคิวเดิม' }, actor, NOW)
    expect((await readQueueSnapshot(db, '2027-02-01', true)).bookings).toEqual([])
  })

  it('borrows both original resources and returns both without losing either original reservation', async () => {
    const original = await create()
    const borrowed = await borrow(original.bookingId, { trip: tripInput('2026-10-05', 'ไซต์ B'), borrowVehicle: true })
    expect((await db.collection('queueResourceDays').doc('vehicle__V1__2026-10-05').get()).data()!.tripId).toBe(borrowed.tripIds[0])
    await executeQueueCommand(db, { operationId: operationId(), action: 'return', bookingId: original.bookingId, date: '2026-10-05', reason: 'คืนทั้งสองรายการ' }, actor, NOW)
    const range = await booking(original.bookingId)
    for (const key of ['driver__D1__2026-10-05', 'vehicle__V1__2026-10-05']) expect((await db.collection('queueResourceDays').doc(key).get()).data()).toMatchObject({ version: 3, tripId: range.dayTripIds['2026-10-05'] })
  })

  it('does not approve a loan whose additional resource is already allocated', async () => {
    const original = await create()
    await db.collection('trips').doc('BUSY-V2').set({ tripDate: '2026-10-05', driverId: 'D2', vehicleId: 'V2', status: 'Planned' })
    await expect(borrow(original.bookingId)).rejects.toThrow('มีคิวอยู่แล้ว')
    const range = await booking(original.bookingId)
    expect(range.overrides).toEqual({})
    expect((await trip(range.dayTripIds['2026-10-05'])).status).toBe('Planned')
    expect((await db.collection('vehicleRequests').doc('REQ-B').get()).data()!.status).toBe('in_progress')
  })

  it('does not restore a cancelled source request when its unstarted loan is explicitly returned', async () => {
    const original = await create()
    await borrow(original.bookingId)
    await db.collection('vehicleRequests').doc('REQ-B').update({ status: 'cancelled' })
    await executeQueueCommand(db, { operationId: operationId(), action: 'return', bookingId: original.bookingId, date: '2026-10-05', reason: 'คืนคิวหลังเจ้าของยกเลิกใบ' }, actor, NOW)
    expect((await db.collection('vehicleRequests').doc('REQ-B').get()).data()).toMatchObject({ status: 'cancelled', assignedDestinations: [], tripIds: [] })
  })

  it('requires scheduled compensation to be cancelled before returning its source loan', async () => {
    const original = await create()
    await borrow(original.bookingId)
    await executeQueueCommand(db, { operationId: operationId(), action: 'schedule-compensation', bookingId: original.bookingId, originalDate: '2026-10-05', date: '2026-10-11' }, actor, NOW)
    await expect(executeQueueCommand(db, { operationId: operationId(), action: 'return', bookingId: original.bookingId, date: '2026-10-05', reason: 'คืนโดยไม่ยกเลิกชดเชย' }, actor, NOW)).rejects.toThrow('ยกเลิกคิวชดเชยก่อน')
    expect((await booking(original.bookingId)).overrides['2026-10-05'].state).toBe('borrowed')
  })

  it('rejects a compensation date that overlaps the retained original resource reservation', async () => {
    const original = await create()
    await borrow(original.bookingId)
    await expect(executeQueueCommand(db, { operationId: operationId(), action: 'schedule-compensation', bookingId: original.bookingId, originalDate: '2026-10-05', date: '2026-10-04' }, actor, NOW)).rejects.toThrow('มีคิวอยู่แล้ว')
    expect((await booking(original.bookingId)).overrides['2026-10-05'].compensation).toBe('owed')
  })

  it('reads current notices after more than 500 historical bookings without scanning lifetime history', async () => {
    for (let offset = 0; offset < 501; offset += 250) {
      const batch = db.batch()
      for (let index = offset; index < Math.min(offset + 250, 501); index++) batch.set(db.collection('continuousBookings').doc(`CAP-${index}`), { startDate: '2000-01-01', endDate: '2000-01-01' })
      await batch.commit()
    }
    const current = await create()
    expect((await readQueueSnapshot(db, '2026-10-05', false)).notices.map(notice => notice.bookingId)).toEqual([current.bookingId])
  })

  it('reports a current snapshot cap overflow instead of returning a false-empty availability view', async () => {
    for (let offset = 0; offset < 501; offset += 250) {
      const batch = db.batch()
      for (let index = offset; index < Math.min(offset + 250, 501); index++) batch.set(db.collection('continuousBookings').doc(`CAP-${index}`), { startDate: '2026-10-03', endDate: '2026-10-10' })
      await batch.commit()
    }
    await expect(readQueueSnapshot(db, '2026-10-05', false)).rejects.toThrow('ตรวจครบ')
  })

  it.each(['create', 'extend'] as const)('does not multiply first-day travel estimates across later onsite reservations in %s', async action => {
    const input = { ...tripInput(), sourceVRIds: [], totalDistanceKm: 10, totalEstimatedTimeMinutes: 60, fuelCost: 200, departurePoint: 'คลัง', originLat: 14, originLng: 100 }
    const originalId = 'ORIGINAL-TRAVEL'
    if (action === 'extend') await db.collection('trips').doc(originalId).set({ ...input, id: originalId, tripId: originalId, departureSiteId: 'DEPOT', status: 'Planned' })
    const result = action === 'create' ? await create({ trip: input, assignments: [], endDate: '2026-10-05' })
      : await executeQueueCommand(db, { operationId: operationId(), action: 'extend', tripId: originalId, endDate: '2026-10-05' }, actor, NOW)
    const records = await Promise.all(result.tripIds.map(trip))
    expect(records[0]).toMatchObject({ totalDistanceKm: 10, totalEstimatedTimeMinutes: 60, fuelCost: 200, originLat: 14, originLng: 100, departurePoint: 'คลัง' })
    expect(records.slice(1).every(t => (t.totalDistanceKm || 0) === 0 && (t.totalEstimatedTimeMinutes || 0) === 0 && (t.fuelCost || 0) === 0)).toBe(true)
    expect(records.slice(1).every(t => t.originLat === 13.7 && t.originLng === 100.5 && t.departurePoint === 'ไซต์ A')).toBe(true)
    expect(records.reduce((sum, t) => sum + (t.fuelCost || 0), 0)).toBe(200)
  })
})
