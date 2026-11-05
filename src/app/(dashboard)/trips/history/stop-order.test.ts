import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { inThailand } from '@/lib/roadFlood'
import { routeStopsKey } from '@/lib/planDistance'
import { calculateFuelCost } from '@/lib/calculations'
import { dropSyncNote, syncDropsInTripEdit } from '@/lib/transfer'

const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function handler(name: string) {
  let value: ts.Expression | undefined
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!value) throw new Error(`Actual handler ${name} missing`)
  return ts.transpileModule(`const work = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}
const trip = () => ({ id: 'T1', tripId: 'T1', tripDate: '2026-10-07', status: 'Planned', vehicleId: 'V1', driverId: 'D1', stops: [
  { siteId: 'A', siteName: 'A', order: 1, cargoDetails: 'A' }, { siteId: 'B', siteName: 'B', order: 2, cargoDetails: 'B' },
] })
function formEvent(fragment: string, form: any, index = 0, site: any = { id: 'NEW', name: 'ใหม่', latitude: 14.2, longitude: 100.7 }) {
  let event: ts.ArrowFunction | undefined
  function find(node: ts.Node) {
    if (ts.isArrowFunction(node) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) && node.getText(source).includes(fragment)) event = node
    ts.forEachChild(node, find)
  }
  find(source)
  if (!event) throw new Error(`Actual form event missing: ${fragment}`)
  let saved = form
  const code = ts.transpileModule(`const work = ${event.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  // pinned = ตัวแปรในรายการสถานที่ของหน้า (inThailand ของสถานที่นั้น)
  const work = new Function('editFormData', 'setEditFormData', 'idx', 'site', 'pinned', `${code}return work`)(form, (value: any) => { saved = value }, index, site, inThailand(site.latitude, site.longitude))
  work({ target: { value: 'รายละเอียดใหม่' } })
  return saved
}
it('ปุ่มเพิ่มแล้วลบแถวแรกเก็บ bindings ของแถวที่เหลือและจุดใหม่ตรงกัน', () => {
  const form = { stops: trip().stops, originalStopIndexes: [0, 1] }
  const added = formEvent('siteId: site.id', form)
  expect(added.originalStopIndexes).toEqual([0, 1, null])
  expect(added.stops[2].siteId).toBe('NEW')
  const removed = formEvent('editFormData.stops.filter', added)
  expect(removed.originalStopIndexes).toEqual([1, null])
  expect(removed.stops.map((s: any) => s.siteId)).toEqual(['B', 'NEW'])
})
it('เพิ่มจุดแวะคัดลอกพิกัดของสถานที่ที่เลือก · สถานที่ไม่มีพิกัด/พิกัดเสีย/นอกไทย = เลือกไม่ได้ (ไม่เพิ่มจุด)', () => {
  const form = { stops: trip().stops, originalStopIndexes: [0, 1] }
  const withCoords = formEvent('siteId: site.id', form, 0, { id: 'NEW', name: 'ใหม่', latitude: 14.2, longitude: 100.7 })
  expect(withCoords.stops[2]).toMatchObject({ siteId: 'NEW', lat: 14.2, lng: 100.7 })
  // ผู้ใช้กำหนด 2026-10-19: สถานที่ไม่มีพิกัด/(0,0)/นอกไทย เลือกไม่ได้ (เดิมเพิ่มได้แต่ไม่มีพิกัด)
  for (const bad of [{}, { latitude: 14.2 }, { latitude: '14.2', longitude: '100.7' }, { latitude: NaN, longitude: 100.7 }, { latitude: 0, longitude: 0 }, { latitude: 35.68, longitude: 139.69 }]) {
    const after = formEvent('siteId: site.id', form, 0, { id: 'NEW', name: 'ใหม่', ...bad })
    expect(after.stops).toHaveLength(2)
    expect(after.originalStopIndexes).toEqual([0, 1])
  }
})
it('แก้ cargo ไม่เปลี่ยน binding และไม่ mutate stops ของ render ก่อนหน้า', () => {
  const form = { stops: trip().stops, originalStopIndexes: [0, 1] }
  const edited = formEvent('cargoDetails: e.target.value', form, 1)
  expect(edited.originalStopIndexes).toEqual([0, 1])
  expect(edited.stops[1].cargoDetails).toBe('รายละเอียดใหม่')
  expect(form.stops[1].cargoDetails).toBe('B')
})
it('เปิด history editor เก็บ index ต้นฉบับและ clone stops ไม่ให้ฟอร์มแก้ snapshot', () => {
  const setForm = vi.fn()
  const work = new Function('isViewer', 'isManagedTrip', 'isAdmin', 'profile', 'toast', 'confirm', 'setEditingTrip', 'setEditFormData', 'setIsEditOpen', `${handler('handleOpenEdit')}return work`)(
    false, () => false, true, {}, vi.fn(), () => true, vi.fn(), setForm, vi.fn(),
  )
  const original = trip()
  work(original)
  const form = setForm.mock.calls[0][0]
  expect(form.originalStopIndexes).toEqual([0, 1])
  form.stops[0].cargoDetails = 'แก้'
  expect(original.stops[0].cargoDetails).toBe('A')
})
// รันฟังก์ชันบันทึกตัวจริงของหน้า history ด้วย dependency ปลอม (Firestore/Maps/toast)
function saveEdit(original: any, form: any, opts: { plan?: unknown; vehicles?: any[]; trips?: any[]; onPlan?: () => void } = {}) {
  const deps = {
    update: vi.fn().mockResolvedValue({}), log: vi.fn(), close: vi.fn(), toast: vi.fn(),
    plan: vi.fn(async (..._args: unknown[]) => { opts.onPlan?.(); return opts.plan ?? { km: 120, minutes: 90, fuelCost: 360 } }),
    version: { current: 1 },
  }
  const work = new Function('editingTrip', 'user', 'isManagedTrip', 'editFormData', 'toast', 'saveEditBusyRef', 'confirmLeaveBeforeAssign', 'checkLeave', 'drivers', 'vehicles', 'editVersionRef', 'editOpenRef', 'window', 'updateTripWithQueueGuard', 'db', 'serverTimestamp', 'collection', 'addDoc', 'setIsEditOpen', 'routeStopsKey', 'computeTripPlanDistance', 'companySettings', 'calculateFuelCost', 'trips', 'syncDropsInTripEdit', 'dropSyncNote', `${handler('handleSaveEdit')}return work`)(
    original, { email: 'test@example.invalid' }, () => false, form, deps.toast, { current: false }, vi.fn(), vi.fn(), [{ id: 'D1', name: 'คนขับ' }], opts.vehicles ?? [{ id: 'V1', licensePlate: 'ทะเบียน' }], deps.version, { current: true }, { confirm: () => true }, deps.update, {}, () => 'test-time', vi.fn(), deps.log, deps.close,
    routeStopsKey, deps.plan, { googleMapsApiKeyReference: 'key' }, calculateFuelCost, opts.trips, syncDropsInTripEdit, dropSyncNote,
  )
  return { work, ...deps }
}
it('บันทึก history ส่ง binding แยกจาก stops ที่ renumber แล้วโดยไม่เก็บ binding ในฐาน', async () => {
  const original = trip()
  const added = { siteId: 'A', siteName: 'A', order: 0, cargoDetails: 'เพิ่มใหม่' }
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [original.stops[1], added], originalStopIndexes: [1, null], note: 'ลบ A เพิ่มใหม่' }
  const { work, update, log, close } = saveEdit(original, form)
  await work()
  expect(update.mock.calls[0][4]).toEqual({ expectedStops: original.stops, sourceIndexes: [1, null] })
  expect(update.mock.calls[0][2].stops.map((s: any) => s.order)).toEqual([0, 1])
  expect(update.mock.calls[0][2].originalStopIndexes).toBeUndefined()
  expect(log).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledWith(false)
})
it('จุดส่งของเปลี่ยน = คิดระยะใหม่ก่อน แล้วบันทึก กม./เวลา/ค่าน้ำมันพร้อมจุดในครั้งเดียว + ลงประวัติการแก้', async () => {
  const original = { ...trip(), totalDistanceKm: 50 }
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [original.stops[1]], originalStopIndexes: [1], note: 'ลบ A' }
  const { work, update, log, plan } = saveEdit(original, form)
  await work()
  expect(plan).toHaveBeenCalledWith('key', original, form.stops, undefined)
  expect(update.mock.calls[0][2]).toMatchObject({ totalDistanceKm: 120, totalEstimatedTimeMinutes: 90, fuelCost: 360 })
  expect(log.mock.calls[0][1].changes.distance).toEqual({ from: 50, to: 120 })
})
it('คิดระยะใหม่ไม่ได้ = ไม่บันทึกอะไรเลย ให้ลองใหม่ (ผู้ใช้เลือก)', async () => {
  const original = trip()
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [original.stops[1]], originalStopIndexes: [1], note: 'ลบ A' }
  const { work, update, log, close, toast } = saveEdit(original, form, { plan: 'failed' })
  await work()
  expect(update).not.toHaveBeenCalled()
  expect(log).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(toast.mock.calls[0][0].title).toBe('ยังไม่ได้บันทึก')
})
it('จุดไม่เปลี่ยน (แก้รายละเอียด) = ไม่คิดระยะใหม่ · เปลี่ยนรถ = ค่าน้ำมันตามอัตรารถคันใหม่', async () => {
  const original = { ...trip(), totalDistanceKm: 100, fuelRateUsed: 10, dieselPriceUsed: 30 }
  const form = { driverId: 'D1', vehicleId: 'V2', stops: original.stops.map((s: any) => ({ ...s, cargoDetails: 'แก้' })), originalStopIndexes: [0, 1], note: 'เปลี่ยนรถ' }
  const { work, update, plan } = saveEdit(original, form, { vehicles: [{ id: 'V2', licensePlate: 'ใหม่', fuelRate: 5 }] })
  await work()
  expect(plan).not.toHaveBeenCalled()
  expect(update.mock.calls[0][2]).toMatchObject({ fuelRateUsed: 5, fuelCost: 600 })
  expect(update.mock.calls[0][2].totalDistanceKm).toBeUndefined()
})
it('ลบงานจนไม่เหลืองานที่มีพิกัด = กม./เวลา/ค่าน้ำมัน 0 (ไม่ค้าง กม.ของงานที่ลบ) และลงประวัติระยะ', async () => {
  const original = { ...trip(), totalDistanceKm: 50 }
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [original.stops[1]], originalStopIndexes: [1], note: 'ลบ A' }
  const { work, update, log } = saveEdit(original, form, { plan: 'no-coords' })
  await work()
  expect(update.mock.calls[0][2]).toMatchObject({ totalDistanceKm: 0, totalEstimatedTimeMinutes: 0, fuelCost: 0 })
  expect(log.mock.calls[0][1].changes.distance).toEqual({ from: 50, to: 0 })
})
it('ลบจุดจนไม่เหลือ = ระยะ/เวลา/ค่าน้ำมัน 0 โดยไม่ต้องเรียกแผนที่', async () => {
  const original = { ...trip(), totalDistanceKm: 50 }
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [], originalStopIndexes: [], note: 'ลบหมด' }
  const { work, update, plan } = saveEdit(original, form)
  await work()
  expect(plan).not.toHaveBeenCalled()
  expect(update.mock.calls[0][2]).toMatchObject({ totalDistanceKm: 0, totalEstimatedTimeMinutes: 0, fuelCost: 0 })
})
it('ฟอร์มเปลี่ยนระหว่างคิดระยะ = ไม่เขียนอะไร (ผลคิดอาจไม่ตรงกับฟอร์มใหม่)', async () => {
  const original = trip()
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [original.stops[1]], originalStopIndexes: [1], note: 'ลบ A' }
  const harness: any = {}
  Object.assign(harness, saveEdit(original, form, { onPlan: () => { harness.version.current++ } }))
  await harness.work()
  expect(harness.update).not.toHaveBeenCalled()
})
it('เปลี่ยนรถพร้อมแก้จุด = คิดระยะด้วยอัตราน้ำมันรถคันใหม่ + บันทึก fuelRateUsed', async () => {
  const original = { ...trip(), fuelRateUsed: 10 }
  const form = { driverId: 'D1', vehicleId: 'V2', stops: [original.stops[1]], originalStopIndexes: [1], note: 'เปลี่ยนรถ+ลบ A' }
  const { work, update, plan } = saveEdit(original, form, { vehicles: [{ id: 'V2', licensePlate: 'ใหม่', fuelRate: 5 }] })
  await work()
  expect(plan.mock.calls[0][3]).toBe(5)
  expect(update.mock.calls[0][2]).toMatchObject({ fuelRateUsed: 5, totalDistanceKm: 120, fuelCost: 360 })
})
it('คิดระยะด้วยข้อมูลทริปล่าสุด (เช่นรูปแบบเส้นทางที่แท็บอื่นเพิ่งเปลี่ยน) ไม่ใช่ตอนเปิดหน้าต่าง', async () => {
  const original = trip()
  const live = { ...original, routeMode: 'outbound' }
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [original.stops[1]], originalStopIndexes: [1], note: 'ลบ A' }
  const { work, plan } = saveEdit(original, form, { trips: [live] })
  await work()
  expect(plan.mock.calls[0][1]).toBe(live)
})

// ---- งานรับของไปส่งต่อ: แก้ของที่จุดรับ แล้วจุดส่งในเที่ยวเดียวกันแก้ตาม (drop-sync) ----
const pickupStop = (extra: any = {}) => ({ siteId: 'S-WK', siteName: 'วังโค', order: 0, cargoDetails: 'ปูน 10 ถุง', lat: 14.1, lng: 100.6, transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง', ...extra })
const dropStop = (extra: any = {}) => ({ siteId: 'S-DM', siteName: 'ดอนเมือง', order: 2, cargoDetails: 'ส่งของที่รับจาก วังโค: ปูน 10 ถุง\nท่อ EMT จากออฟฟิศ', lat: 13.9, lng: 100.6, transferRole: 'drop', transferId: 'tf_1', ...extra })
const transferTrip = (stops: any[]) => ({ id: 'T1', tripId: 'T1', tripDate: '2026-11-05', status: 'Planned', vehicleId: 'V1', vehiclePlate: 'ทะเบียน', driverId: 'D1', stops })
it('ทริปรับ-ส่ง: แก้ของที่จุดรับ → บันทึกจุดส่งเที่ยวเดียวกันเป็นบรรทัดใหม่ (งานอื่นในจุดส่งคงเดิม) · ไม่คิดระยะใหม่ · toast บอกชื่อจุดส่ง + ให้คนขับเปิดลิงก์ใหม่', async () => {
  const original = transferTrip([pickupStop(), { siteId: 'X', siteName: 'ไซต์ X', order: 1, cargoDetails: 'งานปกติ' }, dropStop()])
  const form = { driverId: 'D1', vehicleId: 'V1', stops: original.stops.map((s: any, i: number) => (i === 0 ? { ...s, cargoDetails: 'ปูน 15 ถุง' } : { ...s })), originalStopIndexes: [0, 1, 2], note: 'ผู้ขอโทรมาแก้' }
  const { work, update, plan, toast } = saveEdit(original, form)
  await work()
  expect(plan).not.toHaveBeenCalled()
  const saved = update.mock.calls[0][2].stops
  expect(saved.map((s: any) => s.cargoDetails)).toEqual(['ปูน 15 ถุง', 'งานปกติ', 'ส่งของที่รับจาก วังโค: ปูน 15 ถุง\nท่อ EMT จากออฟฟิศ'])
  expect(saved.map((s: any) => s.order)).toEqual([0, 1, 2])
  expect(update.mock.calls[0][4]).toEqual({ expectedStops: original.stops, sourceIndexes: [0, 1, 2] })
  expect(form.stops[2].cargoDetails).toBe(dropStop().cargoDetails) // ไม่แก้ฟอร์มของ render ก่อนหน้า
  const shown = toast.mock.calls[0][0]
  expect(shown.title).toBe('แก้ไขสำเร็จ')
  expect(shown.description).toContain('อัปเดตรายการของที่จุดส่ง ดอนเมือง ให้ตามแล้ว')
  expect(shown.description).toContain('ถ้าคนขับเปิดใบงานไว้แล้ว ให้บอกคนขับปิดแล้วเปิดลิงก์ใหม่')
  expect(shown.variant).toBeUndefined()
})
it('ทริปรับ-ส่งที่จุดส่งอยู่คนละเที่ยว → toast สีแดงเตือนให้แก้ที่เที่ยวนั้น (บอกทางคิวต่อเนื่อง) · จุดอื่นไม่เปลี่ยน', async () => {
  const original = transferTrip([pickupStop(), { siteId: 'X', siteName: 'ไซต์ X', order: 1, cargoDetails: 'งานปกติ' }])
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [{ ...original.stops[0], cargoDetails: 'ปูน 15 ถุง' }, { ...original.stops[1] }], originalStopIndexes: [0, 1], note: 'แก้ของ' }
  const { work, update, toast } = saveEdit(original, form)
  await work()
  expect(update.mock.calls[0][2].stops.map((s: any) => s.cargoDetails)).toEqual(['ปูน 15 ถุง', 'งานปกติ'])
  const shown = toast.mock.calls[0][0]
  expect(shown.variant).toBe('destructive')
  expect(shown.description).toContain('จุดส่งไม่อยู่ในเที่ยวนี้ (ดอนเมือง)')
  expect(shown.description).toContain('ถ้าเป็นคิวต่อเนื่อง ให้แจ้งคนขับเอง')
  expect(shown.description).not.toContain('เปิดลิงก์ใหม่')
})
it('ทริปรับ-ส่งที่มีสำเนาคันช่วยบนคันอื่น → toast บอกว่าสำเนาไม่ถูกแก้ตาม (ไม่นับทริปที่ยกเลิก)', async () => {
  const original = transferTrip([pickupStop(), dropStop()])
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [{ ...original.stops[0], cargoDetails: 'ปูน 15 ถุง' }, { ...original.stops[1] }], originalStopIndexes: [0, 1], note: 'แก้ของ' }
  const helper = { id: 'T2', status: 'Planned', stops: [pickupStop({ assistForPlate: 'ทะเบียน' })] }
  const live = saveEdit(original, form, { trips: [original, helper] })
  await live.work()
  expect(live.toast.mock.calls[0][0].description).toContain('สำเนาคันช่วย/งานต้นทางบนคันอื่นไม่ถูกแก้ตาม')
  expect(live.toast.mock.calls[0][0].variant).toBe('destructive')
  const cancelled = saveEdit(original, form, { trips: [original, { ...helper, status: 'Cancelled' }] })
  await cancelled.work()
  expect(cancelled.toast.mock.calls[0][0].description).not.toContain('สำเนาคันช่วย')
  expect(cancelled.toast.mock.calls[0][0].variant).toBeUndefined()
})
it('ทริปปกติแก้รายละเอียด: payload และ toast เหมือนเดิมทุกตัวอักษร (ไม่มีข้อความรับ-ส่ง ไม่มีสีแดง)', async () => {
  const original = trip()
  const form = { driverId: 'D1', vehicleId: 'V1', stops: original.stops.map((s: any) => ({ ...s, cargoDetails: `${s.cargoDetails} แก้` })), originalStopIndexes: [0, 1], note: 'แก้รายละเอียด' }
  const { work, update, toast } = saveEdit(original, form)
  await work()
  expect(update.mock.calls[0][2].stops).toEqual(form.stops.map((s: any, idx: number) => ({ ...s, order: idx })))
  expect(toast.mock.calls[0][0]).toEqual({ title: 'แก้ไขสำเร็จ', description: 'อัปเดตข้อมูลเที่ยววิ่ง T1 เรียบร้อยแล้ว' })
})
