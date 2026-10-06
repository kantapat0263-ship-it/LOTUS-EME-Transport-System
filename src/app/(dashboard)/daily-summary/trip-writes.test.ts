import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function body(name: string) {
  let value: ts.Expression | undefined
  const find = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer; ts.forEachChild(node, find) }
  find(source)
  if (!value) throw new Error(`Actual ${name} missing`)
  return ts.transpileModule(`const work = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}
const trip = () => ({ id: 'T1', stops: [{ siteName: 'A', order: 1, outcome: 'driver-refused', outcomeReason: 'เดิม' }] })
function reasonUI(saved: boolean) {
  const apply = vi.fn().mockResolvedValue(saved)
  const setTrips = vi.fn()
  let drafts: any = {}
  const make = () => new Function('refusalDrafts', 'setRefusalDrafts', 'buildStops', 'applyStops', 'setTrips', `${body('setRefuseReason')}return work`)(
    drafts, (update: any) => { drafts = typeof update === 'function' ? update(drafts) : update }, (original: any, index: number, fn: any) => original.stops.map((s: any, i: number) => i === index ? fn(s) : s), apply, setTrips,
  )
  return { make, apply, setTrips, drafts: () => drafts }
}
it('พิมพ์เหตุผลเก็บ draft โดยไม่เปลี่ยน trips หรือเรียกฐานข้อมูล', async () => {
  const ui = reasonUI(true)
  await ui.make()(trip(), 0, 'กำลังพิมพ์', false)
  expect(ui.apply).not.toHaveBeenCalled()
  expect(ui.setTrips).not.toHaveBeenCalled()
  expect(ui.drafts()['T1:0'].text).toBe('กำลังพิมพ์')
  expect(ui.drafts()['T1:0'].trip.stops[0].outcomeReason).toBe('เดิม')
})
it('blur ใช้ snapshot ก่อนพิมพ์และล้าง draft เฉพาะหลัง commit ผ่าน', async () => {
  const ui = reasonUI(true)
  await ui.make()(trip(), 0, 'ใหม่', false)
  await ui.make()({ ...trip(), stops: [{ ...trip().stops[0], outcomeReason: 'ห้ามใช้ฐานนี้' }] }, 0, 'ใหม่', true)
  expect(ui.apply.mock.calls[0][0].stops[0].outcomeReason).toBe('เดิม')
  expect(ui.apply.mock.calls[0][1][0].outcomeReason).toBe('ใหม่')
  expect(ui.drafts()['T1:0']).toBeUndefined()
})
it('conflict เก็บข้อความ draft ไว้โดยไม่แสดงผลสำเร็จ', async () => {
  const ui = reasonUI(false)
  await ui.make()(trip(), 0, 'เก็บไว้', false)
  await ui.make()(trip(), 0, 'เก็บไว้', true)
  expect(ui.drafts()['T1:0'].text).toBe('เก็บไว้')
})
it('ข้อความที่พิมพ์เพิ่มระหว่างรอ commit ไม่ถูกล้าง และใช้ baseline ที่เพิ่งบันทึก', async () => {
  const ui = reasonUI(true)
  let finish!: (saved: boolean) => void
  ui.apply.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await ui.make()(trip(), 0, 'รอบแรก', false)
  const saving = ui.make()(trip(), 0, 'รอบแรก', true)
  await ui.make()(trip(), 0, 'พิมพ์เพิ่ม', false)
  finish(true)
  await saving
  expect(ui.drafts()['T1:0'].text).toBe('พิมพ์เพิ่ม')
  expect(ui.drafts()['T1:0'].trip.stops[0].outcomeReason).toBe('รอบแรก')
})
function secondaryUI(name: string, reverting = false) {
  const target = { ...trip(), driverId: 'D1', vehiclePlate: 'รถหนึ่ง', tripDate: '2026-10-07', ...(reverting ? { actualDriverId: 'D2' } : {}) }
  const other = { ...trip(), id: 'T2', driverId: 'D2', driverName: 'คนสอง', vehiclePlate: 'รถสอง', stops: [{ ...trip().stops[0], outcome: reverting ? 'reassigned' : 'delivered', reassignedToTripId: 'T1' }] }
  const toast = vi.fn(), persist = vi.fn().mockResolvedValue(true), apply = vi.fn().mockResolvedValue(false)
  const deps = { trips: [target, other], driversData: [{ id: 'D2', name: 'คนสอง' }], vehiclesData: [{ id: 'V3', licensePlate: 'รถสาม', type: 'truck' }], allowOrdinaryEdit: () => true, passLeaveGate: async () => true, persistTripPatch: persist, isManagedTrip: () => false, window: { confirm: () => true }, applyStops: apply, stripOutcome: (s: any) => s, recordedBy: 'ผู้จัด', toast, calculateFuelCost: () => 0 }
  const handler = new Function(...Object.keys(deps), `${body(name)}return work`)(...Object.values(deps))
  return { handler, toast, persist, apply }
}
it.each([false, true])('ขับแทนบันทึกแล้ว แต่โยก/คืนงานล้มเหลว ต้องแจ้งว่าบันทึกเพียงบางส่วน revert=$0', async reverting => {
  const ui = secondaryUI('setActualDriver', reverting)
  await ui.handler('T1', reverting ? '' : 'D2')
  expect(ui.persist).toHaveBeenCalledOnce()
  expect(ui.apply).toHaveBeenCalledOnce()
  expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'บันทึกคนขับแล้ว แต่งานที่เกี่ยวข้องยังไม่ครบ', variant: 'destructive' })
})
it('เปลี่ยนรถบันทึกแล้ว แต่ทะเบียนงานโยกล้มเหลว ต้องแจ้งผลบางส่วน', async () => {
  const ui = secondaryUI('changeVehicle')
  await ui.handler('T1', 'V3')
  expect(ui.persist).toHaveBeenCalledOnce()
  expect(ui.apply).toHaveBeenCalledOnce()
  expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'เปลี่ยนรถแล้ว แต่ทะเบียนในงานโยกยังไม่ครบ', variant: 'destructive' })
})
it('fetch จริงล้าง draft หลังข้อมูลล่าสุดโหลดสำเร็จ แต่ไม่ล้างจาก query ที่หมดอายุ', async () => {
  for (const latest of [true, false]) {
    const setDrafts = vi.fn(), setTrips = vi.fn()
    const deps = { selectedDate: '2026-10-07', beginFetchTripsRef: { current: () => () => latest }, setIsLoading: vi.fn(), db: {}, query: (...args: any[]) => args, collection: () => ({}), where: () => ({}), getDocs: async () => ({ docs: [{ id: 'T1', data: () => ({ tripDate: '2026-10-07', stops: [] }) }] }), setTrips, setRefusalDrafts: setDrafts, errorEmitter: { emit: vi.fn() }, FirestorePermissionError: Error, toast: vi.fn() }
    const handler = new Function(...Object.keys(deps), `${body('fetchTrips')}return work`)(...Object.values(deps))
    await handler()
    expect(setDrafts.mock.calls).toEqual(latest ? [[{}]] : [])
    expect(setTrips.mock.calls.length).toBe(latest ? 1 : 0)
  }
})
it.each([true, false])('applyStops จริงล้าง draft เฉพาะทริปที่เปลี่ยนหลังบันทึกผ่าน saved=$0', async saved => {
  let drafts: any = { 'T1:0': { text: 'ของ A' }, 'T2:0': { text: 'ของอีกทริป' } }
  const deps = { allowOrdinaryEdit: () => true, persistTripPatch: async () => saved, setTrips: vi.fn(), setRefusalDrafts: (update: any) => { drafts = update(drafts) } }
  const handler = new Function(...Object.keys(deps), `${body('applyStops')}return work`)(...Object.values(deps))
  await handler(trip(), [])
  expect(drafts['T1:0']).toEqual(saved ? undefined : { text: 'ของ A' })
  expect(drafts['T2:0']).toEqual({ text: 'ของอีกทริป' })
})
it.each([true, false])('สร้างคันรับโยกจริงส่ง atomics และเพิ่มบนจอเฉพาะหลังบันทึกผ่าน saved=$0', async saved => {
  const original = { ...trip(), tripDate: '2026-10-07', vehiclePlate: 'รถหนึ่ง' }
  const setTrips = vi.fn(), apply = vi.fn().mockResolvedValue(saved), standalone = vi.fn()
  const deps = { reassignNewDialog: { tripId: 'T1', stopIdx: 0, expectedStops: original.stops }, trips: [original], setReassignNewDialog: vi.fn(), setReassignNewForm: vi.fn(), allowOrdinaryEdit: () => true, driversData: [{ id: 'D2', name: 'คนสอง' }], vehiclesData: [{ id: 'V2', licensePlate: 'รถสอง' }], reassignNewForm: { driverId: 'D2', vehicleId: 'V2' }, toast: vi.fn(), passLeaveGate: async () => true, buildStops: (trip: any, index: number, fn: any) => trip.stops.map((stop: any, i: number) => i === index ? fn(stop) : stop), applyStops: apply, serverTimestamp: () => 'time', setTrips, createTripWithQueueGuard: standalone, db: {} }
  const handler = new Function(...Object.keys(deps), `${body('createReassignTarget')}return work`)(...Object.values(deps))
  await handler()
  expect(standalone).not.toHaveBeenCalled()
  expect(apply.mock.calls[0][3]).toMatchObject({ expectedStops: original.stops, sourceIndexes: [0], createTarget: { data: { vehicleId: 'V2', driverId: 'D2', stops: [] } } })
  expect(apply.mock.calls[0][1][0].reassignedToTripId).toBe(apply.mock.calls[0][3].createTarget.id)
  expect(setTrips.mock.calls.length).toBe(saved ? 1 : 0)
})
