import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

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
function arrange(options: { newTarget?: boolean; save?: boolean; targetDate?: string; leave?: boolean; dist?: Dist } = {}) {
  const original = { id: 'T1', tripDate: '2026-10-07', vehicleId: 'V1', vehiclePlate: 'รถเดิม', driverId: 'D1', driverName: 'คนเดิม', status: 'Planned', stops: [{ siteId: 'S1', siteName: 'งานที่เปิดไว้', cargoDetails: 'ส่งอุปกรณ์', order: 1 }] }
  const current = { ...original, vehiclePlate: 'รถเปลี่ยนแล้ว', driverName: 'คนเปลี่ยนแล้ว', stops: [{ ...original.stops[0], siteName: 'งานใหม่ที่สลับมา' }] }
  const target = { id: 'T2', tripDate: options.targetDate || original.tripDate, vehicleId: 'V2', vehiclePlate: 'รถช่วย', driverId: 'D2', driverName: 'คนช่วย', status: 'Planned', stops: [{ siteName: 'งานเดิมของคันช่วย', order: 1 }] }
  const applyStops = vi.fn().mockResolvedValue(options.save !== false)
  const create = options.save === false ? vi.fn().mockRejectedValue(new Error('ต้นทางเปลี่ยนแล้ว')) : vi.fn().mockResolvedValue(undefined)
  const setTrips = vi.fn(), setDialog = vi.fn(), setForm = vi.fn(), toast = vi.fn(), statsRefresh = vi.fn()
  const planDistanceFields = vi.fn(async (..._args: unknown[]) => options.dist === undefined ? { totalDistanceKm: 88, totalEstimatedTimeMinutes: 75, fuelCost: 440 } : options.dist)
  const dialog = { tripId: original.id, stopIdx: 0, expectedTrip: original }
  const deps = { assistDialog: dialog, trips: [current, target], setAssistDialog: setDialog, allowOrdinaryEdit: () => true, recordedBy: 'ผู้จัด', assistForm: { targetTripId: options.newTarget ? '__new__' : target.id, driverId: 'D2', vehicleId: 'V2' }, toast, passLeaveGate: vi.fn().mockResolvedValue(options.leave !== false), applyStopsWithDistance: applyStops, planDistanceFields, setStatsRefreshKey: statsRefresh, companySettings: { dieselPrice: 30 }, driversData: [{ id: 'D2', name: 'คนช่วย' }], vehiclesData: [{ id: 'V2', licensePlate: 'รถช่วย', fuelRate: 7 }], createTripWithQueueGuard: create, db: {}, serverTimestamp: () => 'time', setTrips, setAssistForm: setForm }
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
