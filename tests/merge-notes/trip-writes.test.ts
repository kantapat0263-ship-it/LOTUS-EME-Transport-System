import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, query, where, getDocs, runTransaction, doc, getDoc, setDoc, updateDoc, serverTimestamp, setLogLevel, type Firestore, type Transaction } from 'firebase/firestore'
import { createTripWithQueueGuard, updateTripWithQueueGuard, deleteTripWithQueueGuard, assertTripStopsUnchanged } from '@/lib/tripQueueGuard'
import { findFreeRequestId, requestIdPrefix, RequestIdExhaustedError } from '@/lib/requestId'
import type { Trip, TripStop } from '@/types/models'

let env: RulesTestEnvironment
const probe = vi.hoisted(() => ({ hook: null as ((path: string) => Promise<void>) | null, attempts: 0 }))
vi.mock('firebase/firestore', async importOriginal => {
  const sdk = await importOriginal<typeof import('firebase/firestore')>()
  return { ...sdk, runTransaction: (db: Firestore, work: (tx: Transaction) => Promise<unknown>) => sdk.runTransaction(db, async tx => {
    probe.attempts++
    return work(new Proxy(tx, { get(target, key) {
      if (key === 'get') return async (ref: ReturnType<typeof doc>) => {
        const snap = await target.get(ref)
        if (probe.hook) await probe.hook(ref.path)
        return snap
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } }))
  }) }
})
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8183') throw new Error('Use only isolated demo emulator on 127.0.0.1:8183')
  setLogLevel('silent')
  env = await initializeTestEnvironment({ projectId: 'demo-merge-notes', firestore: { host: '127.0.0.1', port: 8183, rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => {
  probe.hook = null
  probe.attempts = 0
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'staff'), { role: 'dispatcher', active: true }))
})
afterAll(async () => { await env?.cleanup() })
const original = (): Trip => ({ id: 'T1', tripId: 'T1', tripDate: '2026-10-07', driverId: 'D1', driverName: 'คนขับ', vehicleId: 'V1', vehiclePlate: 'รถหนึ่ง', departureSiteId: '', status: 'Planned', sourceVRIds: ['VR-0710-0001'], stops: [
  { siteId: 'A', siteName: 'A', order: 1, cargoDetails: 'A', dispatcherNote: 'เก่า A', dispatcherName: 'ก' },
  { siteId: 'B', siteName: 'B', order: 2, cargoDetails: 'B', dispatcherNote: 'เก่า B', dispatcherName: 'ข' },
] })
const stopEdit = (trip = original()) => ({ expectedStops: trip.stops, sourceIndexes: trip.stops.map((_, index) => index) })
async function setup(trip = original()) {
  const db = env.authenticatedContext('staff').firestore() as unknown as Firestore
  await createTripWithQueueGuard(db, trip.id, trip)
  return db
}
const stored = async (db: Firestore) => (await getDoc(doc(db, 'trips', 'T1'))).data()!
const source = ts.createSourceFile('page.tsx', readFileSync('src/app/(dashboard)/daily-summary/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function body(name: string) {
  let value: ts.Expression | undefined
  const find = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer; ts.forEachChild(node, find) }
  find(source)
  if (!value) throw new Error(`Missing actual handler ${name}`)
  return ts.transpileModule(`const ${name} = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}
function daily(db: Firestore, trip = original()) {
  const toast = vi.fn()
  let state = [trip]
  const buildStops = (trip: Trip, index: number, change: (stop: TripStop) => TripStop) => trip.stops.map((s, i) => i === index ? change({ ...s }) : s)
  const stripOutcome = (stop: TripStop) => { const { outcome: _o, outcomeReason: _r, postponedRequestId: _p, postponedToDate: _d, ...rest } = stop; return rest }
  const handler = new Function('db', 'trips', 'updateTripWithQueueGuard', 'serverTimestamp', 'setTrips', 'toast', 'allowOrdinaryEdit', 'buildStops', 'stripOutcome', 'getDoc', 'doc', 'updateDoc', 'recordedBy', 'user', 'formatThaiDate', 'openPostponeDialog', 'setRefusalDrafts', `${body('persistTripPatch')}${body('applyStops')}${body('chooseOutcome')}return chooseOutcome`)(
    db, [trip], updateTripWithQueueGuard, serverTimestamp, (fn: (prev: Trip[]) => Trip[]) => { state = fn(state) }, toast, () => true, buildStops, stripOutcome, getDoc, doc, updateDoc, 'คนจัดรถ', { email: 'test@example.invalid' }, (value: string) => value, vi.fn(), vi.fn(),
  ) as (trip: Trip, index: number, outcome: string) => Promise<void>
  return { handler, toast, state: () => state }
}

it('actual outcome handler เก็บหมายเหตุ/ชื่อที่อีกเครื่องเพิ่งแก้แทนที่จะทับด้วย local array', async () => {
  const db = await setup()
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops: original().stops.map((s, i) => i === 1 ? { ...s, dispatcherNote: 'ล่าสุด B', dispatcherName: 'คนล่าสุด' } : s) }))
  const ui = daily(db)
  await ui.handler(original(), 0, 'delivered')
  expect((await stored(db)).stops[1]).toMatchObject({ dispatcherNote: 'ล่าสุด B', dispatcherName: 'คนล่าสุด' })
  expect((await stored(db)).stops[0].outcome).toBeUndefined()
  expect(ui.state()[0].stops[1].dispatcherNote).toBe('ล่าสุด B')
})
it('actual outcome handler หยุดเมื่ออีกเครื่องปิดผลงานแล้ว ไม่ทับทั้งจุดอื่นและ local state', async () => {
  const db = await setup()
  const live = original().stops.map((s, i) => i === 1 ? { ...s, outcome: 'driver-refused' as const, outcomeReason: 'ล่าสุด' } : s)
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops: live }))
  const ui = daily(db)
  await ui.handler(original(), 0, 'delivered')
  expect((await stored(db)).stops).toEqual(live)
  expect(ui.state()[0]).toEqual(original())
  expect(ui.toast.mock.calls.at(-1)?.[0].variant).toBe('destructive')
})
it('whole-array caller ที่ไม่ส่ง snapshot ถูกปฏิเสธก่อนเขียน', async () => {
  const db = await setup()
  await expect(updateTripWithQueueGuard(db, 'T1', { stops: original().stops.slice(1) })).rejects.toThrow()
  expect((await stored(db)).stops).toEqual(original().stops)
})
it('supersede ใบเลื่อนและเปลี่ยน outcome อยู่ใน commit เดียว', async () => {
  const trip = original()
  trip.stops[0] = { ...trip.stops[0], outcome: 'postponed', postponedRequestId: 'R1', postponedToDate: '2026-10-08' }
  const db = await setup(trip)
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { requestId: 'VR-0810-0001', requestDate: '2026-10-08', status: 'rescheduled', destinations: [] }))
  const live = trip.stops.map((s, i) => i === 1 ? { ...s, outcome: 'delivered' as const } : s)
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops: live }))
  await daily(db, trip).handler(trip, 0, 'delivered')
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.status).toBe('rescheduled')
  expect((await stored(db)).stops).toEqual(live)
})
it('source conflict ไม่สร้างทริปใหม่ไว้รับโยกบางส่วน', async () => {
  const trip = original()
  const db = await setup(trip)
  const changed = trip.stops.map((s, i) => i === 1 ? { ...s, outcome: 'delivered' as const } : s)
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops: changed }))
  const target = { ...original(), id: 'T2', tripId: 'T2', vehicleId: 'V2', vehiclePlate: 'รถสอง', stops: [] }
  await expect(updateTripWithQueueGuard(db, 'T1', { stops: trip.stops.map((s, i) => i === 0 ? { ...s, reassignedToTripId: 'T2' } : s) }, undefined, { ...stopEdit(trip), createTarget: { id: 'T2', data: target } })).rejects.toThrow()
  expect((await getDoc(doc(db, 'trips', 'T2'))).exists()).toBe(false)
  expect((await stored(db)).stops).toEqual(changed)
})
it('new target และ source reassignment บันทึกพร้อมกันเมื่อ snapshot ยังตรง', async () => {
  const db = await setup()
  const target = { ...original(), id: 'T2', tripId: 'T2', vehicleId: 'V2', vehiclePlate: 'รถสอง', stops: [] }
  await updateTripWithQueueGuard(db, 'T1', { stops: original().stops.map((s, i) => i === 0 ? { ...s, reassignedToTripId: 'T2' } : s) }, undefined, { ...stopEdit(), createTarget: { id: 'T2', data: target } })
  expect((await getDoc(doc(db, 'trips', 'T2'))).exists()).toBe(true)
  expect((await stored(db)).stops[0].reassignedToTripId).toBe('T2')
})
it('ลบจุดสุดท้ายต้องไม่ลบงานใหม่ที่อีกเครื่องเพิ่งเพิ่ม', async () => {
  const trip = original()
  trip.stops = trip.stops.slice(0, 1)
  const db = await setup(trip)
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops: original().stops }))
  await expect(deleteTripWithQueueGuard(db, 'T1', trip.stops)).rejects.toThrow()
  expect((await stored(db)).stops).toEqual(original().stops)
})

it.each(['notes', 'outcome'])('actual outcome handler transaction retry เมื่ออีกเครื่องเปลี่ยน $0 ระหว่างรอ', async change => {
  const db = await setup()
  probe.attempts = 0
  const live = original().stops.map((s, i) => i === 1 ? change === 'notes' ? { ...s, dispatcherNote: 'ใหม่ระหว่างรอ', dispatcherName: 'คนล่าสุด' } : { ...s, outcome: 'driver-refused' as const, outcomeReason: 'เพิ่งเปลี่ยน' } : s)
  probe.hook = async path => {
    if (path !== 'trips/T1') return
    probe.hook = null
    await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), path), { stops: live }))
  }
  const ui = daily(db)
  await ui.handler(original(), 0, 'delivered')
  expect(probe.attempts).toBeGreaterThanOrEqual(2)
  expect((await stored(db)).stops).toEqual(live)
  if (change === 'outcome') expect(ui.toast.mock.calls.at(-1)?.[0].description).toContain('โหลดข้อมูลใหม่')
  else expect(ui.state()[0].stops).toEqual(live)
})
function postponed() {
  const trip = original()
  trip.stops[0] = { ...trip.stops[0], outcome: 'postponed', postponedRequestId: 'R1', postponedToDate: '2026-10-08' }
  return trip
}
async function oldRequest(status = 'rescheduled') {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'vehicleRequests', 'R1'), { requestId: 'VR-0810-0001', requestDate: '2026-10-08', status, destinations: [] }))
}
it('เปลี่ยนผลจากเลื่อน สำเร็จแล้วใบเก่า superseded พร้อมงานต้นทาง', async () => {
  const trip = postponed(), db = await setup(trip)
  await oldRequest()
  await daily(db, trip).handler(trip, 0, 'driver-refused')
  expect((await stored(db)).stops[0]).toMatchObject({ outcome: 'driver-refused' })
  expect((await stored(db)).stops[0].postponedRequestId).toBeUndefined()
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.status).toBe('superseded')
})
it.each(['approved', 'partial'])('ใบเลื่อน $0 ห้ามเปลี่ยนผลและไม่แก้เอกสารใด', async status => {
  const trip = postponed(), db = await setup(trip)
  await oldRequest(status)
  await daily(db, trip).handler(trip, 0, 'delivered')
  expect((await stored(db)).stops).toEqual(trip.stops)
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.status).toBe(status)
})
const target = () => ({ ...original(), id: 'T2', tripId: 'T2', vehicleId: 'V2', vehiclePlate: 'รถสอง', driverId: 'D2', stops: [] })
const targetPatch = () => ({ stops: original().stops.map((s, i) => i === 0 ? { ...s, reassignedToTripId: 'T2' } : s) })
it.each(['collision', 'booking', 'viewer'])('สร้างทริปรับโยกติด $0 ต้องไม่เปลี่ยนต้นทางหรือสร้างค้าง', async failure => {
  const staff = await setup()
  if (failure === 'collision') await createTripWithQueueGuard(staff, 'T2', target())
  if (failure === 'booking') await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'queueResourceDays', 'vehicle__V2__2026-10-07'), { version: 1, bookingId: 'B1' }))
  if (failure === 'viewer') await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'viewer'), { role: 'viewer', active: true }))
  const db = failure === 'viewer' ? env.authenticatedContext('viewer').firestore() as unknown as Firestore : staff
  const priorGuard = (await getDoc(doc(staff, 'queueResourceDays', 'vehicle__V1__2026-10-07'))).data()
  await expect(updateTripWithQueueGuard(db, 'T1', targetPatch(), undefined, { ...stopEdit(), createTarget: { id: 'T2', data: target() } })).rejects.toThrow()
  expect((await stored(staff)).stops).toEqual(original().stops)
  expect((await getDoc(doc(staff, 'trips', 'T2'))).exists()).toBe(failure === 'collision')
  expect((await getDoc(doc(staff, 'queueResourceDays', 'vehicle__V1__2026-10-07'))).data()).toEqual(priorGuard)
})
function postponeUI(db: Firestore, trip: Trip, initialStops = trip.stops) {
  const toast = vi.fn(), dialog = vi.fn()
  let state = [trip]
  const deps = { db, trips: [trip], postponeDialog: { tripId: 'T1', stopIdx: 0, expectedStops: initialStops }, postponeDateStr: '2099-01-08', allowOrdinaryEdit: () => true, format: () => '2026-10-07', setPostponeDialog: dialog, setIsPostponing: vi.fn(), isPostponedReqGrouped: async (id: string) => ['approved', 'partial'].includes((await getDoc(doc(db, 'vehicleRequests', id))).data()?.status), getDocs, query, collection, where, runTransaction, doc, isManagedTrip: (value: any) => !!value.queueLink, assertTripStopsUnchanged, findFreeRequestId, requestIdPrefix, serverTimestamp, user: { uid: 'staff', email: 'staff@example.invalid' }, recordedBy: 'ผู้จัด', cleanStops: (stops: TripStop[]) => stops, stripOutcome: (stop: TripStop) => { const { outcome, postponedRequestId, postponedToDate, ...rest } = stop; return rest }, setTrips: (fn: (prev: Trip[]) => Trip[]) => { state = fn(state) }, setRefusalDrafts: vi.fn(), formatThaiDate: (date: string) => date, toast, console: { error: vi.fn() }, RequestIdExhaustedError }
  const handler = new Function(...Object.keys(deps), `${body('handlePostpone')}return handlePostpone`)(...Object.values(deps))
  return { handler, toast, dialog, state: () => state }
}
it('actual เลื่อนงาน dialog เก่าห้ามสร้างใบใหม่ และบอกให้โหลดข้อมูลใหม่', async () => {
  const trip = original(), db = await setup(trip)
  const live = trip.stops.map((s, i) => i === 1 ? { ...s, cargoDetails: 'เปลี่ยนแล้ว' } : s)
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops: live }))
  const ui = postponeUI(db, trip)
  await ui.handler()
  expect((await getDocs(collection(db, 'vehicleRequests'))).size).toBe(0)
  expect((await stored(db)).stops).toEqual(live)
  expect(ui.toast.mock.calls.at(-1)?.[0].description).toContain('โหลดข้อมูลใหม่')
  expect(ui.dialog).not.toHaveBeenCalled()
})
it('actual เลื่อนซ้ำ เมื่อใบเก่าถูกจัดระหว่าง transaction ต้อง retry และหยุดทุกการเขียน', async () => {
  const trip = postponed(), db = await setup(trip)
  await oldRequest()
  probe.attempts = 0
  probe.hook = async path => {
    if (path !== 'vehicleRequests/R1') return
    probe.hook = null
    await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), path), { status: 'approved' }))
  }
  const ui = postponeUI(db, trip)
  await ui.handler()
  expect(probe.attempts).toBeGreaterThanOrEqual(2)
  expect((await getDocs(collection(db, 'vehicleRequests'))).size).toBe(1)
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()?.status).toBe('approved')
  expect((await stored(db)).stops).toEqual(trip.stops)
  expect(ui.toast.mock.calls.at(-1)?.[0].description).toContain('ถูกจัดรถแล้ว')
})
it('actual เลื่อนซ้ำสำเร็จ ใบใหม่/ปลดใบเก่า/ต้นทางบันทึกพร้อมกันและรักษาหมายเหตุสด', async () => {
  const trip = postponed(), db = await setup(trip)
  await oldRequest()
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'trips', 'T1'), { stops: trip.stops.map((s, i) => i === 0 ? { ...s, dispatcherNote: 'สด A', dispatcherName: 'คนล่าสุด' } : s) }))
  const ui = postponeUI(db, trip)
  await ui.handler()
  const saved = await stored(db), newId = saved.stops[0].postponedRequestId
  expect(saved.stops[0]).toMatchObject({ postponedToDate: '2099-01-08', dispatcherNote: 'สด A', dispatcherName: 'คนล่าสุด' })
  expect((await getDoc(doc(db, 'vehicleRequests', newId))).data()).toMatchObject({ requestDate: '2099-01-08', status: 'rescheduled' })
  expect((await getDoc(doc(db, 'vehicleRequests', 'R1'))).data()).toMatchObject({ status: 'superseded', supersededBy: newId })
  expect(ui.state()[0].stops).toEqual(saved.stops)
})
