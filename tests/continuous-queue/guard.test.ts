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

it('ห้ามลบทริปที่ยังถืองานที่คันอื่นโยกเข้ามา (งานจะหายเงียบ) · ห้ามลบ/ยกเลิกต้นทางด้วย · คืนงานแล้วลบได้', async () => {
  const db = staffDb()
  const job = { siteId: 'S', siteName: 'งานเอ', order: 1, cargoDetails: '' }
  const moved = { ...job, outcome: 'reassigned', reassignedToTripId: 'TB', reassignedToVehiclePlate: 'บี' }
  await createTripWithQueueGuard(db, 'TB', { tripDate: '2026-10-07', driverId: 'D2', vehicleId: 'V2', status: 'Planned', stops: [] })
  await createTripWithQueueGuard(db, 'TA', { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', stops: [moved] })
  await expect(deleteTripWithQueueGuard(db, 'TB')).rejects.toThrow('โยก')
  expect((await getDoc(doc(db, 'trips', 'TB'))).exists()).toBe(true)
  await expect(deleteTripWithQueueGuard(db, 'TA')).rejects.toThrow('โยกไปให้')
  await expect(updateTripWithQueueGuard(db, 'TA', { status: 'Cancelled' })).rejects.toThrow('โยกไปให้')
  expect((await getDoc(doc(db, 'trips', 'TA'))).data()?.status).toBe('Planned')
  await updateTripWithQueueGuard(db, 'TA', { stops: [job] }, undefined, { expectedStops: [moved] as any, sourceIndexes: [0] })
  await deleteTripWithQueueGuard(db, 'TB')
  expect((await getDoc(doc(db, 'trips', 'TB'))).exists()).toBe(false)
})

it('ปุ่ม "ยกเลิกงาน" ลบทริปที่เหลือจุดเดียวซึ่งโยกออกไปได้ (ตั้งใจยกเลิกงานจริง) · ต้นทางที่คันปลายทางหาย/ยกเลิกแล้วลบได้', async () => {
  const db = staffDb()
  const moved = (to: string) => [{ siteId: 'S', siteName: 'งานเอ', order: 1, cargoDetails: '', outcome: 'reassigned', reassignedToTripId: to, reassignedToVehiclePlate: 'บี' }]
  await createTripWithQueueGuard(db, 'TB', { tripDate: '2026-10-07', driverId: 'D2', vehicleId: 'V2', status: 'Planned', stops: [] })
  await createTripWithQueueGuard(db, 'TX', { tripDate: '2026-10-07', driverId: 'D3', vehicleId: 'V3', status: 'Cancelled', stops: [] })
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'trips', 'TA'), { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', stops: moved('TB') })
    await setDoc(doc(context.firestore(), 'trips', 'TC'), { tripDate: '2026-10-07', driverId: 'D4', vehicleId: 'V4', status: 'Planned', stops: moved('TX') })
    await setDoc(doc(context.firestore(), 'trips', 'TD'), { tripDate: '2026-10-07', driverId: 'D5', vehicleId: 'V5', status: 'Planned', stops: moved('GONE') })
  })
  // ส่ง expectedStops อย่างเดียว (กันข้อมูลเปลี่ยน) ไม่ได้แปลว่ายกเลิกงาน → ยังห้าม
  await expect(deleteTripWithQueueGuard(db, 'TA', moved('TB') as any)).rejects.toThrow('โยกไปให้')
  await deleteTripWithQueueGuard(db, 'TA', moved('TB') as any, undefined, { cancelJob: true })
  await deleteTripWithQueueGuard(db, 'TC')
  await deleteTripWithQueueGuard(db, 'TD')
  for (const id of ['TA', 'TC', 'TD']) expect((await getDoc(doc(db, 'trips', id))).exists()).toBe(false)
})

it('ทริปต้นทางที่ยกเลิกไปแล้วลบได้ (ไม่ถูกนับเป็นงานโยกเข้าอยู่แล้ว) · pointer ไปทริปคนละวันไม่บล็อกการลบ', async () => {
  const db = staffDb()
  const moved = (to: string) => [{ siteId: 'S', siteName: 'งานเอ', order: 1, cargoDetails: '', outcome: 'reassigned', reassignedToTripId: to, reassignedToVehiclePlate: 'บี' }]
  await createTripWithQueueGuard(db, 'LIVE', { tripDate: '2026-10-07', driverId: 'D2', vehicleId: 'V2', status: 'Planned', stops: [] })
  await createTripWithQueueGuard(db, 'NEXTDAY', { tripDate: '2026-10-08', driverId: 'D2', vehicleId: 'V2', status: 'Planned', stops: [] })
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'trips', 'OLD-CANCELLED'), { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Cancelled', stops: moved('LIVE') })
    await setDoc(doc(context.firestore(), 'trips', 'CROSS-DAY'), { tripDate: '2026-10-07', driverId: 'D3', vehicleId: 'V3', status: 'Planned', stops: moved('NEXTDAY') })
  })
  await deleteTripWithQueueGuard(db, 'OLD-CANCELLED')
  await deleteTripWithQueueGuard(db, 'CROSS-DAY')
  for (const id of ['OLD-CANCELLED', 'CROSS-DAY']) expect((await getDoc(doc(db, 'trips', id))).exists()).toBe(false)
})

it('ลบทริปพร้อมปลดใบที่เลื่อนไปวันใหม่ · ใบวันใหม่ถูกจัดรถแล้ว = ห้ามลบ', async () => {
  const db = staffDb()
  const stops = [{ siteId: 'S', siteName: 'งานเลื่อน', order: 1, cargoDetails: '', outcome: 'postponed', postponedRequestId: 'VR-NEW' }]
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'vehicleRequests', 'VR-NEW'), { status: 'rescheduled' })
    await setDoc(doc(context.firestore(), 'vehicleRequests', 'VR-DONE'), { status: 'approved' })
  })
  await createTripWithQueueGuard(db, 'TP', { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', stops })
  await deleteTripWithQueueGuard(db, 'TP', stops as any, { id: 'VR-NEW', by: 'คนจัดรถ' })
  expect((await getDoc(doc(db, 'trips', 'TP'))).exists()).toBe(false)
  let supersededStatus: unknown
  await env.withSecurityRulesDisabled(async context => { supersededStatus = (await getDoc(doc(context.firestore(), 'vehicleRequests', 'VR-NEW'))).data()?.status })
  expect(supersededStatus).toBe('superseded')
  const doneStops = [{ ...stops[0], postponedRequestId: 'VR-DONE' }]
  await createTripWithQueueGuard(db, 'TQ', { tripDate: '2026-10-07', driverId: 'D2', vehicleId: 'V2', status: 'Planned', stops: doneStops })
  await expect(deleteTripWithQueueGuard(db, 'TQ', doneStops as any, { id: 'VR-DONE', by: 'คนจัดรถ' })).rejects.toThrow('ถูกจัดรถแล้ว')
  expect((await getDoc(doc(db, 'trips', 'TQ'))).exists()).toBe(true)
})

it('โยกงานไปคันที่ไม่อยู่/ยกเลิกแล้ว (แท็บเก่า) = ปฏิเสธ · โยกสำเร็จแตะคันปลายทาง · ยกเลิกคันที่ถืองานโยกเข้า = ปฏิเสธ', async () => {
  const db = staffDb()
  const base = { tripDate: '2026-10-07', status: 'Planned' }
  const job = { siteId: 'S', siteName: 'งานเอ', order: 1, cargoDetails: '' }
  const moveTo = (to: string) => [{ ...job, outcome: 'reassigned', reassignedToTripId: to, reassignedToVehiclePlate: 'บี' }]
  const edit = { expectedStops: [job] as any, sourceIndexes: [0] }
  await createTripWithQueueGuard(db, 'SRC', { ...base, driverId: 'D1', vehicleId: 'V1', stops: [job] })
  await createTripWithQueueGuard(db, 'DST', { ...base, driverId: 'D2', vehicleId: 'V2', stops: [] })
  await createTripWithQueueGuard(db, 'DEAD', { ...base, status: 'Cancelled', driverId: 'D3', vehicleId: 'V3', stops: [] })
  await expect(updateTripWithQueueGuard(db, 'SRC', { stops: moveTo('GONE') }, undefined, edit)).rejects.toThrow('คันปลายทาง')
  await expect(updateTripWithQueueGuard(db, 'SRC', { stops: moveTo('DEAD') }, undefined, edit)).rejects.toThrow('คันปลายทาง')
  expect((await getDoc(doc(db, 'trips', 'SRC'))).data()?.stops[0].outcome).toBeUndefined()
  await updateTripWithQueueGuard(db, 'SRC', { stops: moveTo('DST') }, undefined, edit)
  expect((await getDoc(doc(db, 'trips', 'DST'))).data()?.incomingTouchedAt).toBeTruthy()
  await expect(updateTripWithQueueGuard(db, 'DST', { status: 'Cancelled' })).rejects.toThrow('ก่อนยกเลิก')
  expect((await getDoc(doc(db, 'trips', 'DST'))).data()?.status).toBe('Planned')
})

it('ทริปเก่าที่ใช้ฟิลด์ date: ลบคันปลายทางที่ยังถืองานโยกเข้าไม่ได้ ทั้งปลายทางหรือต้นทางเป็นแบบ date', async () => {
  const db = staffDb()
  const moved = (to: string) => [{ siteId: 'S', siteName: 'งานเอ', order: 1, cargoDetails: '', outcome: 'reassigned', reassignedToTripId: to, reassignedToVehiclePlate: 'บี' }]
  await env.withSecurityRulesDisabled(async context => {
    const fs = context.firestore()
    await setDoc(doc(fs, 'trips', 'OLD-DST'), { date: '2026-10-07', driverId: 'D2', vehicleId: 'V2', status: 'Planned', stops: [] })
    await setDoc(doc(fs, 'trips', 'NEW-SRC'), { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', stops: moved('OLD-DST') })
    await setDoc(doc(fs, 'trips', 'NEW-DST'), { tripDate: '2026-10-07', driverId: 'D3', vehicleId: 'V3', status: 'Planned', stops: [] })
    await setDoc(doc(fs, 'trips', 'OLD-SRC'), { date: '2026-10-07', driverId: 'D4', vehicleId: 'V4', status: 'Planned', stops: moved('NEW-DST') })
  })
  await expect(deleteTripWithQueueGuard(db, 'OLD-DST')).rejects.toThrow('ก่อนลบ')
  await expect(deleteTripWithQueueGuard(db, 'NEW-DST')).rejects.toThrow('ก่อนลบ')
})

it('โยกจุดที่สองไปคันที่หายแล้ว = ปฏิเสธ (ตรวจรายจุด) · แก้จุดอื่นโดย pointer เดิมไม่เปลี่ยน = ผ่าน', async () => {
  const db = staffDb()
  const base = { siteId: 'S', cargoDetails: '' }
  const stale = { ...base, siteName: 'งานเก่า', order: 1, outcome: 'reassigned', reassignedToTripId: 'GONE', reassignedToVehiclePlate: 'หาย' }
  const plain = { ...base, siteName: 'งานสอง', order: 2 }
  await createTripWithQueueGuard(db, 'SRC', { tripDate: '2026-10-07', status: 'Planned', driverId: 'D1', vehicleId: 'V1', stops: [stale, plain] })
  const edit = { expectedStops: [stale, plain] as any, sourceIndexes: [0, 1] }
  await expect(updateTripWithQueueGuard(db, 'SRC', { stops: [stale, { ...plain, outcome: 'reassigned', reassignedToTripId: 'GONE', reassignedToVehiclePlate: 'หาย' }] }, undefined, edit)).rejects.toThrow('คันปลายทาง')
  await updateTripWithQueueGuard(db, 'SRC', { stops: [stale, { ...plain, cargoDetails: 'แก้ของ' }] }, undefined, edit)
  expect((await getDoc(doc(db, 'trips', 'SRC'))).data()?.stops[1].cargoDetails).toBe('แก้ของ')
})

it('เปิดทริปที่ยกเลิกกลับ: แตะคันปลายทางที่ยังอยู่ (ลบที่ชนกันต้อง retry) · คันปลายทางที่หายแล้วไม่บล็อกการเปิดกลับ', async () => {
  const db = staffDb()
  const base = { tripDate: '2026-10-07', status: 'Planned' }
  const job = { siteId: 'S', siteName: 'งานเอ', order: 1, cargoDetails: '' }
  const moved = (to: string) => [{ ...job, outcome: 'reassigned', reassignedToTripId: to, reassignedToVehiclePlate: 'บี' }]
  await createTripWithQueueGuard(db, 'LIVE', { ...base, driverId: 'D2', vehicleId: 'V2', stops: [] })
  // ทริปต้นทางที่ถูกยกเลิกไว้ก่อนมีกติกาห้ามยกเลิกต้นทาง (ข้อมูลเก่า)
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'trips', 'A1'), { ...base, status: 'Cancelled', driverId: 'D1', vehicleId: 'V1', stops: moved('LIVE') })
    await setDoc(doc(context.firestore(), 'trips', 'A2'), { ...base, status: 'Cancelled', driverId: 'D4', vehicleId: 'V4', stops: moved('GONE') })
  })
  expect((await getDoc(doc(db, 'trips', 'LIVE'))).data()?.incomingTouchedAt).toBeUndefined()
  await updateTripWithQueueGuard(db, 'A1', { status: 'Planned' })
  expect((await getDoc(doc(db, 'trips', 'LIVE'))).data()?.incomingTouchedAt).toBeTruthy()
  await updateTripWithQueueGuard(db, 'A2', { status: 'Planned' })
  expect((await getDoc(doc(db, 'trips', 'A2'))).data()?.status).toBe('Planned')
})

it('ทริปเก่าแบบ date: สร้างคันรับโยกใหม่ได้ · ทริปที่ date ค้างคนละวันกับ tripDate ไม่นับเป็นงานโยกเข้า', async () => {
  const db = staffDb()
  const job = { siteId: 'S', siteName: 'งานเอ', order: 1, cargoDetails: '' }
  await env.withSecurityRulesDisabled(async context => {
    const fs = context.firestore()
    await setDoc(doc(fs, 'trips', 'OLD'), { date: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', stops: [job] })
    await setDoc(doc(fs, 'trips', 'B8'), { tripDate: '2026-10-08', driverId: 'D5', vehicleId: 'V5', status: 'Planned', stops: [] })
    await setDoc(doc(fs, 'trips', 'MIXED'), { tripDate: '2026-10-09', date: '2026-10-08', driverId: 'D6', vehicleId: 'V6', status: 'Planned', stops: [{ ...job, outcome: 'reassigned', reassignedToTripId: 'B8', reassignedToVehiclePlate: 'บี' }] })
  })
  const holder = { tripDate: '2026-10-07', status: 'Planned', driverId: 'D2', vehicleId: 'V2', stops: [] }
  await updateTripWithQueueGuard(db, 'OLD', { stops: [{ ...job, outcome: 'reassigned', reassignedToTripId: 'HOLD', reassignedToVehiclePlate: 'บี' }] }, undefined, { expectedStops: [job] as any, sourceIndexes: [0], createTarget: { id: 'HOLD', data: holder } })
  expect((await getDoc(doc(db, 'trips', 'HOLD'))).exists()).toBe(true)
  await deleteTripWithQueueGuard(db, 'B8')
  expect((await getDoc(doc(db, 'trips', 'B8'))).exists()).toBe(false)
})
