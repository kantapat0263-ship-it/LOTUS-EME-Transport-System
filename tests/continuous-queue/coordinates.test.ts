import { randomUUID, createHash } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest'
import { syncTripCoordinates } from '@/server/tripCoordinateSyncService'
import { coordinateSyncBaseline, coordinateSyncDigest, type CoordinateSyncCommand } from '@/lib/tripCoordinateSync'
import { parseCoordinateSyncCommand } from '@/server/tripCoordinateSyncValidation'
import type { Trip } from '@/types/models'

let db: Firestore
const actor = { id: 'staff1', name: 'ชื่อที่ client อาจปลอมได้' }
const original = (): Trip => ({ id: 't1', tripId: 'T-0710-0001', tripDate: '2026-10-07', status: 'Planned', driverId: 'd1', driverName: 'สมคิด', vehicleId: 'v1', vehiclePlate: '40-1000', departureSiteId: '', sourceVRIds: ['VR-0710-0001'], totalDistanceKm: 52, fuelCost: 400, stops: [{ siteId: 's1', siteName: 'ไซต์ A', order: 1, cargoDetails: 'งานเดิม', requestedBy: 'ผู้ขอ', lat: 13, lng: 100 }, { siteId: 's2', siteName: 'ไซต์ B', order: 2, cargoDetails: 'งาน B', lat: 15, lng: 102 }] })
const baseline = (trip: Trip) => createHash('sha256').update(coordinateSyncBaseline(trip)).digest('hex')
const command = (patch: Partial<CoordinateSyncCommand> = {}): CoordinateSyncCommand => ({ operationId: randomUUID(), tripId: 't1', baseline: baseline(original()), selections: [{ stopIndex: 0, siteId: 's1', latitude: 14, longitude: 101 }], ...patch })
const readTrip = async () => (await db.doc('trips/t1').get()).data()!
const logs = async () => (await db.collection('trips/t1/editLogs').get()).docs.map(doc => doc.data())

beforeAll(() => {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Local emulator only')
  db = new Firestore({ projectId: 'demo-coordinate-sync', credentials: { client_email: 'test@demo.invalid', private_key: 'local-only' } })
})
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-coordinate-sync/databases/(default)/documents`, { method: 'DELETE' })
  await Promise.all([
    db.doc('users/staff1').set({ role: 'dispatcher', active: true, name: 'ชื่อจริงจากระบบ' }),
    db.doc('trips/t1').set({ ...original(), stopNotes: { stop_0: 'หมายเหตุเก่า' }, stopNoteAuthors: { stop_0: 'ผู้จัด' } }),
    db.doc('sites/s1').set({ name: 'ไซต์ A', latitude: 14, longitude: 101 }),
    db.doc('sites/s2').set({ name: 'ไซต์ B', latitude: 16, longitude: 103 }),
  ])
})
afterAll(async () => { await db?.terminate() })

it('only changes selected coordinates, preserves everything else and atomically records the actual actor', async () => {
  const before = await readTrip()
  await expect(syncTripCoordinates(db, command(), actor.id)).resolves.toMatchObject({ updatedStops: 1 })
  const after = await readTrip()
  expect(after.stops).toEqual([{ ...before.stops[0], lat: 14, lng: 101 }, before.stops[1]])
  const { stops: _stops, updatedAt: _updated, ...rest } = after
  const { stops: _beforeStops, ...beforeRest } = before
  expect(rest).toEqual(beforeRest)
  expect(await logs()).toMatchObject([{ editedBy: 'ชื่อจริงจากระบบ', changes: { coordinatesUpdated: [{ stopIndex: 0, siteId: 's1', from: { lat: 13, lng: 100 }, to: { lat: 14, lng: 101 } }] } }])
})
it('updates only the selected managed day and leaves booking, guards and other days untouched', async () => {
  const linked = { ...original(), queueLink: { bookingId: 'b1', date: '2026-10-07', kind: 'day' as const } }
  await db.doc('trips/t1').set(linked)
  await db.doc('trips/t2').set({ ...linked, tripDate: '2026-10-08' })
  await db.doc('continuousBookings/b1').set({ template: original(), endDate: '2026-10-10' })
  await db.doc('queueResourceDays/g1').set({ bookingId: 'b1', version: 5 })
  await syncTripCoordinates(db, command({ baseline: baseline(linked) }), actor.id)
  expect((await readTrip()).queueLink).toEqual(linked.queueLink)
  expect((await db.doc('trips/t2').get()).data()).toEqual({ ...linked, tripDate: '2026-10-08' })
  expect((await db.doc('continuousBookings/b1').get()).data()).toEqual({ template: original(), endDate: '2026-10-10' })
  expect((await db.doc('queueResourceDays/g1').get()).data()).toEqual({ bookingId: 'b1', version: 5 })
})
it('concurrent identical retries produce one audit event and replay after a lost response', async () => {
  const input = command()
  const results = await Promise.all([syncTripCoordinates(db, input, actor.id), syncTripCoordinates(db, input, actor.id)])
  expect(results.every(value => value.updatedStops === 1)).toBe(true)
  expect(await logs()).toHaveLength(1)
  await expect(syncTripCoordinates(db, input, actor.id)).resolves.toMatchObject({ updatedStops: 1, replayed: true })
  await expect(syncTripCoordinates(db, { ...input, selections: [{ stopIndex: 1, siteId: 's2', latitude: 16, longitude: 103 }] }, actor.id)).rejects.toThrow('คำสั่ง')
})
it.each(['site-changed', 'site-deleted', 'stop-reordered', 'outcome', 'completed', 'cancelled', 'deleted'] as const)('rejects %s after preview without partial writes or audit', async change => {
  if (change === 'site-changed') await db.doc('sites/s1').update({ latitude: 15 })
  if (change === 'site-deleted') await db.doc('sites/s1').delete()
  if (change === 'stop-reordered') await db.doc('trips/t1').update({ stops: [...original().stops].reverse() })
  if (change === 'outcome') await db.doc('trips/t1').update({ stops: [{ ...original().stops[0], outcome: 'delivered' }, original().stops[1]] })
  if (change === 'completed' || change === 'cancelled') await db.doc('trips/t1').update({ status: change === 'completed' ? 'Completed' : 'Cancelled' })
  if (change === 'deleted') await db.doc('trips/t1').delete()
  const before = await readTrip()
  await expect(syncTripCoordinates(db, command(), actor.id)).rejects.toThrow()
  expect(await readTrip()).toEqual(before)
  expect(await logs()).toHaveLength(0)
})
it('keeps concurrent dispatcher and legacy notes', async () => {
  await db.doc('trips/t1').update({ stops: [{ ...original().stops[0], dispatcherNote: 'สด', dispatcherName: 'ผู้แก้' }, original().stops[1]], 'stopNotes.stop_0': 'สดจากรุ่นเก่า' })
  await syncTripCoordinates(db, command(), actor.id)
  expect((await readTrip()).stops[0].dispatcherNote).toBe('สด')
  expect((await readTrip()).stopNotes.stop_0).toBe('สดจากรุ่นเก่า')
})
it.each([{ role: 'viewer', active: true }, { role: 'dispatcher', active: false }])('denies current profile %j even with a stale verified identity', async profile => {
  await db.doc('users/staff1').update(profile)
  await expect(syncTripCoordinates(db, command(), actor.id)).rejects.toThrow('สิทธิ์')
  expect((await readTrip()).stops[0].lat).toBe(13)
  expect(await logs()).toHaveLength(0)
})
it('does not log or rewrite a no-op', async () => {
  await db.doc('sites/s1').update({ latitude: 13, longitude: 100 })
  await expect(syncTripCoordinates(db, command({ selections: [{ stopIndex: 0, siteId: 's1', latitude: 13, longitude: 100 }] }), actor.id)).resolves.toMatchObject({ updatedStops: 0 })
  expect((await readTrip()).updatedAt).toBeUndefined()
  expect(await logs()).toHaveLength(0)
})
it('rejects arbitrary patch fields, duplicate indexes and invalid coordinates', () => {
  expect(() => parseCoordinateSyncCommand({ ...command(), patch: { driverId: 'other' } })).toThrow()
  expect(() => parseCoordinateSyncCommand({ ...command(), selections: [...command().selections, ...command().selections] })).toThrow()
  expect(() => parseCoordinateSyncCommand({ ...command(), selections: [{ stopIndex: 0, siteId: 's1', latitude: 91, longitude: 100 }] })).toThrow()
})

it('can sync one selected stop in a valid trip with more than 180 KB of job descriptions', async () => {
  const large = { ...original(), stops: Array.from({ length: 18 }, (_, index) => ({ ...original().stops[0], order: index + 1, cargoDetails: 'A'.repeat(10_000) })) }
  await db.doc('trips/t1').set(large)
  const digest = await coordinateSyncDigest(large)
  expect(digest).toHaveLength(64)
  await expect(syncTripCoordinates(db, command({ baseline: digest }), actor.id)).resolves.toMatchObject({ updatedStops: 1 })
  expect((await readTrip()).stops[17].lat).toBe(13)
})
