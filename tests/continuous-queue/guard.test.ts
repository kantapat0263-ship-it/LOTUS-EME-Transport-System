import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, deleteField, updateDoc, deleteDoc, setLogLevel, type Firestore } from 'firebase/firestore'
import { assertFails } from '@firebase/rules-unit-testing'
import { createTripWithQueueGuard, updateTripWithQueueGuard, deleteTripWithQueueGuard } from '@/lib/tripQueueGuard'
import { requestDestinationFingerprint } from '@/lib/requestDestination'

let env: RulesTestEnvironment
// Rules test contexts return compat instances; the modular SDK unwraps them.
const staffDb = () => env.authenticatedContext('staff').firestore() as unknown as Firestore
beforeAll(async () => { setLogLevel('silent'); env = await initializeTestEnvironment({ projectId: 'demo-continuous-queue-guard', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } }) })
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'users', 'staff'), { role: 'dispatcher', active: true }) })
})

it('ล้างคนขับแทนแล้วแตะ guard คนเดิม คนใหม่ และรถ พร้อมเก็บงานเดิม', async () => {
  const db = staffDb()
  await createTripWithQueueGuard(db, 'T1', { tripDate: '2026-10-07', driverId: 'D1', actualDriverId: 'D2', vehicleId: 'V1', status: 'Planned', stops: [{ siteName: 'A' }] })
  await updateTripWithQueueGuard(db, 'T1', { actualDriverId: deleteField(), actualDriverName: deleteField() })
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.actualDriverId).toBeUndefined()
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops).toEqual([{ siteName: 'A' }])
  expect((await getDoc(doc(db, 'queueResourceDays', 'driver__D1__2026-10-07'))).data()?.version).toBe(1)
  expect((await getDoc(doc(db, 'queueResourceDays', 'driver__D2__2026-10-07'))).data()?.version).toBe(2)
  expect((await getDoc(doc(db, 'queueResourceDays', 'vehicle__V1__2026-10-07'))).data()?.version).toBe(2)
})

it('ลบทริปทั่วไปพร้อมแตะ guard เพื่อให้การจองที่เกิดพร้อมกันตรวจใหม่', async () => {
  const db = staffDb()
  await createTripWithQueueGuard(db, 'T1', { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned' })
  await deleteTripWithQueueGuard(db, 'T1')
  expect((await getDoc(doc(db, 'trips', 'T1'))).exists()).toBe(false)
  expect((await getDoc(doc(db, 'queueResourceDays', 'driver__D1__2026-10-07'))).data()?.version).toBe(2)
})

it('ห้าม staff เขียน ลบ หรือล้าง link คิวต่อเนื่องตรงผ่าน Firestore', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'trips', 'MANAGED'), { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', queueLink: { bookingId: 'B1', kind: 'day', date: '2026-10-07' } }))
  const db = staffDb()
  await assertFails(updateDoc(doc(db, 'trips', 'MANAGED'), { queueLink: deleteField() }))
  await assertFails(updateDoc(doc(db, 'trips', 'MANAGED'), { driverId: 'D2' }))
  await assertFails(deleteDoc(doc(db, 'trips', 'MANAGED')))
})

it('การจัดรถโดยไม่แตะ guard ใน transaction เดียวกันต้องไม่ผ่าน rules', async () => {
  const db = staffDb()
  await assertFails(setDoc(doc(db, 'trips', 'DIRECT'), { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned' }))
})

it('ทริปที่ยกเลิกห้ามกลับมาใช้คนขับที่ถูกจอง และห้ามปลอม reservation', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'trips', 'OLD'), { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Cancelled' })
    await setDoc(doc(context.firestore(), 'queueResourceDays', 'driver__D1__2026-10-07'), { version: 2, bookingId: 'B1', tripId: 'MANAGED' })
  })
  const db = staffDb()
  await expect(updateTripWithQueueGuard(db, 'OLD', { status: 'Planned' })).rejects.toThrow('มีคิวต่อเนื่อง')
  await assertFails(updateDoc(doc(db, 'queueResourceDays', 'driver__D1__2026-10-07'), { version: 3, bookingId: '' }))
  await expect(createTripWithQueueGuard(db, 'NEW', { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V2', status: 'Planned' })).rejects.toThrow('มีคิวต่อเนื่อง')
  expect((await getDoc(doc(db, 'trips', 'OLD'))).data()?.status).toBe('Cancelled')
  expect((await getDoc(doc(db, 'trips', 'NEW'))).exists()).toBe(false)
})
afterAll(async () => { await env?.cleanup() })

it('แก้และลบทริปเก่าที่เก็บ date โดยแตะ guard ของวันที่จริง', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'trips', 'LEGACY'), { date: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned' }))
  const db = staffDb()
  await updateTripWithQueueGuard(db, 'LEGACY', { status: 'Cancelled' })
  expect((await getDoc(doc(db, 'queueResourceDays', 'driver__D1__2026-10-07'))).data()?.version).toBe(1)
  await deleteTripWithQueueGuard(db, 'LEGACY')
  expect((await getDoc(doc(db, 'queueResourceDays', 'vehicle__V1__2026-10-07'))).data()?.version).toBe(2)
  expect((await getDoc(doc(db, 'trips', 'LEGACY'))).exists()).toBe(false)
})

it('ทริปเก่าที่เก็บ date ห้ามฟื้นคืนมาจองทรัพยากรของคิวต่อเนื่อง', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'trips', 'LEGACY'), { date: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Cancelled' })
    await setDoc(doc(context.firestore(), 'queueResourceDays', 'driver__D1__2026-10-07'), { version: 2, bookingId: 'B1', tripId: 'MANAGED' })
  })
  await expect(updateTripWithQueueGuard(staffDb(), 'LEGACY', { status: 'Planned' })).rejects.toThrow('มีคิวต่อเนื่อง')
})

it('สร้างทริปพร้อมเพิ่ม version ของคนขับจริงและรถใน transaction เดียวกัน', async () => {
  const db = staffDb()
  await createTripWithQueueGuard(db, 'T1', { id: 'T1', tripId: 'T1', tripDate: '2026-10-07', driverId: 'D1', actualDriverId: 'D2', vehicleId: 'V1', status: 'Planned', stops: [] })
  expect((await getDoc(doc(db, 'trips', 'T1'))).exists()).toBe(true)
  expect((await getDoc(doc(db, 'queueResourceDays', 'driver__D2__2026-10-07'))).data()?.version).toBe(1)
  expect((await getDoc(doc(db, 'queueResourceDays', 'vehicle__V1__2026-10-07'))).data()?.version).toBe(1)
})

it('จัดจุดของใบขอพร้อมทริปและรักษารายการที่จัดบางส่วนโดยไม่ให้จัดจุดซ้ำ', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { requestId: 'VR-0710-0001', requestDate: '2026-10-07', status: 'in_progress', destinations: [{ siteName: 'A' }, { siteName: 'B' }] }))
  const db = staffDb()
  const source = { requestId: 'VR-0710-0001', requestDate: '2026-10-07', destinations: [{ siteName: 'A' }, { siteName: 'B' }] }
  await createTripWithQueueGuard(db, 'T1', { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', stops: [{ siteName: 'A' }] }, { assignments: [{ requestId: 'R1', destinationIndexes: [0], expectedDestinationFingerprints: [requestDestinationFingerprint(source, 0)] }] })
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()).toMatchObject({ status: 'partial', assignedDestinations: [0], tripId: null, tripIds: ['T1'] })
  await expect(createTripWithQueueGuard(db, 'T2', { tripDate: '2026-10-07', driverId: 'D2', vehicleId: 'V2', status: 'Planned' }, { assignments: [{ requestId: 'R1', destinationIndexes: [0] }] })).rejects.toThrow('จัดรถแล้ว')
  expect((await getDoc(doc(db, 'trips', 'T2'))).exists()).toBe(false)
  await updateTripWithQueueGuard(db, 'T1', { stops: [{ siteName: 'A' }, { siteName: 'B' }] }, { assignments: [{ requestId: 'R1', destinationIndexes: [1], expectedDestinationFingerprints: [requestDestinationFingerprint(source, 1)] }], expected: { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', stops: [{ siteName: 'A' } as any] } })
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()).toMatchObject({ status: 'approved', assignedDestinations: [0, 1], tripId: 'T1', tripIds: ['T1'] })
})

it('ยกเลิกใบขอหรือทริปเปลี่ยนระหว่างรวมงานต้องไม่เขียนทริปหรือฟื้นใบขอ', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { requestDate: '2026-10-07', status: 'cancelled', destinations: [{ siteName: 'A' }] }))
  const db = staffDb()
  const ordinary = { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', stops: [] }
  await expect(createTripWithQueueGuard(db, 'T1', ordinary, { assignments: [{ requestId: 'R1', destinationIndexes: [0] }] })).rejects.toThrow('เปลี่ยนสถานะ')
  expect((await getDoc(doc(db, 'trips', 'T1'))).exists()).toBe(false)
  await createTripWithQueueGuard(db, 'T1', ordinary)
  await expect(updateTripWithQueueGuard(db, 'T1', { stops: [{ siteName: 'B' }] }, { assignments: [], expected: { tripDate: ordinary.tripDate, driverId: 'D1', vehicleId: 'V1', stops: [{ siteId: 'A', siteName: 'changed', order: 1, cargoDetails: 'old' }] } })).rejects.toThrow('เปลี่ยนระหว่าง')
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops).toEqual([])
})
