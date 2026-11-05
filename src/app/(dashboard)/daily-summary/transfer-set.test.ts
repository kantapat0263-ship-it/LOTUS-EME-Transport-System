import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { incomingStopsForTrip } from '@/lib/calculations'
import { isManagedTrip } from '@/lib/continuousQueue'
import { tripDriverLabel } from '@/lib/reassign'
import { activeTransferSet, TRANSFER_EDIT_AT_SOURCE, TRANSFER_SET_CONFLICT, transferSetOutside, transferStopName } from '@/lib/transfer'
import { assertTripStopsUnchanged } from '@/lib/tripQueueGuard'

// งานรับของไปส่งต่อ "ทำทั้งชุด" (โยก/คนขับปฏิเสธ/ยกเลิก) — คอมไพล์ handler/ปุ่ม/หน้าต่างตัวจริงจากหน้าใบสรุป ไม่ต้องบูต Firebase
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const jsx = { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
function body(name: string) {
  let value: ts.Expression | undefined
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!value) throw new Error(`Actual ${name} missing`)
  return ts.transpileModule(`const ${name} = ${value.getText(source)};`, { compilerOptions: jsx }).outputText
}
/** arrow function ใน JSX ที่มีข้อความนี้ (ต้องเจอตัวเดียวพอดี) */
function arrowWith(marker: string) {
  const found: ts.ArrowFunction[] = []
  const find = (node: ts.Node) => {
    if (ts.isArrowFunction(node) && node.getText(source).includes(marker)) found.push(node)
    ts.forEachChild(node, find)
  }
  find(source)
  const inner = found.filter(f => !found.some(o => o !== f && f.getText(source).includes(o.getText(source))))
  if (inner.length !== 1) throw new Error(`Actual arrow with ${marker}: found ${inner.length}`)
  return ts.transpileModule(`const work = ${inner[0].getText(source)};`, { compilerOptions: jsx }).outputText
}

type Raw = Record<string, any>
const P = { siteId: 'S-A', siteName: 'วังโค', order: 1, cargoDetails: 'ปูน', transferRole: 'pickup', transferId: 'tf1', transferDropName: 'ดอนเมือง', dispatcherNote: 'โน้ตเดิม' }
const X = { siteId: 'S-X', siteName: 'ไปรษณีย์', order: 2, cargoDetails: 'เอกสาร' }
const D = { siteId: 'S-D', siteName: 'ดอนเมือง', order: 3, cargoDetails: 'ส่งของที่รับจาก วังโค: ปูน', transferRole: 'drop', transferId: 'tf1' }
const target = { id: 'T2', tripDate: '2026-11-05', driverId: 'D2', driverName: 'คนประจำ', actualDriverId: 'D3', actualDriverName: 'คนขับแทน', vehiclePlate: 'รถสอง', status: 'Planned', stops: [] as Raw[] }

const shared = (trip: Raw, live: Raw[] | null, toast: ReturnType<typeof vi.fn>, setTrips: ReturnType<typeof vi.fn>) => ({
  // readLiveTrip ตัวจริง: ทริปบนฐาน = live (ค่าเริ่มต้นตรงกับตอนเปิดหน้าต่าง)
  getDoc: async () => ({ exists: () => true, data: () => structuredClone({ ...trip, stops: live ?? trip.stops }) }),
  doc: () => 'trip-ref', db: {}, isManagedTrip, assertTripStopsUnchanged, TRANSFER_SET_CONFLICT, toast, setTrips, recordedBy: 'น้าสาว', transferStopName, tripDriverLabel,
})
const realHelpers = `${body('stripOutcome')}${body('readLiveTrip')}${body('transferSetStops')}${body('transferSetFresh')}`

function arrange(action: 'reassigned' | 'driver-refused' | 'cancel', opts: { stops?: Raw[]; form?: { targetTripId: string; reason: string }; live?: Raw[]; screen?: Raw[]; leave?: boolean; save?: boolean; incoming?: boolean; allowTarget?: boolean } = {}) {
  const stops = opts.stops ?? [P, X, D]
  // screen = ทริปบนจอตอนกดบันทึก (อาจไม่ตรงกับตอนเปิดหน้าต่าง) · ฐาน = live (ค่าเริ่มต้น = ตอนเปิดหน้าต่าง)
  const trip = { id: 'T1', tripDate: '2026-11-05', driverName: 'สมชาย', vehiclePlate: 'กข 1', status: 'Planned', stops: structuredClone(opts.screen ?? stops) }
  const feeder = { id: 'T3', tripDate: '2026-11-05', driverName: 'คนอื่น', vehiclePlate: 'รถสาม', stops: [{ siteName: 'งานโยกมา', reassignedToTripId: 'T1', outcome: 'reassigned' }] }
  const trips = [trip, target, ...(opts.incoming ? [feeder] : [])]
  const idxs = activeTransferSet(stops as never[], 0)
  const dialog = { tripId: 'T1', stopIdx: 0, idxs, action, expectedStops: structuredClone(stops) }
  const toast = vi.fn(), setTrips = vi.fn(), setDialog = vi.fn(), setNewDialog = vi.fn(), setNewForm = vi.fn(), stats = vi.fn()
  const applyStops = vi.fn(async (..._args: unknown[]) => opts.save !== false)
  const applyStopsWithDistance = vi.fn(async (..._args: unknown[]) => opts.save !== false)
  const remove = vi.fn(async (..._args: unknown[]) => undefined)
  const passLeaveGate = vi.fn(async (..._args: unknown[]) => opts.leave !== false)
  const allowOrdinaryEdit = vi.fn((t: Raw | undefined) => !(t?.id === 'T2' && opts.allowTarget === false))
  const deps = {
    ...shared(trip, opts.live ?? stops, toast, setTrips),
    transferSetDialog: dialog, trips, setTransferSetDialog: setDialog, allowOrdinaryEdit, incomingStopsForTrip, deleteTripWithQueueGuard: remove,
    setRefusalDrafts: vi.fn(), setStatsRefreshKey: stats, applyStopsWithDistance, applyStops, transferSetForm: opts.form ?? { targetTripId: '', reason: '' },
    setReassignNewForm: setNewForm, setReassignNewDialog: setNewDialog, passLeaveGate,
  }
  const handler = new Function(...Object.keys(deps), `${realHelpers}${body('applyTransferSet')}return applyTransferSet`)(...Object.values(deps)) as () => Promise<void>
  return { handler, trip, dialog, toast, setTrips, setDialog, setNewDialog, applyStops, applyStopsWithDistance, remove, passLeaveGate, stats, allowOrdinaryEdit }
}
const strip = ({ outcome: _o, outcomeReason: _r, reassignedToTripId: _t, reassignedToVehiclePlate: _p, reassignedToDriverName: _n, outcomeRecordedBy: _b, outcomeAt: _a, postponedToDate: _d, postponedRequestId: _q, ...rest }: Raw) => rest

describe('applyTransferSet: โยก/คนขับปฏิเสธทั้งชุด', () => {
  it('โยกไปคันที่มีอยู่: ด่านวันลาได้คนขับจริงของคันนั้น · เขียนครั้งเดียว ทุกจุดในชุดได้ผล+คันที่รับ · จุดอื่นไม่เปลี่ยน · binding ตอนเปิดหน้าต่าง', async () => {
    const ui = arrange('reassigned', { form: { targetTripId: 'T2', reason: 'ไม่ควรติดไป' }, screen: [P, { ...X, cargoDetails: 'ข้อมูลบนจอที่ไม่ใช่ตอนเปิดหน้าต่าง' }, D] })
    await ui.handler()
    expect(ui.passLeaveGate).toHaveBeenCalledOnce()
    expect(ui.passLeaveGate.mock.calls[0][1]).toEqual([{ driverId: 'D3', date: '2026-11-05' }])
    expect(ui.allowOrdinaryEdit).toHaveBeenCalledWith(target)
    expect(ui.applyStops).toHaveBeenCalledOnce()
    const [, next, persist, edit] = ui.applyStops.mock.calls[0] as [Raw, Raw[], boolean, Raw]
    expect(persist).toBe(true)
    expect(edit).toEqual({ expectedStops: ui.dialog.expectedStops, sourceIndexes: [0, 1, 2] })
    for (const i of [0, 2]) {
      expect(next[i]).toEqual({ ...[P, X, D][i], outcome: 'reassigned', outcomeRecordedBy: 'น้าสาว', outcomeAt: next[i].outcomeAt, reassignedToTripId: 'T2', reassignedToVehiclePlate: 'รถสอง', reassignedToDriverName: 'คนขับแทน' })
    }
    expect(next[1]).toEqual(X)
    expect(ui.setDialog).toHaveBeenCalledWith(null)
    expect(ui.toast.mock.calls.at(-1)?.[0].title).toBe('โยกงานทั้งชุดแล้ว ✅')
    expect(ui.toast.mock.calls.at(-1)?.[0].description).toContain('วังโค (จุดรับ), ดอนเมือง (จุดส่ง)')
  })
  it('ด่านวันลาตอบไม่ → ไม่อ่าน/ไม่เขียน หน้าต่างค้างไว้', async () => {
    const ui = arrange('reassigned', { form: { targetTripId: 'T2', reason: '' }, leave: false })
    await ui.handler()
    expect(ui.applyStops).not.toHaveBeenCalled()
    expect(ui.setDialog).not.toHaveBeenCalled()
  })
  it('คันที่รับเป็นคิวต่อเนื่อง (allowOrdinaryEdit ไม่ให้) → ไม่ถามวันลา ไม่เขียน', async () => {
    const ui = arrange('driver-refused', { form: { targetTripId: 'T2', reason: '' }, allowTarget: false })
    await ui.handler()
    expect(ui.passLeaveGate).not.toHaveBeenCalled()
    expect(ui.applyStops).not.toHaveBeenCalled()
  })
  it('โยกแต่ยังไม่เลือกคัน → บอกให้เลือก ไม่เขียน', async () => {
    const ui = arrange('reassigned')
    await ui.handler()
    expect(ui.applyStops).not.toHaveBeenCalled()
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'เลือกคันที่รับงานก่อน', variant: 'destructive' })
  })
  it('ปฏิเสธแบบไม่มีคันรับ: ไม่ถามวันลา · ไม่มีฟิลด์ reassignedTo* · เหตุผลเดียวกันทุกจุด (ตัดช่องว่าง)', async () => {
    const ui = arrange('driver-refused', { form: { targetTripId: '', reason: '  บอกไกล  ' } })
    await ui.handler()
    expect(ui.passLeaveGate).not.toHaveBeenCalled()
    const next = ui.applyStops.mock.calls[0][1] as Raw[]
    for (const i of [0, 2]) {
      expect(next[i]).toMatchObject({ outcome: 'driver-refused', outcomeReason: 'บอกไกล', outcomeRecordedBy: 'น้าสาว' })
      expect(Object.keys(next[i]).filter(k => k.startsWith('reassignedTo'))).toEqual([])
    }
    expect(next[1]).toEqual(X)
  })
  it('ปฏิเสธ + มีคันรับไปทำแทน → ผ่านด่านวันลาด้วยคนขับจริงของคันนั้น · ด่านตอบไม่ = ไม่เขียน', async () => {
    const ui = arrange('driver-refused', { form: { targetTripId: 'T2', reason: '' } })
    await ui.handler()
    expect(ui.passLeaveGate.mock.calls[0][1]).toEqual([{ driverId: 'D3', date: '2026-11-05' }])
    expect((ui.applyStops.mock.calls[0][1] as Raw[])[0]).toMatchObject({ outcome: 'driver-refused', reassignedToTripId: 'T2' })
    expect((ui.applyStops.mock.calls[0][1] as Raw[])[0]).not.toHaveProperty('outcomeReason')
    const blocked = arrange('driver-refused', { form: { targetTripId: 'T2', reason: '' }, leave: false })
    await blocked.handler()
    expect(blocked.applyStops).not.toHaveBeenCalled()
  })
  it('คน/รถใหม่ → ส่งต่อให้หน้าต่างโยกงานให้คนใหม่ตัวเดิม (พร้อมชุด/ผล/เหตุผล) ยังไม่เขียนอะไร', async () => {
    const ui = arrange('driver-refused', { form: { targetTripId: '__new__', reason: 'ไกล' } })
    await ui.handler()
    expect(ui.setNewDialog).toHaveBeenCalledWith({ tripId: 'T1', stopIdx: 0, expectedStops: ui.dialog.expectedStops, set: { idxs: [0, 2], outcome: 'driver-refused', reason: 'ไกล' } })
    expect(ui.setDialog).toHaveBeenCalledWith(null)
    expect(ui.applyStops).not.toHaveBeenCalled()
    expect(ui.passLeaveGate).not.toHaveBeenCalled()
  })
  it('งานบนฐานเปลี่ยนหลังเปิดหน้าต่าง → ไม่เขียน ปิดหน้าต่าง บอกให้กดใหม่ที่จุดนั้น', async () => {
    const ui = arrange('reassigned', { form: { targetTripId: 'T2', reason: '' }, live: [P, X, { ...D, outcome: 'postponed' }] })
    await ui.handler()
    expect(ui.applyStops).not.toHaveBeenCalled()
    expect(ui.setDialog).toHaveBeenCalledWith(null)
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ description: TRANSFER_SET_CONFLICT, variant: 'destructive' })
  })
  it('บันทึกไม่ผ่าน (เน็ต/ด่านในธุรกรรม) → หน้าต่างค้างไว้ ไม่มี toast สำเร็จ', async () => {
    const ui = arrange('reassigned', { form: { targetTripId: 'T2', reason: '' }, save: false })
    await ui.handler()
    expect(ui.applyStops).toHaveBeenCalledOnce()
    expect(ui.setDialog).not.toHaveBeenCalled()
    expect(ui.toast).not.toHaveBeenCalled()
  })
})

describe('applyTransferSet: ยกเลิกทั้งชุด', () => {
  it('ยังเหลืองาน → คิด กม. ครั้งเดียวจากจุดที่เหลือ · ส่งทริปเป็นชุดตอนเปิดหน้าต่าง · sourceIndexes เดิม · ไม่มี supersede', async () => {
    const ui = arrange('cancel', { screen: [P, { ...X, cargoDetails: 'ข้อมูลบนจอที่ไม่ใช่ตอนเปิดหน้าต่าง' }, D] })
    await ui.handler()
    expect(ui.applyStopsWithDistance).toHaveBeenCalledOnce()
    const [tripArg, remaining, action, edit] = ui.applyStopsWithDistance.mock.calls[0] as [Raw, Raw[], string, Raw]
    expect(tripArg.stops).toEqual(ui.dialog.expectedStops)
    expect(remaining).toEqual([X])
    expect(action).toBe('ยกเลิกงานทั้งชุด')
    expect(edit).toEqual({ expectedStops: ui.dialog.expectedStops, sourceIndexes: [1] })
    expect(ui.remove).not.toHaveBeenCalled()
    expect(ui.setDialog).toHaveBeenCalledWith(null)
  })
  it('ไม่เหลืองานและไม่ถืองานโยกเข้า → ลบทริปทั้งใบแบบยกเลิกงาน (cancelJob) · ไม่เรียก Google', async () => {
    const ui = arrange('cancel', { stops: [P, D] })
    await ui.handler()
    expect(ui.remove).toHaveBeenCalledWith({}, 'T1', ui.dialog.expectedStops, undefined, { cancelJob: true })
    expect(ui.applyStopsWithDistance).not.toHaveBeenCalled()
    expect((ui.setTrips.mock.calls.at(-1)?.[0] as (p: Raw[]) => Raw[])([ui.trip, target]).map(t => t.id)).toEqual(['T2'])
    expect(ui.stats).toHaveBeenCalledOnce()
  })
  it('ไม่เหลืองานแต่ยังถืองานโยกเข้า → เก็บทริปไว้ (stops ว่าง)', async () => {
    const ui = arrange('cancel', { stops: [P, D], incoming: true })
    await ui.handler()
    expect(ui.remove).not.toHaveBeenCalled()
    expect(ui.applyStopsWithDistance.mock.calls[0][1]).toEqual([])
  })
  it('งานบนฐานเปลี่ยน → หยุดก่อนเรียก Google/ลบ ปิดหน้าต่าง บอกให้กดใหม่ที่จุดนั้น', async () => {
    const ui = arrange('cancel', { live: [P, X] })
    await ui.handler()
    expect(ui.applyStopsWithDistance).not.toHaveBeenCalled()
    expect(ui.remove).not.toHaveBeenCalled()
    expect(ui.setDialog).toHaveBeenCalledWith(null)
    expect(ui.toast.mock.calls.at(-1)?.[0].description).toBe(TRANSFER_SET_CONFLICT)
  })
  it('ลบทริปไม่ผ่าน → แจ้ง ไม่ปิดหน้าต่าง ไม่ลบบนจอ', async () => {
    const ui = arrange('cancel', { stops: [P, D] })
    ui.remove.mockRejectedValueOnce(new Error('มีงานโยกเข้าแล้ว'))
    await ui.handler()
    expect(ui.setDialog).not.toHaveBeenCalled()
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'ลบไม่สำเร็จ', variant: 'destructive' })
  })
})

describe('createReassignTarget: ทั้งชุดให้คน/รถใหม่ (หน้าต่างเดิม + set)', () => {
  function newUi(set: Raw | undefined, opts: { live?: Raw[]; leave?: boolean; save?: boolean; vehicle?: string } = {}) {
    const stops = [P, X, D]
    const trip = { id: 'T1', tripDate: '2026-11-05', driverName: 'สมชาย', vehiclePlate: 'กข 1', status: 'Planned', stops: structuredClone(stops) }
    const toast = vi.fn(), setTrips = vi.fn(), setNewDialog = vi.fn(), standalone = vi.fn()
    const applyStops = vi.fn(async (..._args: unknown[]) => opts.save !== false)
    const passLeaveGate = vi.fn(async (..._args: unknown[]) => opts.leave !== false)
    const deps = {
      ...shared(trip, opts.live ?? null, toast, setTrips),
      reassignNewDialog: { tripId: 'T1', stopIdx: 0, expectedStops: structuredClone(stops), ...(set ? { set } : {}) }, trips: [trip], setReassignNewDialog: setNewDialog, setReassignNewForm: vi.fn(),
      allowOrdinaryEdit: () => true, driversData: [{ id: 'D9', name: 'คนใหม่' }], vehiclesData: [{ id: 'V9', licensePlate: opts.vehicle ?? 'รถใหม่' }], reassignNewForm: { driverId: 'D9', vehicleId: 'V9' },
      passLeaveGate, buildStops: (t: Raw, index: number, fn: (s: Raw) => Raw) => t.stops.map((s: Raw, i: number) => (i === index ? fn(s) : s)), applyStops, serverTimestamp: () => 'time', createTripWithQueueGuard: standalone,
    }
    const handler = new Function(...Object.keys(deps), `${realHelpers}${body('createReassignTarget')}return createReassignTarget`)(...Object.values(deps)) as () => Promise<void>
    // readLiveTrip ก็เรียก setTrips (อัปเดตจอด้วยข้อมูลบนฐาน) — นับเฉพาะการเพิ่มทริปใหม่บนจอ
    const added = () => setTrips.mock.calls.filter(([fn]) => (fn as (p: Raw[]) => Raw[])([]).length > 0).length
    return { handler, applyStops, passLeaveGate, added, setNewDialog, toast, standalone }
  }
  it('โยกทั้งชุด: ทริปใหม่ว่างสร้างในธุรกรรมเดียวกับต้นทาง · ทุกจุดในชุดได้ผล+ชี้ทริปใหม่ · จุดอื่นไม่เปลี่ยน · เพิ่มบนจอหลังบันทึกผ่าน', async () => {
    const ui = newUi({ idxs: [0, 2], outcome: 'reassigned', reason: '' })
    await ui.handler()
    expect(ui.standalone).not.toHaveBeenCalled()
    expect(String(ui.passLeaveGate.mock.calls[0][0])).toContain('set:0,2')
    expect(ui.passLeaveGate.mock.calls[0][1]).toEqual([{ driverId: 'D9', date: '2026-11-05' }])
    const [, next, , edit] = ui.applyStops.mock.calls[0] as [Raw, Raw[], boolean, Raw]
    expect(edit).toMatchObject({ sourceIndexes: [0, 1, 2], createTarget: { data: { vehicleId: 'V9', driverId: 'D9', stops: [] } } })
    for (const i of [0, 2]) expect(next[i]).toMatchObject({ outcome: 'reassigned', outcomeRecordedBy: 'น้าสาว', reassignedToTripId: edit.createTarget.id, reassignedToVehiclePlate: 'รถใหม่', reassignedToDriverName: 'คนใหม่' })
    expect(strip(next[0])).toEqual(P)
    expect(next[1]).toEqual(X)
    expect(ui.added()).toBe(1)
    expect(ui.toast.mock.calls.at(-1)?.[0].title).toBe('โยกงานทั้งชุดให้คนใหม่แล้ว ✅')
    expect(ui.setNewDialog).toHaveBeenCalledWith(null)
  })
  it('ปฏิเสธทั้งชุด + เหตุผล → ทุกจุดในชุดได้ outcomeReason', async () => {
    const ui = newUi({ idxs: [0, 2], outcome: 'driver-refused', reason: 'ไกล' })
    await ui.handler()
    const next = ui.applyStops.mock.calls[0][1] as Raw[]
    expect([next[0].outcomeReason, next[2].outcomeReason]).toEqual(['ไกล', 'ไกล'])
    expect(next[0].outcome).toBe('driver-refused')
  })
  it('รถคันเดียวกับต้นทาง / ด่านวันลาตอบไม่ → ไม่เขียน', async () => {
    const same = newUi({ idxs: [0, 2], outcome: 'reassigned', reason: '' }, { vehicle: 'กข 1' })
    await same.handler()
    expect(same.applyStops).not.toHaveBeenCalled()
    const leave = newUi({ idxs: [0, 2], outcome: 'reassigned', reason: '' }, { leave: false })
    await leave.handler()
    expect(leave.applyStops).not.toHaveBeenCalled()
  })
  it('งานบนฐานเปลี่ยน → ปิดหน้าต่าง บอกให้กดใหม่ ไม่สร้างทริป', async () => {
    const ui = newUi({ idxs: [0, 2], outcome: 'reassigned', reason: '' }, { live: [P, X] })
    await ui.handler()
    expect(ui.applyStops).not.toHaveBeenCalled()
    expect(ui.setNewDialog).toHaveBeenCalledWith(null)
    expect(ui.toast.mock.calls.at(-1)?.[0].description).toBe(TRANSFER_SET_CONFLICT)
  })
  it('บันทึกไม่ผ่าน → ไม่เพิ่มทริปบนจอ หน้าต่างค้างไว้', async () => {
    const ui = newUi({ idxs: [0, 2], outcome: 'reassigned', reason: '' }, { save: false })
    await ui.handler()
    expect(ui.added()).toBe(0)
    expect(ui.setNewDialog).not.toHaveBeenCalled()
  })
})

// ---- ปุ่มของแถวในแผงปิดผลงาน + ปุ่มในหน้าต่าง (React ปลอม: เก็บ props ไว้กดเอง) ----
const React = { Fragment: 'fragment', createElement: (type: unknown, props: Raw | null, ...children: unknown[]) => ({ type, props: props || {}, children }) }
type El = { type: unknown; props: Raw; children: unknown[] }
const text = (node: unknown): string => node == null || node === false || node === true ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text((node as El).children)
function all(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach(n => all(n, out))
  else if (node && typeof node === 'object' && 'props' in (node as El)) { out.push(node as El); all((node as El).children, out) }
  return out
}
const clickable = (tree: unknown, label: string) => {
  const hits = all(tree).filter(el => typeof el.props.onClick === 'function' && text(el).includes(label))
  if (hits.length !== 1) throw new Error(`ปุ่ม "${label}" เจอ ${hits.length}`)
  return hits[0]
}

describe('แถวในแผงปิดผลงาน: ปุ่มไหนถามทั้งชุด', () => {
  function row(stops: Raw[], sIdx: number) {
    const trip = { id: 'T1', tripDate: '2026-11-05', stops }
    const calls: unknown[][] = []
    const runOrdinaryAction = (fn: () => unknown) => { fn() }
    const deps = {
      React, isManagedTrip, displayOf: () => ({ ownPos: stops.map((_, i) => i), peers: stops }), activeTransferSet,
      openTransferSet: (...args: unknown[]) => calls.push(['set', ...args.slice(1)]),
      runOrdinaryAction, chooseOutcome: (...args: unknown[]) => calls.push(['outcome', ...args.slice(1)]), cancelStop: (...args: unknown[]) => calls.push(['cancel', ...args.slice(1)]),
      ordinaryBusy: false, cn: (...c: unknown[]) => c.filter(Boolean).join(' '), transferLabel: () => null, RequestTimingBadge: 'badge', openNoteDialog: () => {}, Pencil: 'i', Trash2: 'i', CheckCircle2: 'i', ArrowRightLeft: 'i', CalendarClock: 'i', Ban: 'i',
      setAssistForm: () => {}, setAssistDialog: () => {}, refusalDrafts: {}, setRefuseReason: () => {}, formatThaiDate: (s: string) => s, setReassignNewForm: () => {}, setReassignNewDialog: () => {}, setReassignTarget: () => {},
      trips: [trip], tripDriverLabel, liveMoveTarget: () => null,
    }
    const render = new Function(...Object.keys(deps), `${body('renderStopRow')}return renderStopRow`)(...Object.values(deps))
    const tree = render(trip, stops[sIdx], sIdx)
    const press = (label: string) => { calls.length = 0; clickable(tree, label).props.onClick(); return calls[0] }
    return { press }
  }
  it('จุดรับที่มีจุดส่งในเที่ยวเดียวกัน: โยก/ปฏิเสธ/ยกเลิก เปิดหน้าต่างทั้งชุด · ตามแผน/เลื่อน ทำงานเดิม', () => {
    const ui = row([P, X, D], 0)
    expect(ui.press('โยกงาน')).toEqual(['set', 0, [0, 2], 'reassigned'])
    expect(ui.press('คนขับปฏิเสธ')).toEqual(['set', 0, [0, 2], 'driver-refused'])
    expect(ui.press('ยกเลิก')).toEqual(['set', 0, [0, 2], 'cancel'])
    expect(ui.press('เลื่อน')).toEqual(['outcome', 0, 'postponed'])
    expect(ui.press('ตามแผน')).toEqual(['outcome', 0, 'delivered'])
  })
  it('งานปกติ / จุดคู่ไม่ไปกับเที่ยวนี้แล้ว / สำเนาคันช่วย → ปุ่มทีละจุดเหมือนเดิมทุกปุ่ม', () => {
    for (const [stops, sIdx] of [[[P, X, D], 1], [[P, X, { ...D, outcome: 'postponed' }], 0], [[X, { ...P, assistForPlate: 'รถ 9' }, D], 1]] as [Raw[], number][]) {
      const ui = row(stops, sIdx)
      expect(ui.press('โยกงาน')).toEqual(['outcome', sIdx, 'reassigned'])
      expect(ui.press('คนขับปฏิเสธ')).toEqual(['outcome', sIdx, 'driver-refused'])
      expect(ui.press('ยกเลิก')).toEqual(['cancel', sIdx])
    }
  })
})

describe('หน้าต่าง "ทำทั้งชุดไหม?"', () => {
  function dialog(action: 'reassigned' | 'driver-refused' | 'cancel', form = { targetTripId: '', reason: '' }) {
    const stops = [P, X, D]
    const trip = { id: 'T1', tripDate: '2026-11-05', driverName: 'สมชาย', vehiclePlate: 'กข 1', stops }
    const feeder = { id: 'T3', tripDate: '2026-11-05', driverName: 'สมศรี', vehiclePlate: 'รถสาม', stops: [{ siteName: 'ดูโฮม', transferRole: 'pickup', transferId: 'tf1', reassignedToTripId: 'T1', outcome: 'reassigned' }] }
    const helper = { id: 'T4', tripDate: '2026-11-05', driverName: 'คนช่วย', vehiclePlate: 'รถช่วย', stops: [{ ...P, assistForPlate: 'กข 1' }] }
    const trips = [trip, target, feeder, helper]
    const calls: unknown[][] = []
    const setDialog = vi.fn()
    const deps = {
      React, transferSetDialog: { tripId: 'T1', stopIdx: 0, idxs: [0, 2], action, expectedStops: stops }, trips, incomingOf: (id: string) => incomingStopsForTrip(trips as never[], id),
      transferSetOutside, transferStopName, transferSetForm: form, setTransferSetForm: () => {}, ordinaryBusy: false, isManagedTrip, tripDriverLabel,
      Button: 'button', DialogFooter: 'footer', setTransferSetDialog: setDialog, cn: (...c: unknown[]) => c.filter(Boolean).join(' '),
      runOrdinaryAction: (fn: () => unknown) => { calls.push(['run']); fn() },
      cancelStop: (...args: unknown[]) => calls.push(['cancel', (args[0] as Raw).id, args[1]]), chooseOutcome: (...args: unknown[]) => calls.push(['outcome', (args[0] as Raw).id, args[1], args[2]]),
      applyTransferSet: () => calls.push(['set']),
    }
    const tree = new Function(...Object.keys(deps), `${arrowWith('transferSetOutside(d.expectedStops')}return work()`)(...Object.values(deps))
    const press = (label: string) => { calls.length = 0; setDialog.mockClear(); clickable(tree, label).props.onClick(); return { calls: [...calls], closed: setDialog.mock.calls.some(c => c[0] === null) } }
    return { tree, press }
  }
  it('รายชื่อในชุด + จุดที่ไม่แตะ (งานโยกเข้า/สำเนาคันช่วยบนคันอื่น)', () => {
    const out = text(dialog('reassigned').tree)
    expect(out).toContain('จะโยกพร้อมกัน 2 จุด')
    expect(out).toContain('วังโค (จุดรับ)')
    expect(out).toContain('ดอนเมือง (จุดส่ง)')
    expect(out).toContain(`ดูโฮม (จุดรับ) — โยกมาจาก รถสาม (สมศรี) · ${TRANSFER_EDIT_AT_SOURCE}`)
    expect(out).toContain('สำเนาคันช่วยบนรถ รถช่วย (คนช่วย)')
  })
  it('"เฉพาะจุดนี้" ปิดหน้าต่างแล้วเรียกทางทีละจุดตัวเดิมผ่าน runOrdinaryAction · ปุ่มทั้งชุดเรียก applyTransferSet', () => {
    expect(dialog('reassigned').press('โยกเฉพาะจุดนี้')).toEqual({ calls: [['run'], ['outcome', 'T1', 0, 'reassigned']], closed: true })
    expect(dialog('driver-refused').press('ปฏิเสธเฉพาะจุดนี้')).toEqual({ calls: [['run'], ['outcome', 'T1', 0, 'driver-refused']], closed: true })
    expect(dialog('cancel').press('ยกเลิกเฉพาะจุดนี้')).toEqual({ calls: [['run'], ['cancel', 'T1', 0]], closed: true })
    expect(dialog('cancel').press('ยกเลิกทั้งชุด 2 จุด').calls).toEqual([['run'], ['set']])
    expect(dialog('reassigned', { targetTripId: 'T2', reason: '' }).press('โยกทั้งชุด 2 จุด').calls).toEqual([['run'], ['set']])
  })
  it('โยกทั้งชุดต้องเลือกคันก่อน (ปุ่มกดไม่ได้) · ปฏิเสธไม่บังคับ · ปุ่มปิดไม่ใช้คำว่า "ยกเลิก"', () => {
    const disabled = (tree: unknown, label: string) => clickable(tree, label).props.disabled
    expect(disabled(dialog('reassigned').tree, 'โยกทั้งชุด')).toBe(true)
    expect(disabled(dialog('reassigned', { targetTripId: 'T2', reason: '' }).tree, 'โยกทั้งชุด')).toBe(false)
    expect(disabled(dialog('driver-refused').tree, 'ปฏิเสธทั้งชุด')).toBe(false)
    expect(text(clickable(dialog('cancel').tree, 'ปิด'))).toBe('ปิด')
  })
})

describe('หน้าต่างเลื่อน: ปุ่มส่ง whole ชัด ๆ (ไม่ส่ง event เข้า handlePostpone)', () => {
  function buttons(postponeSet: number[]) {
    const found: string[] = []
    const find = (node: ts.Node) => {
      if (ts.isArrowFunction(node) && /^\(\) => void runOrdinaryAction\(\(\) => handlePostpone\(/.test(node.getText(source))) found.push(node.getText(source))
      ts.forEachChild(node, find)
    }
    find(source)
    return found.map(code => {
      const handlePostpone = vi.fn()
      const click = new Function('runOrdinaryAction', 'handlePostpone', 'postponeSet', `return ${ts.transpileModule(code, { compilerOptions: jsx }).outputText}`)((fn: () => unknown) => fn(), handlePostpone, postponeSet)
      click({ type: 'click' })
      return handlePostpone.mock.calls
    })
  }
  it('มีชุด: [เลื่อนเฉพาะจุดนี้ → false, เลื่อนทั้งชุด → true] · ไม่มีชุด: ปุ่มเดียวส่ง false', () => {
    expect(buttons([0, 2])).toEqual([[[false]], [[true]]])
    expect(buttons([])).toEqual([[[false]], [[false]]])
  })
})
