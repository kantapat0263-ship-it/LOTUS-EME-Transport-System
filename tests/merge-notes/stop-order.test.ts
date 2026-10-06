import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, setLogLevel, type Firestore, type Transaction } from 'firebase/firestore'
import { createTripWithQueueGuard, updateTripWithQueueGuard } from '@/lib/tripQueueGuard'
import { incomingStopsForTrip } from '@/lib/calculations'
import type { Trip } from '@/types/models'
import type { LegacyStopNotes } from '@/lib/stopNote'

let env: RulesTestEnvironment
const probe = vi.hoisted(() => ({ afterTripRead: null as (() => Promise<void>) | null, attempts: 0 }))
vi.mock('firebase/firestore', async importOriginal => {
  const sdk = await importOriginal<typeof import('firebase/firestore')>()
  return { ...sdk, runTransaction: (db: Firestore, work: (tx: Transaction) => Promise<unknown>) => sdk.runTransaction(db, async tx => {
    probe.attempts++
    return work(new Proxy(tx, { get(target, key) {
      if (key === 'get') return async (ref: ReturnType<typeof doc>) => {
        const snap = await target.get(ref)
        if (ref.path === 'trips/T1' && probe.afterTripRead) {
          const hook = probe.afterTripRead
          probe.afterTripRead = null
          await hook()
        }
        return snap
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } }))
  }) }
})
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8183') throw new Error('Use only the isolated note emulator on 127.0.0.1:8183')
  setLogLevel('silent')
  env = await initializeTestEnvironment({ projectId: 'demo-merge-notes', firestore: { host: '127.0.0.1', port: 8183, rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => {
  probe.afterTripRead = null
  probe.attempts = 0
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'staff'), { role: 'dispatcher', active: true }))
})
afterAll(async () => { await env?.cleanup() })

const original = (): Pick<Trip, 'tripDate' | 'driverId' | 'vehicleId' | 'status' | 'sourceVRIds' | 'stops'> & Required<LegacyStopNotes> => ({ tripDate: '2026-10-07', driverId: 'D1', vehicleId: 'V1', status: 'Planned', sourceVRIds: ['VR-0710-0001'], stops: [
  { siteId: 'A', siteName: 'A', order: 1, cargoDetails: 'ของ A', dispatcherNote: 'เก่า A', dispatcherName: 'เก่า' },
  { siteId: 'B', siteName: 'B', order: 2, cargoDetails: 'ของ B', dispatcherNote: 'เดิม B', dispatcherName: 'เดิม', outcome: 'reassigned', reassignedToTripId: 'T2' },
  { siteId: 'C', siteName: 'C', order: 3, cargoDetails: 'ของ C', dispatcherNote: 'เดิม C', dispatcherName: 'เดิม' },
], stopNotes: { stop_0: 'คำสั่ง A', stop_1: 'คำสั่ง B', stop_2: 'คำสั่ง C', stop_9: 'ห้ามใส่จุดใหม่' }, stopNoteAuthors: { stop_0: 'ก', stop_1: 'ข', stop_2: 'ค', stop_9: 'หลง' } })
async function setup(data = original()) {
  const db = env.authenticatedContext('staff').firestore() as unknown as Firestore
  await createTripWithQueueGuard(db, 'T1', data)
  probe.attempts = 0
  return db
}
const stored = async (db: Firestore) => (await getDoc(doc(db, 'trips', 'T1'))).data()!
const options = (indexes: (number | null)[]) => ({ expectedStops: original().stops, sourceIndexes: indexes })
const removeA = () => ({ stops: original().stops.slice(1) })

it('ลบ A แล้วคำสั่ง B/C ยังอยู่บนงานเดิมทั้งต้นทางและแถวรับโยก', async () => {
  const db = await setup()
  await updateTripWithQueueGuard(db, 'T1', removeA(), undefined, options([1, 2]))
  const data = await stored(db)
  expect(data.stops.map((s: any) => [s.siteName, s.dispatcherNote, s.dispatcherName])).toEqual([['B', 'คำสั่ง B', 'ข'], ['C', 'คำสั่ง C', 'ค']])
  expect(data.stopNotes).toEqual({})
  expect(data.stopNoteAuthors).toEqual({})
  expect(incomingStopsForTrip([{ ...data, id: 'T1' }] as any, 'T2')[0]).toMatchObject({ dispatcherNote: 'คำสั่ง B', dispatcherName: 'ข' })
  expect(data.sourceVRIds).toEqual(original().sourceVRIds)
})

it('ลบกลางแล้วเรียงใหม่และแก้รายละเอียดใน history ยังผูกหมายเหตุด้วย index ต้นฉบับ', async () => {
  const db = await setup()
  const input = { stops: [original().stops[2], original().stops[0]].map((s, order) => ({ ...s, order, cargoDetails: 'แก้รายละเอียด' })) }
  const before = structuredClone(input)
  const saved = await updateTripWithQueueGuard(db, 'T1', input, undefined, options([2, 0]))
  expect((await stored(db)).stops.map((s: any) => [s.siteName, s.dispatcherNote, s.order, s.cargoDetails])).toEqual([['C', 'คำสั่ง C', 0, 'แก้รายละเอียด'], ['A', 'คำสั่ง A', 1, 'แก้รายละเอียด']])
  expect(saved).toMatchObject({ stops: (await stored(db)).stops, stopNotes: {}, stopNoteAuthors: {} })
  expect(input).toEqual(before)
})

it('จุดใหม่ไม่รับ legacy ของจุดที่ลบหรือคีย์เกินช่วง แม้ชื่อและ order ซ้ำ', async () => {
  const db = await setup()
  const added = { ...original().stops[0], dispatcherNote: 'คำสั่งใหม่', dispatcherName: 'ใหม่' }
  await updateTripWithQueueGuard(db, 'T1', { stops: [added, original().stops[1]] }, undefined, options([null, 1]))
  expect((await stored(db)).stops).toMatchObject([{ dispatcherNote: 'คำสั่งใหม่', dispatcherName: 'ใหม่' }, { dispatcherNote: 'คำสั่ง B', dispatcherName: 'ข' }])
})

it('ชื่อไซต์ซ้ำและเลข order ซ้ำไม่ทำให้เดาผิดจุด', async () => {
  const data = original()
  data.stops = data.stops.map(s => ({ ...s, siteName: 'ที่เดียวกัน', order: 1 }))
  const db = await setup(data)
  await updateTripWithQueueGuard(db, 'T1', { stops: [data.stops[2], data.stops[1]] }, undefined, { expectedStops: data.stops, sourceIndexes: [2, 1] })
  expect((await stored(db)).stops.map((s: any) => s.dispatcherNote)).toEqual(['คำสั่ง C', 'คำสั่ง B'])
})

it('หมายเหตุเปลี่ยนระหว่าง transaction ทำให้ retry และใช้ข้อความ/ชื่อสด', async () => {
  const db = await setup()
  probe.afterTripRead = () => env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { 'stopNotes.stop_1': 'แก้ขณะลบ', 'stopNoteAuthors.stop_1': 'คนล่าสุด' }))
  await updateTripWithQueueGuard(db, 'T1', removeA(), undefined, options([1, 2]))
  expect(probe.attempts).toBeGreaterThanOrEqual(2)
  expect((await stored(db)).stops[0]).toMatchObject({ dispatcherNote: 'แก้ขณะลบ', dispatcherName: 'คนล่าสุด' })
})

it('ล้างหมายเหตุก่อนกดลบแล้วไม่ฟื้นจาก array เก่า', async () => {
  const db = await setup()
  const live = original().stops.map((s, i) => i === 1 ? { ...s, dispatcherNote: '', dispatcherName: '' } : s)
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops: live, 'stopNotes.stop_1': '', 'stopNoteAuthors.stop_1': '' }))
  await updateTripWithQueueGuard(db, 'T1', removeA(), undefined, options([1, 2]))
  expect((await stored(db)).stops[0].dispatcherNote || '').toBe('')
  expect((await stored(db)).stops[0].dispatcherName || '').toBe('')
})

it('ไม่มี legacy ใช้ค่าบน stop และ fallback ข้อความ/ชื่อแยกกันเหมือนหน้าจริง', async () => {
  const data = original()
  data.stopNotes = { stop_0: '', stop_1: '', stop_2: 'เฉพาะข้อความ', stop_9: '' }
  data.stopNoteAuthors = { stop_0: '', stop_1: 'เฉพาะชื่อ', stop_2: '', stop_9: '' }
  const db = await setup(data)
  await updateTripWithQueueGuard(db, 'T1', removeA(), undefined, { expectedStops: data.stops, sourceIndexes: [1, 2] })
  expect((await stored(db)).stops).toMatchObject([{ dispatcherNote: 'เดิม B', dispatcherName: 'เฉพาะชื่อ' }, { dispatcherNote: 'เฉพาะข้อความ', dispatcherName: 'เดิม' }])
})

it.each([
  { indexes: [1] }, { indexes: [1, 1] }, { indexes: [-1, 2] }, { indexes: [1, 3] }, { indexes: [1, 1.5] },
])('binding ผิด $indexes ปฏิเสธทั้งก้อนโดยไม่แตะ stops หรือ guards', async ({ indexes }) => {
  const db = await setup()
  const guard = doc(db, 'queueResourceDays', 'driver__D1__2026-10-07')
  const prior = (await getDoc(guard)).data()
  await expect(updateTripWithQueueGuard(db, 'T1', removeA(), undefined, options(indexes))).rejects.toThrow()
  expect(await stored(db)).toMatchObject(original())
  expect((await getDoc(guard)).data()).toEqual(prior)
})

it.each(['insert', 'cargo', 'outcome'])('snapshot เดิมเปลี่ยนด้าน $0 แล้วปฏิเสธไม่เขียนทับ', async change => {
  const db = await setup()
  const stops = original().stops
  if (change === 'insert') stops.unshift({ ...stops[0], siteName: 'แทรกใหม่' })
  if (change === 'cargo') stops[0].cargoDetails = 'แก้โดยอีกเครื่อง'
  if (change === 'outcome') stops[0].outcome = 'delivered'
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops }))
  await expect(updateTripWithQueueGuard(db, 'T1', removeA(), undefined, options([1, 2]))).rejects.toThrow()
  expect((await stored(db)).stops).toEqual(stops)
})

it('viewer ถูกปฏิเสธและ legacy map ไม่ถูกล้างบางส่วน', async () => {
  await setup()
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'viewer'), { role: 'viewer', active: true }))
  const db = env.authenticatedContext('viewer').firestore() as unknown as Firestore
  await expect(updateTripWithQueueGuard(db, 'T1', removeA(), undefined, options([1, 2]))).rejects.toThrow()
  expect(await stored(db)).toMatchObject(original())
})

it('ผู้เรียกที่ไม่มี bindings ไม่ล้าง legacy หรือเปลี่ยนพฤติกรรมเดิม', async () => {
  const db = await setup()
  await updateTripWithQueueGuard(db, 'T1', { totalDistanceKm: 25 })
  expect(await stored(db)).toMatchObject({ ...original(), totalDistanceKm: 25 })
})
