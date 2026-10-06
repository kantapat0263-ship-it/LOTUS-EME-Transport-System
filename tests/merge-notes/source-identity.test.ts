import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, setLogLevel, type Firestore, type Transaction } from 'firebase/firestore'
import { createTripWithQueueGuard, updateTripWithQueueGuard } from '@/lib/tripQueueGuard'
import { requestDestinationFingerprint } from '@/lib/requestDestination'
import type { Trip } from '@/types/models'

let env: RulesTestEnvironment
const probe = vi.hoisted(() => ({ hook: null as ((path: string) => Promise<void>) | null, attempts: 0 }))
vi.mock('firebase/firestore', async importOriginal => {
  const sdk = await importOriginal<typeof import('firebase/firestore')>()
  return { ...sdk, runTransaction: (db: Firestore, work: (tx: Transaction) => Promise<unknown>) => sdk.runTransaction(db, async tx => {
    probe.attempts++
    return work(new Proxy(tx, { get(target, key) {
      if (key === 'get') return async (ref: ReturnType<typeof doc>) => { const snap = await target.get(ref); if (probe.hook) await probe.hook(ref.path); return snap }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } }))
  }) }
})
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8183') throw new Error('Use isolated localhost emulator only')
  setLogLevel('silent')
  env = await initializeTestEnvironment({ projectId: 'demo-merge-notes', firestore: { host: '127.0.0.1', port: 8183, rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => { probe.hook = null; probe.attempts = 0; await env.clearFirestore(); await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'staff'), { role: 'dispatcher', active: true })) })
afterAll(async () => { await env?.cleanup() })
const request = () => ({ requestId: 'VR-0710-0001', requestDate: '2026-10-07', status: 'in_progress', requestedBy: 'ผู้ขอ', destinations: [{ siteName: 'A', jobDescription: 'ส่ง A', lat: 13, lng: 100, requestTime: '08:30' }, { siteName: 'B' }] })
const trip = (): Trip => ({ id: 'T1', tripId: 'T1', tripDate: '2026-10-07', driverId: 'D1', driverName: 'หนึ่ง', vehicleId: 'V1', vehiclePlate: 'รถหนึ่ง', departureSiteId: '', status: 'Planned', stops: [{ siteName: 'A', siteId: 'A', order: 1, cargoDetails: 'ส่ง A' }] })
const sources = (value = request()) => ({ assignments: [{ requestId: 'R1', destinationIndexes: [0], expectedDestinationFingerprints: [requestDestinationFingerprint(value, 0)] }] })
async function setup() { await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), request())); return env.authenticatedContext('staff').firestore() as unknown as Firestore }
const changeRequest = (patch: Record<string, any>) => env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), patch))

it.each(['siteName', 'jobDescription', 'lat', 'requestTime', 'shift'])('stale source %s ห้ามสร้างทริปหรือจัด index ของงานอื่น', async field => {
  const db = await setup(), value = request()
  await changeRequest({ destinations: field === 'shift' ? [...value.destinations].reverse() : [{ ...value.destinations[0], [field]: field === 'lat' ? 14 : 'เปลี่ยน' }, value.destinations[1]] })
  await expect(createTripWithQueueGuard(db, 'T1', trip(), sources())).rejects.toThrow('เปลี่ยน')
  expect((await getDoc(doc(db, 'trips', 'T1'))).exists()).toBe(false)
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.assignedDestinations).toBeUndefined()
  expect((await getDoc(doc(db, 'queueResourceDays', 'driver__D1__2026-10-07'))).exists()).toBe(false)
})
it('old tab ไม่มี snapshot ต้องให้เลือกงานใหม่', async () => {
  const db = await setup()
  await expect(createTripWithQueueGuard(db, 'T1', trip(), { assignments: [{ requestId: 'R1', destinationIndexes: [0] }] })).rejects.toThrow('โหลด')
  expect((await getDoc(doc(db, 'trips', 'T1'))).exists()).toBe(false)
})
it('retry อ่าน request ใหม่แล้วต้องหยุด stale allocation ทั้งหมด', async () => {
  const db = await setup()
  probe.hook = async path => { if (path !== 'vehicleRequests/R1') return; probe.hook = null; await changeRequest({ destinations: [...request().destinations].reverse() }) }
  await expect(createTripWithQueueGuard(db, 'T1', trip(), sources())).rejects.toThrow('เปลี่ยน')
  expect(probe.attempts).toBeGreaterThanOrEqual(2)
  expect((await getDoc(doc(db, 'trips', 'T1'))).exists()).toBe(false)
})
it('แก้หมายเหตุ/จุดอื่นแล้วจัดงานเดิมได้ และเก็บหมายเหตุสด', async () => {
  const db = await setup()
  await changeRequest({ destinations: [request().destinations[0], { siteName: 'B ใหม่' }], stopNotes: { stop_0: 'ล่าสุด' }, stopNoteAuthors: { stop_0: 'ผู้จัด' } })
  await createTripWithQueueGuard(db, 'T1', trip(), { assignments: [{ ...sources().assignments[0], tripStopIndexes: [0] }] })
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops[0]).toMatchObject({ dispatcherNote: 'ล่าสุด', dispatcherName: 'ผู้จัด' })
})
it('หลายใบมีใบหนึ่ง stale ต้องไม่จัดใบแรกหรือเขียนทริปบางส่วน', async () => {
  const db = await setup(), second = { ...request(), requestId: 'VR-0710-0002' }
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'vehicleRequests', 'R2'), { ...second, requestedBy: 'เปลี่ยน' }))
  await expect(createTripWithQueueGuard(db, 'T1', trip(), { assignments: [...sources().assignments, { requestId: 'R2', destinationIndexes: [0], expectedDestinationFingerprints: [requestDestinationFingerprint(second, 0)] }] })).rejects.toThrow('เปลี่ยน')
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.assignedDestinations).toBeUndefined()
  expect((await getDoc(doc(db, 'trips', 'T1'))).exists()).toBe(false)
})

const target = (): Trip => ({ ...trip(), id: 'T2', tripId: 'T2', driverId: 'D2', vehicleId: 'V2', stops: [] })
const assist = () => ({ tripId: 'T1', stopIndex: 0, expectedTrip: trip() })
const createAssist = (db: Firestore) => (createTripWithQueueGuard as any)(db, 'T2', { ...target(), stops: [{ ...trip().stops[0], assistForPlate: 'รถหนึ่ง' }] }, undefined, assist())
it.each(['deleted', 'cancelled', 'cargo', 'driver', 'vehicle', 'date', 'managed'])('คันช่วยห้ามคัดลอกต้นทางที่ %s แล้ว', async change => {
  const db = await setup(); await createTripWithQueueGuard(db, 'T1', trip())
  await env.withSecurityRulesDisabled(async context => {
    const ref = doc(context.firestore(), 'trips', 'T1')
    if (change === 'deleted') await deleteDoc(ref)
    else await updateDoc(ref, change === 'cancelled' ? { status: 'Cancelled' } : change === 'cargo' ? { stops: [{ ...trip().stops[0], cargoDetails: 'ใหม่' }] } : change === 'driver' ? { actualDriverId: 'D3', actualDriverName: 'สาม' } : change === 'vehicle' ? { vehicleId: 'V3' } : change === 'date' ? { tripDate: '2026-10-08' } : { queueLink: { bookingId: 'B1' } })
  })
  await expect(createAssist(db)).rejects.toThrow()
  expect((await getDoc(doc(db, 'trips', 'T2'))).exists()).toBe(false)
  expect((await getDoc(doc(db, 'queueResourceDays', 'vehicle__V2__2026-10-07'))).exists()).toBe(false)
})
it('คันช่วยในทริปเดิมตรวจ source พร้อม target จึงไม่เพิ่มงานจากต้นทางที่เปลี่ยน', async () => {
  const db = await setup(); await createTripWithQueueGuard(db, 'T1', trip()); await createTripWithQueueGuard(db, 'T2', target())
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops: [{ ...trip().stops[0], outcome: 'driver-refused' }] }))
  await expect(updateTripWithQueueGuard(db, 'T2', { stops: trip().stops }, undefined, { expectedStops: [], sourceIndexes: [null], assistSource: assist() } as any)).rejects.toThrow()
  expect((await getDoc(doc(db, 'trips', 'T2'))).data()?.stops).toEqual([])
})
it('คันช่วย retry เมื่อ source เปลี่ยนระหว่างอ่านและต้องไม่เขียน target', async () => {
  const db = await setup(); await createTripWithQueueGuard(db, 'T1', trip()); probe.attempts = 0
  probe.hook = async path => { if (path !== 'trips/T1') return; probe.hook = null; await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), path), { stops: [{ ...trip().stops[0], cargoDetails: 'เปลี่ยนระหว่างรอ' }] })) }
  await expect(createAssist(db)).rejects.toThrow()
  expect(probe.attempts).toBeGreaterThanOrEqual(2)
  expect((await getDoc(doc(db, 'trips', 'T2'))).exists()).toBe(false)
})
it.each(['new', 'existing'])('คันช่วย %s source เดิมยังตรงและเก็บหมายเหตุสดรวม legacy map', async mode => {
  const db = await setup(); await createTripWithQueueGuard(db, 'T1', trip())
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stopNotes: { stop_0: 'ล่าสุด' }, stopNoteAuthors: { stop_0: 'ผู้จัดล่าสุด' } }))
  if (mode === 'new') await createAssist(db)
  else { await createTripWithQueueGuard(db, 'T2', target()); await updateTripWithQueueGuard(db, 'T2', { stops: trip().stops }, undefined, { expectedStops: [], sourceIndexes: [null], assistSource: assist() } as any) }
  expect((await getDoc(doc(db, 'trips', 'T2'))).data()?.stops[0]).toMatchObject({ dispatcherNote: 'ล่าสุด', dispatcherName: 'ผู้จัดล่าสุด' })
})
it('คันช่วย source note-only race retry ใช้ค่ารอบสุดท้ายทั้งในฐานและ return value', async () => {
  const db = await setup(); await createTripWithQueueGuard(db, 'T1', trip()); probe.attempts = 0
  probe.hook = async path => { if (path !== 'trips/T1') return; probe.hook = null; await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), path), { stops: [{ ...trip().stops[0], dispatcherNote: 'แก้ระหว่างรอ', dispatcherName: 'ผู้จัดใหม่' }] })) }
  const saved = await createAssist(db)
  expect(probe.attempts).toBeGreaterThanOrEqual(2)
  expect(saved.stops[0]).toMatchObject({ dispatcherNote: 'แก้ระหว่างรอ', dispatcherName: 'ผู้จัดใหม่' })
  expect((await getDoc(doc(db, 'trips', 'T2'))).data()?.stops).toEqual(saved.stops)
})
it('คันช่วย viewer เขียนไม่ได้และไม่เพิ่มทริป/guard บางส่วน', async () => {
  const db = await setup(); await createTripWithQueueGuard(db, 'T1', trip())
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'viewer'), { role: 'viewer', active: true }))
  await expect(createAssist(env.authenticatedContext('viewer').firestore() as unknown as Firestore)).rejects.toThrow()
  expect((await getDoc(doc(db, 'trips', 'T2'))).exists()).toBe(false)
  expect((await getDoc(doc(db, 'queueResourceDays', 'vehicle__V2__2026-10-07'))).exists()).toBe(false)
})
