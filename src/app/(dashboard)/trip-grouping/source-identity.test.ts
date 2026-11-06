import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { assertRequestDestinationsUnchanged, dispatchedDestinationIndexes, requestDestinationFingerprint } from '@/lib/requestDestination'
import { inThailand } from '@/lib/roadFlood'
import { isTransferStop, orderPickupsBeforeDrop, stopSetKey, transferShapeProblem, transferStopFields } from '@/lib/transfer'
import { enforceSetOrder, isOneOffJobStop, isSequenceStop, jobSetFields, jobSetLabel } from '@/lib/sequence'

const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
// helper ของชุดงาน (รับ-ส่ง + งานต่อเนื่อง) ที่หน้าใช้ — ฉีดให้ทุกตัวที่ดึงมา (ตัวที่ส่งมาเองทับได้)
const SET_DEPS = { stopSetKey, enforceSetOrder, isOneOffJobStop, isSequenceStop, jobSetFields, jobSetLabel }
function actual(name: string, given: Record<string, unknown>) {
  const deps = { ...SET_DEPS, ...given }
  let expression: ts.Expression | undefined
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!expression) throw new Error(`Actual ${name} missing`)
  const compiled = ts.transpileModule(`const work = ${expression.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(deps), `${compiled}return work`)(...Object.values(deps))
}

const original = { requestId: 'VR-0710-001', requestDate: '2026-10-07', requestedBy: 'ผู้ขอ', status: 'in_progress', destinations: [{ siteName: 'งานเดิม', jobDescription: 'ส่งเครื่องมือ', lat: 13, lng: 100 }] }
const selected = { ...original.destinations[0], id: 'R1-0', vrDocId: 'R1', vrId: original.requestId, destIndex: 0, requestDate: original.requestDate, sourceFingerprint: requestDestinationFingerprint(original, 0) }

type Plan = { km: number; minutes: number; fuelCost: number } | 'no-coords' | 'failed'
function createUi(options: { continuous?: boolean; borrow?: boolean; changed?: boolean; plan?: Plan; fuelRate?: number; changeDuringPlan?: boolean; request?: typeof original } = {}) {
  const base = options.request ?? original
  const pick = options.request ? { ...base.destinations[0], id: 'R1-0', vrDocId: 'R1', vrId: base.requestId, destIndex: 0, requestDate: base.requestDate, sourceFingerprint: requestDestinationFingerprint(base, 0) } : selected
  const fresh = options.changed ? { ...base, destinations: [{ ...base.destinations[0], siteName: 'อีกงานที่สลับมา' }] } : base
  const create = vi.fn().mockResolvedValue(undefined), command = vi.fn().mockResolvedValue({ tripIds: ['T1'] }), toast = vi.fn()
  const flight = { isCurrent: () => true, operationId: () => 'OP1', finish: vi.fn() }
  const selectionSigRef = { current: 'unchanged' }
  const computePlan = vi.fn(async (..._args: unknown[]) => {
    if (options.changeDuringPlan) selectionSigRef.current = 'changed' // ผู้ใช้เปลี่ยนการเลือกระหว่างรอ Google
    return options.plan ?? { km: 120, minutes: 150, fuelCost: 390 }
  })
  const getDocs = vi.fn().mockResolvedValue({ size: 0 })
  const deps = {
    stopCoords: actual('stopCoords', { inThailand }),
    user: { uid: 'U1' }, selectionSig: 'unchanged', selectionSigRef, pageVersionRef: { current: 0 },
    commandFlightRef: { current: { begin: () => flight } }, borrowOpenRef: { current: true }, confirmOpenRef: { current: true },
    setIsProcessing: vi.fn(), selectedDestinations: [pick], driverId: 'D1', vehicleId: 'V1',
    continuousEndDate: options.continuous ? '2026-10-09' : '', expandQueueDates: () => ['2026-10-07', '2026-10-08', '2026-10-09'],
    window: { confirm: () => true }, toast, confirmLeaveBeforeAssign: vi.fn().mockResolvedValue(true), checkLeave: vi.fn(), drivers: [{ id: 'D1', name: 'คนขับ' }],
    borrowOpen: true, getDoc: vi.fn().mockResolvedValue({ exists: () => true, data: () => fresh }), doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`, db: {},
    selectedVehicle: { licensePlate: 'รถทดสอบ', type: 'truck', fuelRate: options.fuelRate }, settings: { dieselPrice: 30, googleMapsApiKeyReference: 'maps-key' }, computeTripPlanDistance: computePlan, runContinuousQueueCommand: command, continuousQueues: { refresh: vi.fn() }, queueDateLabel: (date: string) => date,
    resetAll: vi.fn(), getDocs, query: vi.fn(), collection: vi.fn(), where: vi.fn(), createTripWithQueueGuard: create, serverTimestamp: () => 'time',
    assertRequestDestinationsUnchanged, requestDestinationFingerprint, console: { error: vi.fn() }, transferStopFields,
  }
  return { handler: actual('confirmCreateTrip', deps), create, command, toast, computePlan, getDocs, borrowChoice: options.borrow ? { bookingId: 'B1', reason: 'งานจำเป็น' } : undefined }
}

describe('สร้างทริป: คิด กม. จากงานชุดที่บันทึกจริง (ไม่ใช้เลขค้างบนแผนที่)', () => {
  const written = (ui: ReturnType<typeof createUi>, viaQueue: boolean) => viaQueue ? ui.command.mock.calls[0][1].trip : ui.create.mock.calls[0][2]

  it.each([{ continuous: false }, { continuous: true }, { borrow: true }])('ใส่ กม./เวลา/ค่าน้ำมันจากตัวคิดกลาง + freeze อัตรา/ราคา %j', async options => {
    const ui = createUi({ ...options, fuelRate: 8 })
    await ui.handler(ui.borrowChoice)
    expect(ui.computePlan).toHaveBeenCalledTimes(1)
    const [key, planTrip, planStops] = ui.computePlan.mock.calls[0]
    expect(key).toBe(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || 'maps-key')
    expect(planTrip).toEqual({ originLat: 14.0815, originLng: 100.7129, fuelRateUsed: 8, dieselPriceUsed: 30 })
    expect(planStops).toEqual([expect.objectContaining({ lat: 13, lng: 100, siteName: 'งานเดิม' })])
    const trip = written(ui, !!(options.continuous || options.borrow))
    expect(trip).toMatchObject({ totalDistanceKm: 120, totalEstimatedTimeMinutes: 150, fuelCost: 390, fuelRateUsed: 8, dieselPriceUsed: 30 })
    expect(trip.stops).toBe(planStops) // ชุดเดียวกับที่คิด
  })

  it.each([{ continuous: false }, { continuous: true }, { borrow: true }])('คิดไม่ได้ = ยังไม่สร้าง บอกให้กดใหม่ %j', async options => {
    const ui = createUi({ ...options, plan: 'failed' })
    await ui.handler(ui.borrowChoice)
    expect(ui.create).not.toHaveBeenCalled()
    expect(ui.command).not.toHaveBeenCalled()
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'ยังไม่ได้สร้างเที่ยววิ่ง', variant: 'destructive' })
  })

  it.each([{ continuous: false }, { continuous: true }, { borrow: true }])('เปลี่ยนการเลือกระหว่างรอคิดระยะ = ไม่เขียนชุดเก่า %j', async options => {
    const ui = createUi({ ...options, changeDuringPlan: true })
    await ui.handler(ui.borrowChoice)
    expect(ui.create).not.toHaveBeenCalled()
    expect(ui.command).not.toHaveBeenCalled()
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'ยังไม่ได้สร้างเที่ยววิ่ง', variant: 'destructive' })
  })

  it('ทริปปกติคิดระยะก่อนนับเลขทริปของวัน (ช่วงรอ Google ไม่คั่นระหว่างนับเลขกับบันทึก)', async () => {
    const ui = createUi()
    await ui.handler()
    expect(ui.computePlan.mock.invocationCallOrder[0]).toBeLessThan(ui.getDocs.mock.invocationCallOrder[0])
    expect(ui.create).toHaveBeenCalledTimes(1)
  })

  it('ทุกงานไม่มีพิกัด = สร้างได้ กม. 0 · ไม่มีอัตรารถ = ใช้ค่าเริ่มต้น 10', async () => {
    const ui = createUi({ plan: 'no-coords' })
    await ui.handler()
    expect(ui.create.mock.calls[0][2]).toMatchObject({ totalDistanceKm: 0, totalEstimatedTimeMinutes: 0, fuelCost: 0, fuelRateUsed: 10 })
  })
})

describe('actual request selection and create handlers', () => {
  it('เลือกจุดแล้วเก็บ fingerprint ของแถวที่คลิกไว้', () => {
    const captured = new Map<string, string>()
    const setSelectedIds = vi.fn()
    const toggle = actual('handleToggleSelect', { React: { useCallback: (fn: unknown) => fn }, mode: 'auto', availableDestinations: [selected], manualOrder: [], selectedIds: new Set(), selectionFingerprintsRef: { current: captured }, setSelectedIds, isTransferStop, orderPickupsBeforeDrop, toast: vi.fn() })
    toggle(selected.id)
    expect(captured.get(selected.id)).toBe(selected.sourceFingerprint)
    expect(setSelectedIds.mock.calls[0][0](new Set())).toEqual(new Set([selected.id]))
  })

  it.each(['auto', 'manual'])('โหมด %s ไม่เปลี่ยน index ที่เลือกไว้ไปเป็นอีกงานเมื่อ snapshot ใหม่มา', mode => {
    const changed = { ...selected, siteName: 'งานใหม่', sourceFingerprint: 'changed' }
    const result = actual('selectedDestinations', {
      React: { useMemo: (fn: () => unknown) => fn() }, mode, manualOrder: ['R1-0'], currentOrderedIds: ['R1-0'], selectedIds: new Set(['R1-0']),
      availableDestinations: [changed], selectionFingerprintsRef: { current: new Map([['R1-0', selected.sourceFingerprint]]) }, orderPickupsBeforeDrop,
    })
    expect(result).toEqual([])
  })

  it.each([{ continuous: false }, { continuous: true }, { borrow: true }])('ส่ง fingerprint ต้นฉบับสำหรับการสร้าง %j', async options => {
    const ui = createUi(options)
    await ui.handler(ui.borrowChoice)
    const assignments = options.continuous || options.borrow ? ui.command.mock.calls[0][1].assignments : ui.create.mock.calls[0][3].assignments
    expect(assignments).toEqual([{ requestId: 'R1', destinationIndexes: [0], expectedDestinationFingerprints: [selected.sourceFingerprint] }])
  })

  it.each([{ continuous: false }, { continuous: true }, { borrow: true }])('รายละเอียดเปลี่ยนระหว่างอ่านแล้วไม่สร้างงาน %j', async options => {
    const ui = createUi({ ...options, changed: true })
    await ui.handler(ui.borrowChoice)
    expect(ui.create).not.toHaveBeenCalled()
    expect(ui.command).not.toHaveBeenCalled()
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'destructive' })
  })
})

function selectionEffect(changed: boolean) {
  let call: ts.CallExpression | undefined
  const find = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'React.useEffect' && node.arguments[0]?.getText(source).includes('const invalid =')) call = node
    ts.forEachChild(node, find)
  }
  find(source)
  if (!call) throw new Error('Actual source selection invalidation effect missing')
  const setSelectedIds = vi.fn(), setManualOrder = vi.fn(), setOptimizedOrder = vi.fn(), setIsConfirmOpen = vi.fn(), setBorrowOpen = vi.fn(), toast = vi.fn()
  const current = new Map([[selected.id, selected.sourceFingerprint], ['R2-0', 'other']])
  const deps = {
    React: { useEffect: (fn: () => void) => fn() }, selectedIds: new Set([selected.id, 'R2-0']), manualOrder: [selected.id, 'R2-0'],
    availableDestinations: [{ ...selected, sourceFingerprint: changed ? 'changed' : selected.sourceFingerprint, dispatcherNote: 'หมายเหตุล่าสุด' }, { id: 'R2-0', sourceFingerprint: 'other' }],
    selectionFingerprintsRef: { current }, setSelectedIds, setManualOrder, setOptimizedOrder, setIsConfirmOpen, setBorrowOpen, toast,
  }
  const compiled = ts.transpileModule(call.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  new Function(...Object.keys(deps), compiled)(...Object.values(deps))
  return { current, setSelectedIds, setManualOrder, setOptimizedOrder, setIsConfirmOpen, setBorrowOpen, toast }
}

it('snapshot เปลี่ยนงานแล้วถอนการเลือกและปิดการยืนยันที่ค้างอยู่', () => {
  const ui = selectionEffect(true)
  expect(ui.current.has(selected.id)).toBe(false)
  expect(ui.setSelectedIds.mock.calls[0][0](new Set([selected.id, 'R2-0']))).toEqual(new Set(['R2-0']))
  expect(ui.setManualOrder.mock.calls[0][0]([selected.id, 'R2-0'])).toEqual(['R2-0'])
  expect(ui.setOptimizedOrder.mock.calls[0][0]([selected.id, 'R2-0'])).toEqual(['R2-0'])
  expect(ui.setIsConfirmOpen).toHaveBeenCalledWith(false)
  expect(ui.setBorrowOpen).toHaveBeenCalledWith(false)
})

it('snapshot เปลี่ยนเฉพาะหมายเหตุของคนจัดรถแล้วยังคงการเลือกและ dialog', () => {
  const ui = selectionEffect(false)
  expect(ui.current.get(selected.id)).toBe(selected.sourceFingerprint)
  expect(ui.setSelectedIds).not.toHaveBeenCalled()
  expect(ui.setIsConfirmOpen).not.toHaveBeenCalled()
  expect(ui.toast).not.toHaveBeenCalled()
})

function duplicateUi(remove: boolean, changed = false) {
  const request = { ...original, destinations: [
    { siteName: 'ต้นฉบับ A' },
    { siteName: 'คันคู่ A', pairedCopy: true, pairedFromIndex: 0 },
    { siteName: 'ต้นฉบับ B' },
    { siteName: 'คันคู่ B', pairedCopy: true, pairedFromIndex: 2 },
  ], stopNotes: { stop_0: 'A', stop_1: 'คู่ A', stop_2: 'B', stop_3: 'คู่ B' }, stopNoteAuthors: { stop_0: 'คน A', stop_1: 'คนคู่ A', stop_2: 'คน B', stop_3: 'คนคู่ B' } }
  const index = remove ? 1 : 0
  const dest = { ...request.destinations[index], id: `R1-${index}`, vrDocId: 'R1', destIndex: index, sourceFingerprint: requestDestinationFingerprint(request, index) }
  const fresh = changed ? { ...request, destinations: request.destinations.map((d, i) => i === index ? { ...d, siteName: 'งานถูกแก้แล้ว' } : d) } : request
  const update = vi.fn(), toast = vi.fn(), setSelectedIds = vi.fn(), setManualOrder = vi.fn(), setOptimizedOrder = vi.fn()
  const deps = {
    requests: [{ ...request, id: 'R1' }], window: { confirm: () => true }, doc: vi.fn(), db: {},
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) => fn({ get: async () => ({ data: () => fresh }), update }),
    serverTimestamp: () => 'time', toast, console: { error: vi.fn() }, setSelectedIds, setManualOrder, setOptimizedOrder,
    selectionFingerprintsRef: { current: new Map([['R1-2', 'B'], ['R2-0', 'other']]) },
    assertRequestDestinationsUnchanged, requestDestinationFingerprint, isTransferStop, transferShapeProblem, dispatchedDestinationIndexes,
  }
  return { handler: actual(remove ? 'removeDuplicate' : 'duplicateDestination', deps), dest, update, toast, setSelectedIds, setManualOrder, setOptimizedOrder }
}

describe('actual paired destination handlers', () => {
  it.each([false, true])('งานต้นฉบับเปลี่ยนแล้วห้ามเพิ่มหรือถอนคันคู่ remove=%s', async remove => {
    const ui = duplicateUi(remove, true)
    await ui.handler(ui.dest)
    expect(ui.update).not.toHaveBeenCalled()
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'destructive' })
  })

  it('ถอนคันคู่กลาง array แล้วเลื่อนหมายเหตุ ผู้เขียน และลิงก์คันคู่ตามจุดเดิม', async () => {
    const ui = duplicateUi(true)
    await ui.handler(ui.dest)
    const patch = ui.update.mock.calls[0][1]
    expect(patch.destinations).toEqual([{ siteName: 'ต้นฉบับ A' }, { siteName: 'ต้นฉบับ B' }, { siteName: 'คันคู่ B', pairedCopy: true, pairedFromIndex: 1 }])
    expect(patch.stopNotes).toEqual({ stop_0: 'A', stop_1: 'B', stop_2: 'คู่ B' })
    expect(patch.stopNoteAuthors).toEqual({ stop_0: 'คน A', stop_1: 'คน B', stop_2: 'คนคู่ B' })
    expect(ui.setSelectedIds.mock.calls[0][0](new Set(['R1-0', 'R1-2', 'R2-0']))).toEqual(new Set(['R2-0']))
    expect(ui.setManualOrder.mock.calls[0][0](['R1-2', 'R2-0'])).toEqual(['R2-0'])
    expect(ui.setOptimizedOrder.mock.calls[0][0](['R1-2', 'R2-0'])).toEqual(['R2-0'])
  })
})

describe('งานรับของไปส่งต่อ: handler ตัวจริงของหน้าจัดกลุ่ม', () => {
  const base = { vrDocId: 'T1', vrId: 'VR-T', requestDate: '2026-10-07', transferId: 'tf_1' }
  const P1 = { ...base, id: 'T1-0', destIndex: 0, transferRole: 'pickup', siteName: 'ดูโฮม', sourceFingerprint: 'fp0' }
  const P2 = { ...base, id: 'T1-1', destIndex: 1, transferRole: 'pickup', siteName: 'วานิช', sourceFingerprint: 'fp1' }
  const D = { ...base, id: 'T1-2', destIndex: 2, transferRole: 'drop', siteName: 'ดอนเมือง', sourceFingerprint: 'fp2' }
  const other = { id: 'R9-0', vrDocId: 'R9', destIndex: 0, siteName: 'งานอื่น', sourceFingerprint: 'fp9', requestDate: '2026-10-07' }
  const toggleUi = (mode: 'auto' | 'manual', manualOrder: string[] = [], selectedIds = new Set<string>()) => {
    const captured = new Map<string, string>(), setSelectedIds = vi.fn(), setManualOrder = vi.fn(), toast = vi.fn()
    const toggle = actual('handleToggleSelect', {
      React: { useCallback: (fn: unknown) => fn }, mode, availableDestinations: [P1, P2, D, other], manualOrder, selectedIds,
      selectionFingerprintsRef: { current: captured }, setSelectedIds, setManualOrder, isTransferStop, orderPickupsBeforeDrop, toast,
    })
    return { toggle, captured, setSelectedIds, setManualOrder, toast }
  }

  it('โหมดอัตโนมัติ: กดจุดส่ง → เลือกทั้งกลุ่ม และเก็บ fingerprint ครบทุกจุด + บอกคนจัดรถว่าเลือกทั้งชุด', () => {
    const ui = toggleUi('auto')
    ui.toggle(D.id)
    expect(ui.setSelectedIds.mock.calls[0][0](new Set())).toEqual(new Set([P1.id, P2.id, D.id]))
    expect([...ui.captured.keys()].sort()).toEqual([P1.id, P2.id, D.id].sort())
    expect(ui.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '📦 เลือกทั้งชุด 3 จุด' }))
  })

  it('ถอดออกทีละจุดได้ (ตั้งใจแยกคัน) · ไม่ขึ้นข้อความเลือกทั้งชุด', () => {
    const ui = toggleUi('auto', [], new Set([P1.id, P2.id, D.id]))
    ui.toggle(P2.id)
    expect(ui.setSelectedIds.mock.calls[0][0](new Set([P1.id, P2.id, D.id]))).toEqual(new Set([P1.id, D.id]))
    expect(ui.toast).not.toHaveBeenCalled()
  })

  it('เลือกงานปกติ / เติมจุดเดียวกลับเข้ากลุ่ม → ไม่ขึ้นข้อความเลือกทั้งชุด', () => {
    const ui = toggleUi('auto', [], new Set([P1.id, D.id]))
    ui.toggle(P2.id)
    ui.toggle(other.id)
    expect(ui.toast).not.toHaveBeenCalled()
  })

  it('โหมดจัดเอง: กดจุดส่งก่อน → ต่อท้ายงานเดิมเป็น รับ, รับ, ส่ง', () => {
    const ui = toggleUi('manual', [other.id])
    ui.toggle(D.id)
    expect(ui.setManualOrder.mock.calls[0][0]([other.id])).toEqual([other.id, P1.id, P2.id, D.id])
  })

  it('โหมดจัดเอง: เพิ่มจุดรับที่ถอดไว้กลับมา → จุดส่งเลื่อนไปหลังจุดรับ', () => {
    const ui = toggleUi('manual', [P1.id, D.id, other.id])
    ui.toggle(P2.id)
    expect(ui.setManualOrder.mock.calls[0][0]([P1.id, D.id, other.id])).toEqual([P1.id, other.id, P2.id, D.id])
  })

  it('ลำดับที่จะบันทึก: Google จัดจุดส่งไว้ก่อน → บันทึกเป็นรับก่อนส่ง', () => {
    const result = actual('selectedDestinations', {
      React: { useMemo: (fn: () => unknown) => fn() }, mode: 'auto', manualOrder: [], currentOrderedIds: [D.id, other.id, P1.id],
      selectedIds: new Set([D.id, other.id, P1.id]), availableDestinations: [P1, P2, D, other],
      selectionFingerprintsRef: { current: new Map([[P1.id, 'fp0'], [D.id, 'fp2'], [other.id, 'fp9']]) }, orderPickupsBeforeDrop,
    })
    expect(result.map((d: any) => d.id)).toEqual([other.id, P1.id, D.id])
  })

  const transferRequest = { ...original, destinations: [{ ...original.destinations[0], siteName: 'ดูโฮม', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง' }] } as unknown as typeof original
  it.each([{ continuous: false }, { borrow: true }])('สร้างเที่ยว: จุดในทริปพกบทบาท/รหัสกลุ่ม/ชื่อจุดส่ง %j', async options => {
    const ui = createUi({ ...options, request: transferRequest })
    await ui.handler(ui.borrowChoice)
    const trip = options.borrow ? ui.command.mock.calls[0][1].trip : ui.create.mock.calls[0][2]
    expect(trip.stops[0]).toMatchObject({ transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง' })
  })

  it('ใบปกติ: จุดในทริปไม่มีฟิลด์งานรับ-ส่ง (ไม่เขียน undefined)', async () => {
    const ui = createUi()
    await ui.handler(undefined)
    const stop = ui.create.mock.calls[0][2].stops[0]
    expect(Object.keys(stop).filter(k => k.startsWith('transfer'))).toEqual([])
  })

  // ใบรับ 2 ร้าน ส่งดอนเมือง + งานปกติอีกจุดในใบเดียวกัน (ไม่ควรถูกคัดลอกไปด้วย)
  const setRequest = { ...original, destinations: [
    { siteName: 'ดูโฮม', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง', jobDescription: 'ไม้อัด' },
    { siteName: 'วานิช', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง', jobDescription: 'ยางมะตอย' },
    { siteName: 'ดอนเมือง', transferRole: 'drop', transferId: 'tf_1', jobDescription: 'ส่งของที่รับจาก ดูโฮม: ไม้อัด' },
  ] }
  const dupSetUi = (request: any, index: number, extra: Record<string, unknown> = {}) => {
    const update = vi.fn(), toast = vi.fn(), setSelectedIds = vi.fn(), setManualOrder = vi.fn(), setOptimizedOrder = vi.fn()
    const deps = {
      requests: [{ ...request, id: 'R1' }], window: { confirm: () => true }, doc: vi.fn(), db: {}, serverTimestamp: () => 'time', toast, console: { error: vi.fn() },
      runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) => fn({ get: async () => ({ data: () => request }), update }),
      assertRequestDestinationsUnchanged, requestDestinationFingerprint, isTransferStop, transferShapeProblem, dispatchedDestinationIndexes,
      crypto: { randomUUID: () => 'copy' }, setSelectedIds, setManualOrder, setOptimizedOrder, selectionFingerprintsRef: { current: new Map() }, ...extra,
    }
    const dest = { ...request.destinations[index], id: `R1-${index}`, vrDocId: 'R1', vrId: 'VR-T', destIndex: index, sourceFingerprint: requestDestinationFingerprint(request, index) }
    return { deps, dest, update, toast }
  }

  it('เพิ่มคันคู่ทั้งชุด: กดการ์ดไหนก็ได้ → สำเนาจุดรับทุกจุด + จุดส่ง รหัสกลุ่มใหม่ ต่อท้ายใบ', async () => {
    const ui = dupSetUi(setRequest, 2)
    await actual('duplicateDestination', ui.deps)(ui.dest)
    const patch = ui.update.mock.calls[0][1]
    expect(patch.destinations).toHaveLength(6)
    expect(patch.destinations.slice(3)).toEqual([
      { ...setRequest.destinations[0], transferId: 'tf_copy', pairedCopy: true, pairedFromIndex: 0 },
      { ...setRequest.destinations[1], transferId: 'tf_copy', pairedCopy: true, pairedFromIndex: 1 },
      { ...setRequest.destinations[2], transferId: 'tf_copy', pairedCopy: true, pairedFromIndex: 2 },
    ])
    expect(transferShapeProblem(patch.destinations.slice(3).map((d: any) => d.transferRole))).toBeNull()
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'เพิ่มคันคู่ทั้งชุดแล้ว 🚛🚛' })
  })

  it('ถอนคันคู่ทั้งชุด: กดสำเนาจุดเดียว → ถอนสำเนาทั้งชุด ต้นฉบับอยู่ครบ · หมายเหตุของสำเนาหายตาม', async () => {
    const copies = setRequest.destinations.map((d, i) => ({ ...d, transferId: 'tf_copy', pairedCopy: true, pairedFromIndex: i }))
    const request = { ...setRequest, destinations: [...setRequest.destinations, ...copies], stopNotes: { stop_0: 'ต้น', stop_4: 'สำเนา' } }
    const ui = dupSetUi(request, 4)
    await actual('removeDuplicate', ui.deps)(ui.dest)
    const patch = ui.update.mock.calls[0][1]
    expect(patch.destinations).toEqual(setRequest.destinations)
    expect(patch.stopNotes).toEqual({ stop_0: 'ต้น' })
  })

  it('ถอนสำเนาชุดที่ยังไม่ได้ใช้ แล้วจุดที่เหลือจัดครบ → ใบปิดเป็น "จัดแล้ว" (ไม่ค้าง "จัดบางส่วน" — ผลตรวจซ้ำรอบ 2)', async () => {
    const copies = setRequest.destinations.map((d, i) => ({ ...d, transferId: 'tf_copy', pairedCopy: true, pairedFromIndex: i }))
    const request = { ...setRequest, destinations: [...setRequest.destinations, ...copies], assignedDestinations: [0, 1, 2], status: 'partial', tripIds: ['T1'] }
    const ui = dupSetUi(request, 3)
    await actual('removeDuplicate', ui.deps)(ui.dest)
    const patch = ui.update.mock.calls[0][1]
    expect(patch.destinations).toEqual(setRequest.destinations) // ลบจริง (ปลอดภัย: จุดที่จัดแล้วอยู่ก่อนทั้งหมด)
    expect(patch).toMatchObject({ status: 'approved', tripId: 'T1' })
    const still = dupSetUi({ ...request, assignedDestinations: [0, 1] }, 3)
    await actual('removeDuplicate', still.deps)(still.dest)
    expect(still.update.mock.calls[0][1].status).toBeUndefined() // ต้นฉบับยังค้าง → ใบยังไม่ปิด
  })

  it('สำเนาบางจุดของชุดจัดไปแล้ว (ผลตรวจรอบ 2) → ไม่ลบ (index เลื่อน) แต่ "ปิด" จุดที่ค้าง ใบขอไม่ค้าง partial ตลอดไป', async () => {
    // ต้นฉบับ 0-2 จัดคันที่ 1 แล้ว · สำเนา: P3 + D5 จัดคันที่ 2 แล้ว ถอด P4 ออกตอนจัด → P4 ค้างในกอง
    const copies = setRequest.destinations.map((d, i) => ({ ...d, transferId: 'tf_copy', pairedCopy: true, pairedFromIndex: i }))
    const request = { ...setRequest, destinations: [...setRequest.destinations, ...copies], assignedDestinations: [0, 1, 2, 3, 5], status: 'partial', tripIds: ['T1', 'T2'] }
    const confirm = vi.fn((_message: string) => true)
    const ui = dupSetUi(request, 4, { window: { confirm } })
    await actual('removeDuplicate', ui.deps)(ui.dest)
    expect(confirm.mock.calls[0][0]).toContain('ถอนเฉพาะจุดที่ยังค้างในกอง')
    const patch = ui.update.mock.calls[0][1]
    expect(patch.destinations).toHaveLength(6) // ไม่ลบ — index ของจุดที่จัดแล้วไม่เลื่อน
    expect(patch.destinations[4]).toMatchObject({ withdrawn: true, pairedCopy: true })
    expect(patch.destinations.filter((d: any) => d.withdrawn)).toHaveLength(1)
    expect(patch.assignedDestinations).toEqual([0, 1, 2, 3, 5, 4])
    expect(patch).toMatchObject({ status: 'approved', tripId: 'T1' })
    expect(ui.toast.mock.calls.at(-1)?.[0].description).toContain('ถอนสำเนาที่ยังค้าง 1 จุด')
    expect(ui.toast.mock.calls.at(-1)?.[0].description).toContain('ยังอยู่ในเที่ยวเดิม')
    // สำเนาที่เคยจัดถูกคืนคิวไปแล้ว เหลือแต่ตัวที่ถอน → ข้อความไม่อ้างว่ายังมีจุดในเที่ยว (ผลตรวจรอบสุดท้าย)
    const returned = { ...request, destinations: request.destinations.map((d: any, i: number) => i === 4 ? { ...d, withdrawn: true } : d), assignedDestinations: [0, 1, 2, 4] }
    const confirm2 = vi.fn((_message: string) => true)
    const again = dupSetUi(returned, 3, { window: { confirm: confirm2 } })
    await actual('removeDuplicate', again.deps)(again.dest)
    expect(confirm2.mock.calls[0][0]).not.toContain('จัดเข้าเที่ยวไปแล้วบางจุด')
    expect(again.update.mock.calls[0][1].assignedDestinations).toEqual([0, 1, 2, 4, 3, 5])
    expect(again.toast.mock.calls.at(-1)?.[0].description).not.toContain('ยังอยู่ในเที่ยวเดิม')
  })

  it('เหลือสำเนาค้างจุดเดียว → ปิดจุดนั้น · สำเนาจัดครบแล้ว → ถอนไม่ได้ (ไม่แตะใบ)', async () => {
    const copies = setRequest.destinations.map((d, i) => ({ ...d, transferId: 'tf_copy', pairedCopy: true, pairedFromIndex: i }))
    const request = { ...setRequest, destinations: [...setRequest.destinations, ...copies], assignedDestinations: [3, 4] }
    const ui = dupSetUi(request, 5)
    await actual('removeDuplicate', ui.deps)(ui.dest)
    expect(ui.update).toHaveBeenCalledTimes(1) // ปิด D5 ที่ค้าง (P3, P4 จัดแล้ว)
    expect(ui.update.mock.calls[0][1].assignedDestinations).toEqual([3, 4, 5])
    expect(ui.update.mock.calls[0][1].status).toBeUndefined() // ต้นฉบับ 0-2 ยังค้าง → ใบยังไม่ปิด
    const all = dupSetUi({ ...request, assignedDestinations: [3, 4, 5] }, 5)
    await actual('removeDuplicate', all.deps)(all.dest)
    expect(all.update).not.toHaveBeenCalled()
    expect(all.toast.mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'destructive', description: 'สำเนาชุดนี้ถูกจัดเข้าทริปครบแล้ว' })
  })
})
