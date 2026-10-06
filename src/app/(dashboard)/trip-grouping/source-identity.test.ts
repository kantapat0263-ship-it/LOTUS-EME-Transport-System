import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { assertRequestDestinationsUnchanged, requestDestinationFingerprint } from '@/lib/requestDestination'

const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function actual(name: string, deps: Record<string, unknown>) {
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

function createUi(options: { continuous?: boolean; borrow?: boolean; changed?: boolean } = {}) {
  const fresh = options.changed ? { ...original, destinations: [{ ...original.destinations[0], siteName: 'อีกงานที่สลับมา' }] } : original
  const create = vi.fn().mockResolvedValue(undefined), command = vi.fn().mockResolvedValue({ tripIds: ['T1'] }), toast = vi.fn()
  const flight = { isCurrent: () => true, operationId: () => 'OP1', finish: vi.fn() }
  const deps = {
    user: { uid: 'U1' }, selectionSig: 'unchanged', selectionSigRef: { current: 'unchanged' }, pageVersionRef: { current: 0 },
    commandFlightRef: { current: { begin: () => flight } }, borrowOpenRef: { current: true }, confirmOpenRef: { current: true },
    setIsProcessing: vi.fn(), selectedDestinations: [selected], driverId: 'D1', vehicleId: 'V1',
    continuousEndDate: options.continuous ? '2026-10-09' : '', expandQueueDates: () => ['2026-10-07', '2026-10-08', '2026-10-09'],
    window: { confirm: () => true }, toast, confirmLeaveBeforeAssign: vi.fn().mockResolvedValue(true), checkLeave: vi.fn(), drivers: [{ id: 'D1', name: 'คนขับ' }],
    borrowOpen: true, getDoc: vi.fn().mockResolvedValue({ exists: () => true, data: () => fresh }), doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`, db: {},
    selectedVehicle: { licensePlate: 'รถทดสอบ', type: 'truck' }, settings: {}, runContinuousQueueCommand: command, continuousQueues: { refresh: vi.fn() }, queueDateLabel: (date: string) => date,
    resetAll: vi.fn(), getDocs: vi.fn().mockResolvedValue({ size: 0 }), query: vi.fn(), collection: vi.fn(), where: vi.fn(), createTripWithQueueGuard: create, serverTimestamp: () => 'time',
    assertRequestDestinationsUnchanged, requestDestinationFingerprint, console: { error: vi.fn() },
  }
  return { handler: actual('confirmCreateTrip', deps), create, command, toast, borrowChoice: options.borrow ? { bookingId: 'B1', reason: 'งานจำเป็น' } : undefined }
}

describe('actual request selection and create handlers', () => {
  it('เลือกจุดแล้วเก็บ fingerprint ของแถวที่คลิกไว้', () => {
    const captured = new Map<string, string>()
    const setSelectedIds = vi.fn()
    const toggle = actual('handleToggleSelect', { React: { useCallback: (fn: unknown) => fn }, mode: 'auto', availableDestinations: [selected], manualOrder: [], selectedIds: new Set(), selectionFingerprintsRef: { current: captured }, setSelectedIds })
    toggle(selected.id)
    expect(captured.get(selected.id)).toBe(selected.sourceFingerprint)
    expect(setSelectedIds.mock.calls[0][0](new Set())).toEqual(new Set([selected.id]))
  })

  it.each(['auto', 'manual'])('โหมด %s ไม่เปลี่ยน index ที่เลือกไว้ไปเป็นอีกงานเมื่อ snapshot ใหม่มา', mode => {
    const changed = { ...selected, siteName: 'งานใหม่', sourceFingerprint: 'changed' }
    const result = actual('selectedDestinations', {
      React: { useMemo: (fn: () => unknown) => fn() }, mode, manualOrder: ['R1-0'], currentOrderedIds: ['R1-0'], selectedIds: new Set(['R1-0']),
      availableDestinations: [changed], selectionFingerprintsRef: { current: new Map([['R1-0', selected.sourceFingerprint]]) },
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
    assertRequestDestinationsUnchanged, requestDestinationFingerprint,
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
