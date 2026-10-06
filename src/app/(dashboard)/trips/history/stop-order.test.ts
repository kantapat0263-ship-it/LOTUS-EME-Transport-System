import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

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
function formEvent(fragment: string, form: any, index = 0) {
  let event: ts.ArrowFunction | undefined
  function find(node: ts.Node) {
    if (ts.isArrowFunction(node) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) && node.getText(source).includes(fragment)) event = node
    ts.forEachChild(node, find)
  }
  find(source)
  if (!event) throw new Error(`Actual form event missing: ${fragment}`)
  let saved = form
  const code = ts.transpileModule(`const work = ${event.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const work = new Function('editFormData', 'setEditFormData', 'idx', 'site', `${code}return work`)(form, (value: any) => { saved = value }, index, { id: 'NEW', name: 'ใหม่' })
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
it('บันทึก history ส่ง binding แยกจาก stops ที่ renumber แล้วโดยไม่เก็บ binding ในฐาน', async () => {
  const original = trip()
  const added = { siteId: 'A', siteName: 'A', order: 0, cargoDetails: 'เพิ่มใหม่' }
  const form = { driverId: 'D1', vehicleId: 'V1', stops: [original.stops[1], added], originalStopIndexes: [1, null], note: 'ลบ A เพิ่มใหม่' }
  const update = vi.fn().mockResolvedValue({})
  const log = vi.fn()
  const close = vi.fn()
  const work = new Function('editingTrip', 'user', 'isManagedTrip', 'editFormData', 'toast', 'saveEditBusyRef', 'confirmLeaveBeforeAssign', 'checkLeave', 'drivers', 'vehicles', 'editVersionRef', 'editOpenRef', 'window', 'updateTripWithQueueGuard', 'db', 'serverTimestamp', 'collection', 'addDoc', 'setIsEditOpen', `${handler('handleSaveEdit')}return work`)(
    original, { email: 'test@example.invalid' }, () => false, form, vi.fn(), { current: false }, vi.fn(), vi.fn(), [{ id: 'D1', name: 'คนขับ' }], [{ id: 'V1', licensePlate: 'ทะเบียน' }], { current: 1 }, { current: true }, { confirm: () => true }, update, {}, () => 'test-time', vi.fn(), log, close,
  )
  await work()
  expect(update.mock.calls[0][4]).toEqual({ expectedStops: original.stops, sourceIndexes: [1, null] })
  expect(update.mock.calls[0][2].stops.map((s: any) => s.order)).toEqual([0, 1])
  expect(update.mock.calls[0][2].originalStopIndexes).toBeUndefined()
  expect(log).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledWith(false)
})
