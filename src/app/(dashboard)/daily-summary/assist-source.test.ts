import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { transferLabel, transferMateReminder, TRANSFER_WARNING } from '@/lib/transfer'
import { jobSetFields } from '@/lib/sequence'
import { incomingStopsForTrip } from '@/lib/calculations'
import { isSequenceStop, jobSetKindName, jobSetLabel, jobSetMateReminder, jobSetNoteForDriver, jobSetPostponeNote, jobSetTagStyle, sequenceLabel } from '@/lib/sequence'

const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function body(name: string) {
  let value: ts.Expression | undefined
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!value) throw new Error(`Actual ${name} missing`)
  return ts.transpileModule(`const work = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}
type Dist = Record<string, number> | null
function arrange(options: { newTarget?: boolean; save?: boolean; targetDate?: string; leave?: boolean; dist?: Dist; stop?: Record<string, unknown> } = {}) {
  const original = { id: 'T1', tripDate: '2026-10-07', vehicleId: 'V1', vehiclePlate: 'รถเดิม', driverId: 'D1', driverName: 'คนเดิม', status: 'Planned', stops: [{ siteId: 'S1', siteName: 'งานที่เปิดไว้', cargoDetails: 'ส่งอุปกรณ์', order: 1, ...options.stop }] }
  const current = { ...original, vehiclePlate: 'รถเปลี่ยนแล้ว', driverName: 'คนเปลี่ยนแล้ว', stops: [{ ...original.stops[0], siteName: 'งานใหม่ที่สลับมา' }] }
  const target = { id: 'T2', tripDate: options.targetDate || original.tripDate, vehicleId: 'V2', vehiclePlate: 'รถช่วย', driverId: 'D2', driverName: 'คนช่วย', status: 'Planned', stops: [{ siteName: 'งานเดิมของคันช่วย', order: 1 }] }
  const applyStops = vi.fn().mockResolvedValue(options.save !== false)
  const create = options.save === false ? vi.fn().mockRejectedValue(new Error('ต้นทางเปลี่ยนแล้ว')) : vi.fn().mockResolvedValue(undefined)
  const setTrips = vi.fn(), setDialog = vi.fn(), setForm = vi.fn(), toast = vi.fn(), statsRefresh = vi.fn()
  const planDistanceFields = vi.fn(async (..._args: unknown[]) => options.dist === undefined ? { totalDistanceKm: 88, totalEstimatedTimeMinutes: 75, fuelCost: 440 } : options.dist)
  const dialog = { tripId: original.id, stopIdx: 0, expectedTrip: original }
  const deps = { assistDialog: dialog, trips: [current, target], setAssistDialog: setDialog, allowOrdinaryEdit: () => true, recordedBy: 'ผู้จัด', assistForm: { targetTripId: options.newTarget ? '__new__' : target.id, driverId: 'D2', vehicleId: 'V2' }, toast, passLeaveGate: vi.fn().mockResolvedValue(options.leave !== false), applyStopsWithDistance: applyStops, planDistanceFields, setStatsRefreshKey: statsRefresh, companySettings: { dieselPrice: 30 }, driversData: [{ id: 'D2', name: 'คนช่วย' }], vehiclesData: [{ id: 'V2', licensePlate: 'รถช่วย', fuelRate: 7 }], createTripWithQueueGuard: create, db: {}, serverTimestamp: () => 'time', setTrips, setAssistForm: setForm, jobSetFields }
  const handler = new Function(...Object.keys(deps), `${body('addAssistStop')}return work`)(...Object.values(deps))
  return { handler, original, target, applyStops, planDistanceFields, statsRefresh, create, setTrips, setDialog, setForm, toast, passLeaveGate: deps.passLeaveGate }
}

it('คันช่วยใช้ข้อมูลงานตอนเปิด dialog และส่งต้นทางที่คาดหวังให้ transaction', async () => {
  const ui = arrange()
  await ui.handler()
  expect(ui.applyStops.mock.calls[0][1][1]).toMatchObject({ siteName: 'งานที่เปิดไว้', assistForPlate: 'รถเดิม', assistForDriver: 'คนเดิม' })
  expect(ui.applyStops.mock.calls[0][3]).toEqual({ expectedStops: ui.target.stops, sourceIndexes: [0, null], assistSource: { tripId: 'T1', stopIndex: 0, expectedTrip: ui.original } })
  expect(ui.setDialog).toHaveBeenCalledWith(null)
})

it('คันช่วยต้นทาง conflict เก็บ dialog โดยไม่แจ้งสำเร็จ', async () => {
  const ui = arrange({ save: false })
  await ui.handler()
  expect(ui.applyStops).toHaveBeenCalledOnce()
  expect(ui.setDialog).not.toHaveBeenCalled()
  expect(ui.setForm).not.toHaveBeenCalled()
  expect(ui.toast).not.toHaveBeenCalled()
})

it('คันช่วยปฏิเสธทริปคนละวันก่อนด่านวันลาและบันทึก', async () => {
  const ui = arrange({ targetDate: '2026-10-08' })
  await ui.handler()
  expect(ui.passLeaveGate).not.toHaveBeenCalled()
  expect(ui.applyStops).not.toHaveBeenCalled()
  expect(ui.toast.mock.calls[0][0]).toMatchObject({ variant: 'destructive' })
  expect(ui.setDialog).not.toHaveBeenCalled()
})

it('สร้างทริปคันช่วยส่ง snapshot ต้นทางใน transaction และแสดงหมายเหตุที่บันทึกจริง', async () => {
  const ui = arrange({ newTarget: true })
  ui.create.mockImplementation(async (_db: unknown, id: string, data: any) => ({ ...data, stops: [{ ...data.stops[0], dispatcherNote: 'หมายเหตุใหม่จากฐานจริง', dispatcherName: 'ผู้จัดล่าสุด' }], id }))
  await ui.handler()
  expect(ui.create.mock.calls[0][4]).toEqual({ tripId: 'T1', stopIndex: 0, expectedTrip: ui.original })
  expect(ui.create.mock.calls[0][2].stops[0]).toMatchObject({ siteName: 'งานที่เปิดไว้', assistForPlate: 'รถเดิม', assistForDriver: 'คนเดิม' })
  expect(ui.setTrips.mock.calls[0][0]([])[0].stops[0]).toMatchObject({ dispatcherNote: 'หมายเหตุใหม่จากฐานจริง', dispatcherName: 'ผู้จัดล่าสุด' })
  expect(ui.setDialog).toHaveBeenCalledWith(null)
})

it('สร้างทริปคันช่วยต้นทาง conflict ไม่เพิ่มบนจอและเก็บตัวเลือกไว้', async () => {
  const ui = arrange({ newTarget: true, save: false })
  await ui.handler()
  expect(ui.create).toHaveBeenCalledOnce()
  expect(ui.setTrips).not.toHaveBeenCalled()
  expect(ui.setDialog).not.toHaveBeenCalled()
  expect(ui.setForm).not.toHaveBeenCalled()
  expect(ui.toast.mock.calls[0][0]).toMatchObject({ title: 'สร้างทริปไม่สำเร็จ', variant: 'destructive' })
})

it.each([false, true])('คันช่วยด่านวันลายกเลิกไม่มีการบันทึก newTarget=$0', async newTarget => {
  const ui = arrange({ newTarget, leave: false })
  await ui.handler()
  expect(ui.applyStops).not.toHaveBeenCalled()
  expect(ui.create).not.toHaveBeenCalled()
  expect(ui.setTrips).not.toHaveBeenCalled()
  expect(ui.setDialog).not.toHaveBeenCalled()
})

it('คันช่วยเข้าทริปที่มีอยู่: คิด กม.ของทริปคันช่วยรวมงานที่ไปช่วย แล้วเขียนพร้อมจุด (ผ่าน applyStopsWithDistance)', async () => {
  const ui = arrange()
  await ui.handler()
  const [target, stops, action] = ui.applyStops.mock.calls[0]
  expect(target).toBe(ui.target)
  expect(stops.map((s: any) => s.siteName)).toEqual(['งานเดิมของคันช่วย', 'งานที่เปิดไว้'])
  expect(action).toBe('เพิ่มคันช่วย')
})

it('สร้างทริปคันช่วยใหม่: คิด กม.ก่อนสร้าง + freeze อัตรารถคันช่วย/ราคาดีเซล/จุดออฟฟิศ', async () => {
  const ui = arrange({ newTarget: true })
  ui.create.mockImplementation(async (_db: unknown, _id: string, data: any) => data)
  await ui.handler()
  const [planTrip, planStops, action] = ui.planDistanceFields.mock.calls[0] as [any, any[], string]
  expect(planTrip).toMatchObject({ vehicleId: 'V2', fuelRateUsed: 7, dieselPriceUsed: 30, originLat: 14.0815, originLng: 100.7129 })
  expect(planStops[0]).toMatchObject({ siteName: 'งานที่เปิดไว้' })
  expect(action).toBe('เพิ่มคันช่วย')
  expect(ui.create.mock.calls[0][2]).toMatchObject({ fuelRateUsed: 7, totalDistanceKm: 88, totalEstimatedTimeMinutes: 75, fuelCost: 440 })
  expect(ui.setTrips.mock.calls[0][0]([])[0]).toMatchObject({ totalDistanceKm: 88 })
  expect(ui.statsRefresh).toHaveBeenCalledOnce()
  expect(ui.setDialog).toHaveBeenCalledWith(null)
})

it('สร้างทริปคันช่วยใหม่: คิดระยะไม่ได้ = ไม่สร้าง หน้าต่างค้างไว้', async () => {
  const ui = arrange({ newTarget: true, dist: null })
  await ui.handler()
  expect(ui.create).not.toHaveBeenCalled()
  expect(ui.setTrips).not.toHaveBeenCalled()
  expect(ui.setDialog).not.toHaveBeenCalled()
})

// งานรับของไปส่งต่อ: สำเนาคันช่วยติดรหัสกลุ่มเดิม ป้าย 📦/🏁 บนคันช่วยจึงจับคู่/เตือนได้เอง
it('คันช่วยของจุดรับ (ทริปที่มีอยู่): สำเนาติด transferRole/transferId เดิม + ชื่อจุดส่งที่จำไว้', async () => {
  const ui = arrange({ stop: { transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง' } })
  await ui.handler()
  expect(ui.applyStops.mock.calls[0][1][1]).toMatchObject({ siteName: 'งานที่เปิดไว้', assistForPlate: 'รถเดิม', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง' })
})

it('คันช่วยของจุดส่ง (สร้างทริปใหม่): สำเนามี role/id ของกลุ่ม แต่ไม่มี transferDropName', async () => {
  const ui = arrange({ newTarget: true, stop: { transferRole: 'drop', transferId: 'tf_1', transferDropName: 'ไม่ควรติดไป' } })
  await ui.handler()
  const copy = ui.create.mock.calls[0][2].stops[0]
  expect(copy).toMatchObject({ assistForPlate: 'รถเดิม', transferRole: 'drop', transferId: 'tf_1' })
  expect(copy).not.toHaveProperty('transferDropName')
})

it.each([false, true])('คันช่วยของงานปกติ: สำเนาไม่มี key transfer* และไม่มีค่า undefined (เหมือนเดิมทุกตัวอักษร) newTarget=%s', async newTarget => {
  const ui = arrange({ newTarget })
  await ui.handler()
  const copy = newTarget ? ui.create.mock.calls[0][2].stops[0] : ui.applyStops.mock.calls[0][1][1]
  expect(Object.keys(copy).filter(key => key.startsWith('transfer'))).toEqual([])
  expect(Object.values(copy).includes(undefined)).toBe(false)
})

// กล่องสีส้มในหน้าต่างคันช่วย — คอมไพล์ IIFE ตัวจริงจาก JSX (React.createElement ปลอม) + transferPeersOf/transferReminderFor ตัวจริง
function assistBox(dialog: unknown, trips: unknown[] = []) {
  let box: ts.ArrowFunction | undefined
  const find = (node: ts.Node) => {
    if (ts.isArrowFunction(node) && node.body.getText(source).includes('transferLabel(transferPeersOf(src), assistDialog.stopIdx)')) box = node
    ts.forEachChild(node, find)
  }
  find(source)
  if (!box) throw new Error('Actual assist transfer box missing')
  const code = ts.transpileModule(`const work = ${box.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  const React = { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) }
  const helpers = { trips, incomingStopsForTrip, transferMateReminder, jobSetMateReminder }
  const transferPeersOf = new Function(...Object.keys(helpers), `${body('transferPeersOf')}return work`)(...Object.values(helpers))
  const transferReminderFor = new Function(...Object.keys(helpers), 'transferPeersOf', `${body('transferReminderFor')}return work`)(...Object.values(helpers), transferPeersOf)
  const deps = { React, assistDialog: dialog, transferLabel, sequenceLabel, transferPeersOf, transferReminderFor, transferMateReminder, TRANSFER_WARNING }
  const out = new Function(...Object.keys(deps), `${code}return work()`)(...Object.values(deps))
  const text = (node: any): string => node == null || node === false ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node.children)
  // บรรทัดละ <p> — บรรทัดแรก = ป้ายของคันต้นทาง
  return out === null ? null : (out.children as unknown[]).map(text).filter(Boolean).join('\n')
}
const transferTrip = (stops: Record<string, unknown>[]) => ({ id: 'T1', tripDate: '2026-10-07', vehiclePlate: 'รถเดิม', driverName: 'คนเดิม', status: 'Planned', stops })
const shopA = { siteName: 'ร้าน A', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ไซต์ Y' }
const siteY = { siteName: 'ไซต์ Y', transferRole: 'drop', transferId: 'tf_1' }

it('กล่องรับ-ส่งในหน้าต่างคันช่วย: ปิดหน้าต่าง/งานปกติ = ไม่แสดงอะไร', () => {
  expect(assistBox(null)).toBeNull()
  expect(assistBox({ tripId: 'T1', stopIdx: 0, expectedTrip: transferTrip([{ siteName: 'งานปกติ' }]) })).toBeNull()
})

it('กล่องรับ-ส่ง: จุดรับที่จุดส่งอยู่ในเที่ยวเดียวกัน → บอกให้กดคันช่วยที่จุดส่งต่อ', () => {
  const box = assistBox({ tripId: 'T1', stopIdx: 0, expectedTrip: transferTrip([shopA, siteY]) })
  expect(box).toContain('📦 รับของ → ไปส่งต่อที่ ไซต์ Y')
  expect(box).toContain('คันช่วยจะได้เฉพาะจุดรับนี้')
  expect(box).toContain('ยังมีจุดส่ง ไซต์ Y ของงานเดียวกันอยู่ในเที่ยวนี้')
  expect(box).toContain('เลือกคันเดียวกันอีกครั้ง')
  expect(box).toContain('อย่าเลือก ➕ ซ้ำ ไม่งั้นจะได้ 2 ทริป')
  expect(box).not.toContain('งานที่โยกเข้ามา')
})

it('กล่องรับ-ส่ง: จุดส่ง → บอกให้กดจุดรับก่อน (ต่อท้ายตามลำดับที่กด)', () => {
  const box = assistBox({ tripId: 'T1', stopIdx: 1, expectedTrip: transferTrip([shopA, siteY]) })
  expect(box).toContain('🏁 ส่งของที่รับจาก ร้าน A')
  expect(box).toContain('คันช่วยจะได้เฉพาะจุดส่งนี้')
  expect(box).toContain('ยังมีจุดรับ ร้าน A ของงานเดียวกันอยู่ในเที่ยวนี้')
  expect(box).toContain('กด 🚛+ คันช่วย ที่จุดรับให้คันเดียวกันก่อน')
  expect(box).toContain('อย่าเลือก ➕ ซ้ำ ไม่งั้นจะได้ 2 ทริป')
})

it('กล่องรับ-ส่ง: จุดคู่ไม่อยู่ในเที่ยวต้นทาง → ไม่บอกให้กดซ้ำ และไม่แสดงคำเตือนของคันต้นทาง', () => {
  const box = assistBox({ tripId: 'T1', stopIdx: 0, expectedTrip: transferTrip([shopA]) })
  expect(box).toContain('📦 รับของ → ไปส่งต่อที่ ไซต์ Y')
  expect(box).toContain('คันช่วยจะได้เฉพาะจุดรับนี้')
  expect(box).not.toContain('ยังมีจุดส่ง')
  expect(box).not.toContain('อีกครั้ง')
  expect(box).not.toContain('อย่าเลือก ➕ ซ้ำ')
  // ป้ายของคันต้นทางแสดงแค่ข้อความ ไม่ต่อคำเตือนของคันต้นทาง
  expect(box!.split('\n')[0]).toBe('📦 รับของ → ไปส่งต่อที่ ไซต์ Y')
})

// คันช่วยได้จุดเดียว = ป้ายบนคันช่วยไม่มีจุดคู่ — กล่องต้องบอกผลจริงบนคันช่วย ไม่ใช่บอกว่าป้ายติดไปเหมือนคันต้นทาง
it.each([
  [0, TRANSFER_WARNING.dropMissing],
  [1, TRANSFER_WARNING.pickupMissing],
])('กล่องรับ-ส่ง: บอกว่าคันช่วยไปจุดเดียวจะขึ้นคำเตือนอะไร + ให้เขียนหมายเหตุ stopIdx=%s', (stopIdx, warning) => {
  const box = assistBox({ tripId: 'T1', stopIdx, expectedTrip: transferTrip([shopA, siteY]) })
  expect(box).toContain(`ถ้าคันช่วยไปแค่จุดนี้ แถวของคันช่วยจะขึ้น ⚠️ ${warning}`)
  expect(box).toContain('ให้เขียน ✏️ หมายเหตุบอกคนขับคันช่วยว่าไปช่วยแค่จุดนี้')
  expect(box).not.toContain('มีป้ายรับ-ส่งติดไปด้วย')
})

// จุดคู่เป็นงานที่โยกเข้ามา: การ์ดนี้ไม่มีแถว/ปุ่มคันช่วยของจุดนั้น — ห้ามบอกให้ไปกดที่จุดนั้นในการ์ดนี้
const fromT0 = (stops: Record<string, unknown>[]) => ({ id: 'T0', tripDate: '2026-10-07', vehiclePlate: 'รถต้นทาง', driverName: 'คนต้นทาง', status: 'Planned', stops: stops.map(s => ({ ...s, outcome: 'reassigned', reassignedToTripId: 'T1' })) })

it('กล่องรับ-ส่ง: จุดรับของคันนี้ จุดส่งเป็นงานที่โยกเข้ามา → บอกให้กดที่การ์ดคันต้นทาง ไม่บอกให้กดในการ์ดนี้', () => {
  const t1 = transferTrip([shopA])
  const box = assistBox({ tripId: 'T1', stopIdx: 0, expectedTrip: t1 }, [fromT0([siteY]), t1])
  expect(box).toContain('ยังมีจุดส่ง ไซต์ Y ของงานเดียวกันอยู่ในเที่ยวนี้')
  expect(box).toContain('จุดนั้นเป็นงานที่โยกเข้ามา ไม่มีปุ่ม 🚛+ คันช่วยในการ์ดนี้')
  expect(box).toContain('ในการ์ดของคันต้นทางของงานนั้นต่อ (ป้าย 🤝 จะขึ้นทะเบียนคันนั้น)')
  expect(box).not.toContain('ที่จุดส่งนั้นต่อ')
  expect(box).toContain('อย่าเลือก ➕ ซ้ำ')
})

it('กล่องรับ-ส่ง: จุดส่งของคันนี้ จุดรับเป็นงานที่โยกเข้ามา → กดที่การ์ดคันต้นทางก่อน แล้วค่อยกดจุดส่งนี้', () => {
  const t1 = transferTrip([siteY])
  const box = assistBox({ tripId: 'T1', stopIdx: 0, expectedTrip: t1 }, [fromT0([shopA]), t1])
  expect(box).toContain('ยังมีจุดรับ ร้าน A ของงานเดียวกันอยู่ในเที่ยวนี้')
  expect(box).toContain('ในการ์ดของคันต้นทางของงานนั้นก่อน แล้วค่อยกดจุดส่งนี้')
  expect(box).not.toContain('ที่จุดรับให้คันเดียวกันก่อน')
})

it('กล่องรับ-ส่ง: จุดรับมีทั้งของคันนี้และงานที่โยกเข้ามา → แยกชื่อ กดในการ์ดนี้เฉพาะจุดของคันนี้', () => {
  const t1 = transferTrip([shopA, siteY])
  const shopB = { siteName: 'ร้าน B', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ไซต์ Y' }
  const box = assistBox({ tripId: 'T1', stopIdx: 1, expectedTrip: t1 }, [fromT0([shopB]), t1])!
  const lines = box.split('\n')
  expect(lines.find(l => l.includes('ที่จุดรับให้คันเดียวกันก่อน'))).toContain('ยังมีจุดรับ ร้าน A ของงานเดียวกัน')
  expect(lines.find(l => l.includes('งานที่โยกเข้ามา'))).toContain('ยังมีจุดรับ ร้าน B ของงานเดียวกัน')
})
