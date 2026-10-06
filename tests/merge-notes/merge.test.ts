import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, setLogLevel, type Firestore, type Transaction } from 'firebase/firestore'
import { createTripWithQueueGuard, updateTripWithQueueGuard } from '@/lib/tripQueueGuard'

let env: RulesTestEnvironment
const probe = vi.hoisted(() => ({ afterRequestRead: null as (() => Promise<void>) | null, attempts: 0 }))
vi.mock('firebase/firestore', async importOriginal => {
  const sdk = await importOriginal<typeof import('firebase/firestore')>()
  return { ...sdk, runTransaction: (db: Firestore, work: (tx: Transaction) => Promise<unknown>) => sdk.runTransaction(db, async tx => {
    probe.attempts++
    return work(new Proxy(tx, { get(target, key) {
      if (key === 'get') return async (ref: ReturnType<typeof doc>) => {
        const snap = await target.get(ref)
        if (ref.path.startsWith('vehicleRequests/') && probe.afterRequestRead) {
          const hook = probe.afterRequestRead
          probe.afterRequestRead = null
          await hook()
        }
        return snap
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } }))
  }) }
})
const staffDb = () => env.authenticatedContext('staff').firestore() as unknown as Firestore
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8183') throw new Error('Run only against the isolated merge-note emulator on 127.0.0.1:8183')
  setLogLevel('silent')
  env = await initializeTestEnvironment({ projectId: 'demo-merge-notes', firestore: { host: '127.0.0.1', port: 8183, rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => {
  probe.afterRequestRead = null
  probe.attempts = 0
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'users', 'staff'), { role: 'dispatcher', active: true }) })
})
afterAll(async () => { await env?.cleanup() })

const ordinary = () => ({ tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', stops: [{ order: 1, siteId: 'OLD', siteName: 'งานเดิม', cargoDetails: '', dispatcherNote: 'อย่าเปลี่ยนงานเดิม' }] })
const request = () => ({ requestId: 'VR-0710-0001', requestDate: '2026-10-07', status: 'in_progress', destinations: [{ siteName: 'A' }], stopNotes: { stop_0: 'หมายเหตุล่าสุด' }, stopNoteAuthors: { stop_0: 'ชื่อปัจจุบัน' } })
async function setup() {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), request()))
  const db = staffDb()
  await createTripWithQueueGuard(db, 'T1', ordinary())
  return db
}
const allocation = () => ({ assignments: [{ requestId: 'R1', destinationIndexes: [0], tripStopIndexes: [1] }] })
const patch = () => ({ stops: [...ordinary().stops, { order: 2, siteId: 'A', siteName: 'A', cargoDetails: '', dispatcherNote: 'ข้อความเก่า', dispatcherName: 'คนเดิม' }] })

it('ผู้เรียกเดิมที่ไม่ส่ง index หมายเหตุยังรักษา stop และ metadata ที่ส่งมา', async () => {
  const db = await setup()
  const input = patch()
  await updateTripWithQueueGuard(db, 'T1', input, { assignments: [{ requestId: 'R1', destinationIndexes: [0] }], metadata: { approvedBy: 'คนจัดคิวเดิม' } })
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops).toEqual(input.stops)
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()).toMatchObject({ status: 'approved', approvedBy: 'คนจัดคิวเดิม' })
})

it('การแก้ทั่วไปที่ไม่มี assignments ไม่เพิ่มฟิลด์ stops หรือแก้หมายเหตุ', async () => {
  const db = await setup()
  await updateTripWithQueueGuard(db, 'T1', { totalDistanceKm: 99 })
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()).toMatchObject({ totalDistanceKm: 99, stops: ordinary().stops })
})

it('ห้ามสองจุดของใบเดียวกันหรือสองใบผูกหมายเหตุลง stop เดียวกัน', async () => {
  const db = await setup()
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { destinations: [{ siteName: 'A' }, { siteName: 'B' }] })
    await setDoc(doc(context.firestore(), 'vehicleRequests', 'R2'), { ...request(), requestId: 'VR-0710-0002' })
  })
  await expect(updateTripWithQueueGuard(db, 'T1', patch(), { assignments: [{ requestId: 'R1', destinationIndexes: [0, 1], tripStopIndexes: [1, 1] }] })).rejects.toThrow('ซ้ำ')
  await expect(updateTripWithQueueGuard(db, 'T1', patch(), { assignments: [
    { requestId: 'R1', destinationIndexes: [0], tripStopIndexes: [1] }, { requestId: 'R2', destinationIndexes: [0], tripStopIndexes: [1] },
  ] })).rejects.toThrow('หมายเหตุ')
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops).toEqual(ordinary().stops)
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.status).toBe('in_progress')
  expect((await getDoc(doc(db, 'vehicleRequests', 'R2'))).data()?.status).toBe('in_progress')
})

it('แก้หมายเหตุหลัง transaction อ่านแล้วทำให้ retry และบันทึกค่ารอบสุดท้าย', async () => {
  const db = await setup()
  const input = patch()
  const original = structuredClone(input)
  probe.attempts = 0
  probe.afterRequestRead = () => env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { 'stopNotes.stop_0': 'แก้ระหว่าง transaction', 'stopNoteAuthors.stop_0': 'คนแก้พร้อมกัน' }))
  await updateTripWithQueueGuard(db, 'T1', input, allocation())
  expect(probe.attempts).toBeGreaterThanOrEqual(2)
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops[1]).toMatchObject({ dispatcherNote: 'แก้ระหว่าง transaction', dispatcherName: 'คนแก้พร้อมกัน' })
  expect(input).toEqual(original)
})

it('ล้างหมายเหตุแล้วไม่ฟื้นข้อความเก่าจาก dialog และไม่มีชื่อคนเก่า', async () => {
  const db = await setup()
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { stopNotes: {}, stopNoteAuthors: {} }))
  await updateTripWithQueueGuard(db, 'T1', patch(), allocation())
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops[1]).toMatchObject({ dispatcherNote: '', dispatcherName: '' })
})

it('ชื่อผู้บันทึกรุ่นเก่า fallback ได้เมื่อไม่มีชื่อรายจุด', async () => {
  const db = await setup()
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { stopNoteAuthors: {}, stopNotesUpdatedBy: 'ชื่อรุ่นเก่า' }))
  await updateTripWithQueueGuard(db, 'T1', patch(), allocation())
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops[1]).toMatchObject({ dispatcherNote: 'หมายเหตุล่าสุด', dispatcherName: 'ชื่อรุ่นเก่า' })
})

it('รวมสองใบที่สลับจุดแล้วพกหมายเหตุถูกจุดและรักษางานเดิม รหัส และสถานะ partial', async () => {
  const db = await setup()
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { destinations: [{ siteName: 'A0' }, { siteName: 'A1' }, { siteName: 'A2' }], stopNotes: { stop_0: 'A0 ล่าสุด', stop_2: 'A2 ล่าสุด' } })
    await setDoc(doc(context.firestore(), 'vehicleRequests', 'R2'), { ...request(), requestId: 'VR-0710-0002', destinations: [{ siteName: 'B0' }, { siteName: 'B1' }], stopNotes: { stop_1: 'B1 ล่าสุด' } })
  })
  const input = { stops: [...ordinary().stops, { siteName: 'A2' }, { siteName: 'B1' }, { siteName: 'A0' }] }
  await updateTripWithQueueGuard(db, 'T1', input, { assignments: [
    { requestId: 'R1', destinationIndexes: [2, 0], tripStopIndexes: [1, 3] },
    { requestId: 'R2', destinationIndexes: [1], tripStopIndexes: [2] },
  ] })
  const trip = (await getDoc(doc(db, 'trips', 'T1'))).data()!
  expect(trip.stops.map((s: { dispatcherNote: string }) => s.dispatcherNote)).toEqual(['อย่าเปลี่ยนงานเดิม', 'A2 ล่าสุด', 'B1 ล่าสุด', 'A0 ล่าสุด'])
  expect(trip.stops[0]).toEqual(ordinary().stops[0])
  expect(trip.sourceVRIds).toEqual(['VR-0710-0001', 'VR-0710-0002'])
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()).toMatchObject({ status: 'partial', assignedDestinations: [2, 0], requestId: 'VR-0710-0001' })
  expect((await getDoc(doc(db, 'vehicleRequests', 'R2'))).data()).toMatchObject({ status: 'partial', assignedDestinations: [1] })
})

it.each([{ indexes: [0] }, { indexes: [2] }, { indexes: [1, 1] }, { indexes: [] }, { indexes: [-1] }, { indexes: [1.5] }])('index หมายเหตุผิดหรือทับงานเดิม $indexes ต้องไม่เขียนอะไร', async ({ indexes }) => {
  const db = await setup()
  const before = (await getDoc(doc(db, 'trips', 'T1'))).data()
  const guards = (await getDoc(doc(db, 'queueResourceDays', 'driver__D1__2026-10-07'))).data()
  await expect(updateTripWithQueueGuard(db, 'T1', patch(), { assignments: [{ requestId: 'R1', destinationIndexes: [0], tripStopIndexes: indexes }] })).rejects.toThrow('หมายเหตุ')
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()).toEqual(before)
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.status).toBe('in_progress')
  expect((await getDoc(doc(db, 'queueResourceDays', 'driver__D1__2026-10-07'))).data()).toEqual(guards)
})

it.each(['cancelled', 'approved'])('ใบขอเปลี่ยนเป็น %s แล้วห้ามรวมและฟื้นสถานะ', async status => {
  const db = await setup()
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { status }))
  await expect(updateTripWithQueueGuard(db, 'T1', patch(), allocation())).rejects.toThrow('เปลี่ยนสถานะ')
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops).toEqual(ordinary().stops)
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.status).toBe(status)
})

it('ทริปเปลี่ยนหลังอ่าน snapshot แล้วปฏิเสธการรวมโดยรักษาหมายเหตุที่เพิ่งแก้', async () => {
  const db = await setup()
  const changed = { ...ordinary().stops[0], dispatcherNote: 'อีกคนแก้ไว้แล้ว' }
  await updateTripWithQueueGuard(db, 'T1', { stops: [changed] })
  await expect(updateTripWithQueueGuard(db, 'T1', patch(), { ...allocation(), expected: { ...ordinary(), sourceVRIds: [] } })).rejects.toThrow('เปลี่ยนระหว่าง')
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops).toEqual([changed])
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.status).toBe('in_progress')
})

it('ผู้ใช้ทั่วไปเรียกการรวมแบบใหม่ก็ถูก rules ปฏิเสธและไม่มีการเขียนครึ่งเดียว', async () => {
  const db = await setup()
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'viewer'), { role: 'viewer', active: true }))
  await expect(updateTripWithQueueGuard(env.authenticatedContext('viewer').firestore() as unknown as Firestore, 'T1', patch(), allocation())).rejects.toThrow()
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops).toEqual(ordinary().stops)
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.status).toBe('in_progress')
})

it('รวมเที่ยวที่เปิดค้างแล้วใช้หมายเหตุและชื่อจากใบขอปัจจุบัน', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), {
    requestId: 'VR-0710-0001', requestDate: '2026-10-07', status: 'in_progress', destinations: [{ siteName: 'A' }],
    stopNotes: { stop_0: 'โทรหาหน้างานก่อนเข้า' }, stopNoteAuthors: { stop_0: 'ผู้จัดคิวล่าสุด' },
  }))
  const db = staffDb()
  await createTripWithQueueGuard(db, 'T1', { tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', stops: [] })
  await updateTripWithQueueGuard(db, 'T1', { stops: [{ siteName: 'A', dispatcherNote: 'ข้อความเก่าตอนเปิด dialog', dispatcherName: 'คนเดิม' }] }, {
    assignments: [{ requestId: 'R1', destinationIndexes: [0], tripStopIndexes: [0] }],
  })
  expect((await getDoc(doc(db, 'trips', 'T1'))).data()?.stops[0]).toMatchObject({ dispatcherNote: 'โทรหาหน้างานก่อนเข้า', dispatcherName: 'ผู้จัดคิวล่าสุด' })
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()).toMatchObject({ status: 'approved', assignedDestinations: [0], tripIds: ['T1'] })
})
