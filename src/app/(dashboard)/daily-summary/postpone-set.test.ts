import { readFileSync } from 'node:fs'
import { format } from 'date-fns'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'
import { incomingStopsForTrip } from '@/lib/calculations'
import { isManagedTrip } from '@/lib/continuousQueue'
import { findFreeRequestId, requestIdPrefix, RequestIdExhaustedError } from '@/lib/requestId'
import { activeTransferSet, postponedPickupNote, TRANSFER_SET_CONFLICT, transferMateReminder } from '@/lib/transfer'
import { assertTripStopsUnchanged } from '@/lib/tripQueueGuard'

// เลื่อนทั้งชุด / ทีละจุด — คอมไพล์ handlePostpone ตัวจริงจากหน้าใบสรุป + ธุรกรรมปลอม (อ่านหลังเขียน = พัง · throw = ไม่มีอะไรถูกเขียน)
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function body(name: string) {
  let value: ts.Expression | undefined
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!value) throw new Error(`Actual ${name} missing`)
  return ts.transpileModule(`const ${name} = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

type Raw = Record<string, any>
const A = { siteId: 'S-A', siteName: 'ร้าน A', order: 1, cargoDetails: 'ปูน 10 ถุง', lat: 13.1, lng: 100.1, requestedBy: 'คุณขอ', requestedByPhone: '081', requestedByUserId: 'U-REQ', requestTime: '09:00', note: 'โน้ต A', transferRole: 'pickup', transferId: 'tf1', transferDropName: 'ไซต์ D' }
const B = { siteName: 'ร้าน B', order: 2, cargoDetails: 'ท่อ 5 เส้น', transferRole: 'pickup', transferId: 'tf1', transferDropName: 'ไซต์ D' }
const X = { siteId: 'S-X', siteName: 'งานอื่น', order: 3, cargoDetails: 'ส่งเอกสาร' }
const D = { siteId: 'S-D', siteName: 'ไซต์ D', order: 4, cargoDetails: 'ส่งของที่รับจาก ร้าน A: ปูน 10 ถุง\nส่งของที่รับจาก ร้าน B: ท่อ 5 เส้น', lat: 13.5, lng: 100.5, transferRole: 'drop', transferId: 'tf1' }
const NEW_DATE = '2099-01-02' // ต้องหลังวันนี้เสมอ
const PREFIX = requestIdPrefix(NEW_DATE)

function arrange(opts: { stops?: Raw[]; stopIdx?: number; live?: Raw[]; existing?: Record<string, Raw>; startSize?: number } = {}) {
  const stops = opts.stops ?? [A, B, X, D]
  const trip = { id: 'T1', tripId: 'T-0511-0011', tripDate: '2026-11-05', driverName: 'สมชาย', vehiclePlate: 'กข 1', status: 'Planned', stops: structuredClone(stops) }
  const store = new Map<string, Raw>([['trips/T1', { ...structuredClone(trip), stops: structuredClone(opts.live ?? stops) }], ...Object.entries(opts.existing ?? {})])
  const before = structuredClone([...store.entries()])
  const sets: [string, Raw][] = []
  const updates: [string, Raw][] = []
  const runTransaction = async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const buffer: (() => void)[] = []
    let wrote = false
    const tx = {
      get: async (ref: string) => {
        if (wrote) throw new Error('อ่านหลังเขียนในธุรกรรม')
        return { exists: () => store.has(ref), data: () => structuredClone(store.get(ref)) }
      },
      set: (ref: string, data: Raw) => { wrote = true; sets.push([ref, data]); buffer.push(() => store.set(ref, data)) },
      update: (ref: string, data: Raw) => { wrote = true; updates.push([ref, data]); buffer.push(() => store.set(ref, { ...store.get(ref), ...data })) },
    }
    const out = await fn(tx) // throw = ทิ้ง buffer ทั้งหมด
    buffer.forEach(write => write())
    return out
  }
  const toast = vi.fn(), setPostponeDialog = vi.fn(), setTrips = vi.fn(), isPostponedReqGrouped = vi.fn(async () => false)
  const deps = {
    postponeDialog: { tripId: 'T1', stopIdx: opts.stopIdx ?? 0, expectedStops: structuredClone(stops) },
    db: {}, trips: [trip], setPostponeDialog, allowOrdinaryEdit: () => true, activeTransferSet, toast, postponeDateStr: NEW_DATE, format,
    postponedPickupNote, setIsPostponing: vi.fn(), isPostponedReqGrouped,
    getDocs: async () => ({ size: opts.startSize ?? 0 }), query: () => ({}), collection: () => ({}), where: () => ({}),
    doc: (_db: unknown, coll: string, id: string) => `${coll}/${id}`, requestIdPrefix, user: { uid: 'U-DISP', email: 'disp@x' }, serverTimestamp: () => 'ts',
    runTransaction, isManagedTrip, assertTripStopsUnchanged, findFreeRequestId, recordedBy: 'น้าสาว',
    setTrips, setRefusalDrafts: vi.fn(), formatThaiDate: (s: string) => s, TRANSFER_SET_CONFLICT, RequestIdExhaustedError,
    incomingStopsForTrip, transferMateReminder, console: { error: () => {} },
  }
  const handler = new Function(...Object.keys(deps), `${body('transferPeersOf')}${body('stripOutcome')}${body('cleanStops')}${body('handlePostpone')}return handlePostpone`)(...Object.values(deps)) as (whole?: boolean) => Promise<void>
  const requests = () => sets.filter(([ref]) => ref.startsWith('vehicleRequests/'))
  const tripWrites = () => updates.filter(([ref]) => ref === 'trips/T1')
  return { handler, store, before, sets, updates, requests, tripWrites, toast, setPostponeDialog, setTrips, isPostponedReqGrouped }
}
const seqOf = (id: string) => Number(id.slice(PREFIX.length + 1, -1))
afterEach(() => { vi.restoreAllMocks() })

it('เลื่อนทีละจุด (whole=false): ใบ rescheduled 1 ใบ หน้าตาเดิมทุกฟิลด์ · จุดอื่นไม่เปลี่ยน', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.45)
  const ui = arrange({ stopIdx: 0 })
  await ui.handler(false)
  const id = `${PREFIX}-0014`
  expect(ui.requests()).toEqual([[`vehicleRequests/${id}`, {
    id, requestId: id, requestDate: NEW_DATE, requestTime: '09:00', requestedBy: 'คุณขอ', requestedByPhone: '081', requestedByEmail: '',
    userId: 'U-REQ', userEmail: 'disp@x', createdByUserId: 'U-DISP', createdByEmail: 'disp@x',
    destinations: [{ type: 'site', siteId: 'S-A', siteName: 'ร้าน A', customName: null, lat: 13.1, lng: 100.1, jobDescription: 'ปูน 10 ถุง\n(รับของแล้วเอาไปส่งต่อที่ ไซต์ D)', requestTime: '09:00' }],
    note: 'โน้ต A', status: 'rescheduled', rescheduledFromDate: '2026-11-05', rescheduledFromTripId: 'T-0511-0011', createdAt: 'ts',
  }]])
  expect(ui.tripWrites()).toHaveLength(1)
  const next = ui.tripWrites()[0][1].stops
  expect(next[0]).toEqual({ ...A, outcome: 'postponed', outcomeRecordedBy: 'น้าสาว', outcomeAt: next[0].outcomeAt, postponedToDate: NEW_DATE, postponedRequestId: id })
  expect(next.slice(1)).toEqual([B, X, D])
  expect(ui.toast.mock.calls.at(-1)?.[0]).toEqual({ title: 'เลื่อนงานแล้ว ✅', description: `ย้ายไป ${NEW_DATE} — เข้ากองจัดเที่ยววิ่งวันนั้นเรียบร้อย (${id})` })
  expect(ui.setPostponeDialog).toHaveBeenCalledWith(null)
})

it('เลื่อนทีละจุดซ้ำ (จุดเคยเลื่อน): ปลดใบเก่าเป็น superseded ชี้ไปใบใหม่ เหมือนเดิม', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.45)
  const again = { ...X, outcome: 'postponed', postponedToDate: '2099-01-01', postponedRequestId: 'VR-0101-0011' }
  const ui = arrange({ stops: [again], stopIdx: 0, existing: { 'vehicleRequests/VR-0101-0011': { status: 'rescheduled' } } })
  await ui.handler()
  const id = `${PREFIX}-0014`
  expect(ui.isPostponedReqGrouped).toHaveBeenCalledWith('VR-0101-0011')
  expect(ui.updates).toContainEqual(['vehicleRequests/VR-0101-0011', { status: 'superseded', supersededBy: id, supersededAt: 'ts', supersededByUser: 'น้าสาว' }])
  expect(ui.tripWrites()[0][1].stops[0]).toMatchObject({ outcome: 'postponed', postponedToDate: NEW_DATE, postponedRequestId: id })
})

it('เลื่อนทั้งชุด: [ร้าน A รับ, ร้าน B รับ, งานอื่น, ไซต์ D ส่ง] กดที่ร้าน A → ใบละจุด 3 ใบ · จุดรับบอกปลายทาง · ทริปเขียนครั้งเดียว · งานอื่นไม่ขยับ', async () => {
  const ui = arrange({ stopIdx: 0 })
  await ui.handler(true)
  const requests = ui.requests()
  expect(requests).toHaveLength(3)
  const ids = requests.map(([, data]) => data.id)
  expect(new Set(ids).size).toBe(3)
  expect(requests.map(([, data]) => data.destinations[0].siteName)).toEqual(['ร้าน A', 'ร้าน B', 'ไซต์ D'])
  expect(requests.map(([, data]) => data.destinations[0].jobDescription)).toEqual([
    'ปูน 10 ถุง\n(รับของแล้วเอาไปส่งต่อที่ ไซต์ D)', 'ท่อ 5 เส้น\n(รับของแล้วเอาไปส่งต่อที่ ไซต์ D)', D.cargoDetails,
  ])
  // ใบวันใหม่ = งานธรรมดา (ไม่มี transfer*) หน้าตาเดียวกับเลื่อนทีละจุด
  for (const [, data] of requests) {
    expect(data.status).toBe('rescheduled')
    expect(Object.keys(data.destinations[0]).filter(key => key.startsWith('transfer'))).toEqual([])
    expect(data.destinations).toHaveLength(1)
  }
  expect(ui.tripWrites()).toHaveLength(1)
  const next = ui.tripWrites()[0][1].stops
  expect([0, 1, 3].map(i => next[i].postponedRequestId)).toEqual(ids)
  expect([0, 1, 3].every(i => next[i].outcome === 'postponed' && next[i].postponedToDate === NEW_DATE)).toBe(true)
  expect(next[2]).toEqual(X)
  expect(ui.isPostponedReqGrouped).not.toHaveBeenCalled()
  const done = ui.toast.mock.calls.at(-1)?.[0]
  expect(done.title).toBe('เลื่อนทั้งชุด 3 จุดแล้ว ✅')
  expect(done.description).toContain('ใบขอธรรมดา 3 ใบ')
  expect(done.description).toContain('คันเดียวกัน')
  expect(done.description).toContain('จุดรับมาก่อนจุดส่ง')
  expect(ids.every(id => done.description.includes(id))).toBe(true)
  expect(ui.setPostponeDialog).toHaveBeenCalledWith(null)
})

it('เลื่อนทั้งชุด: เลขสุ่มชนกัน + มีใบเลขแรกอยู่แล้ว → ทุกใบได้รหัสไม่ซ้ำ ไม่มีใบไหนถูกเขียนทับ', async () => {
  // เลขสุ่มหลักท้ายออก 4 ทุกครั้ง และฐานมี VR-...-0014 อยู่แล้ว → จุดแรกต้องขยับไป 0024
  // ถ้าไม่จดเลขที่ได้ไปแล้ว/ไม่เริ่มหาหลังลำดับที่เพิ่งได้ จุดถัดไปจะได้ 0024 ซ้ำ แล้ว t.set ใบหลังทับใบแรกเงียบ ๆ
  vi.spyOn(Math, 'random').mockReturnValue(0.45)
  const ui = arrange({ stopIdx: 3, existing: { [`vehicleRequests/${PREFIX}-0014`]: { status: 'pending', note: 'ใบของคนอื่น' } } })
  await ui.handler(true)
  const ids = ui.requests().map(([ref]) => ref)
  expect(ids).toEqual([`vehicleRequests/${PREFIX}-0024`, `vehicleRequests/${PREFIX}-0034`, `vehicleRequests/${PREFIX}-0044`])
  expect(ui.store.get(`vehicleRequests/${PREFIX}-0014`)).toEqual({ status: 'pending', note: 'ใบของคนอื่น' })
  expect([...ui.store.keys()].filter(key => key.startsWith('vehicleRequests/')).length).toBe(4)
})

it('เลื่อนทั้งชุด: ใบถัดไปเริ่มหาหลังลำดับที่เพิ่งได้ — ไม่มีสองใบที่ลำดับเดียวกันต่างกันแค่หลักท้าย', async () => {
  const rolls = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
  vi.spyOn(Math, 'random').mockImplementation(() => rolls.shift() ?? 0.9)
  const ui = arrange({ stopIdx: 0, startSize: 6 })
  await ui.handler(true)
  expect(ui.requests().map(([, data]) => seqOf(data.id))).toEqual([7, 8, 9])
})

it('เลื่อนทั้งชุด: งานบนฐานเปลี่ยนหลังเปิดหน้าต่าง → ไม่เขียนอะไรเลย ปิดหน้าต่าง บอกให้กดใหม่ที่จุดนั้น', async () => {
  const ui = arrange({ stopIdx: 0, live: [A, B, X, { ...D, outcome: 'reassigned', reassignedToTripId: 'T9' }] })
  await ui.handler(true)
  expect(ui.sets).toEqual([])
  expect(ui.updates).toEqual([])
  expect([...ui.store.entries()]).toEqual(ui.before)
  expect(ui.setPostponeDialog).toHaveBeenCalledWith(null)
  expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ description: TRANSFER_SET_CONFLICT, variant: 'destructive' })
  expect(ui.setTrips).not.toHaveBeenCalled()
})

it('เลื่อนทีละจุด: งานบนฐานเปลี่ยน → ไม่เขียน หน้าต่างค้างไว้ ข้อความเดิม (ไม่เปลี่ยนพฤติกรรม)', async () => {
  const ui = arrange({ stopIdx: 0, live: [A, B, X] })
  await ui.handler(false)
  expect(ui.sets).toEqual([])
  expect(ui.setPostponeDialog).not.toHaveBeenCalled()
  expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'เลื่อนงานไม่สำเร็จ', variant: 'destructive' })
  expect(ui.toast.mock.calls.at(-1)?.[0].description).not.toBe(TRANSFER_SET_CONFLICT)
})

it('เลื่อนทั้งชุดไม่ได้ เมื่อจุดในชุดมีใบเลื่อนค้าง / ไม่มีจุดคู่ → ไม่เปิดธุรกรรม', async () => {
  const stale = arrange({ stops: [A, { ...D, postponedRequestId: 'VR-0101-0011' }], stopIdx: 0 })
  await stale.handler(true)
  expect(stale.sets).toEqual([])
  expect(stale.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'เลื่อนทั้งชุดไม่ได้', variant: 'destructive' })
  const alone = arrange({ stops: [A, X], stopIdx: 0 })
  await alone.handler(true)
  expect(alone.sets).toEqual([])
})
