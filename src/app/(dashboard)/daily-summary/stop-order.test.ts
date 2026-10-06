import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function body(name: string) {
  let value: ts.Expression | undefined
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!value) throw new Error(`Actual handler ${name} missing`)
  return ts.transpileModule(`const ${name} = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}
function arrange(reject = false) {
  const trip = { id: 'T1', driverName: 'ทดสอบ', vehiclePlate: 'ทดสอบ', stops: [
    { order: 1, siteName: 'A' }, { order: 2, siteName: 'B' }, { order: 3, siteName: 'C' },
  ], stopNotes: { stop_0: 'A', stop_1: 'B', stop_2: 'C' }, stopNoteAuthors: { stop_1: 'ข' } }
  let state: any[] = [structuredClone(trip)]
  const saved = { stops: [{ ...trip.stops[1], dispatcherNote: 'B', dispatcherName: 'ข' }, { ...trip.stops[2], dispatcherNote: 'C' }], stopNotes: {}, stopNoteAuthors: {} }
  const update = reject ? vi.fn().mockRejectedValue(new Error('เปลี่ยนแล้ว')) : vi.fn().mockResolvedValue(saved)
  const toast = vi.fn()
  const recalc = vi.fn()
  const handler = new Function('db', 'trips', 'updateTripWithQueueGuard', 'serverTimestamp', 'setTrips', 'toast', 'allowOrdinaryEdit', 'window', 'deleteTripWithQueueGuard', 'recalcTripDistance', `${body('persistTripPatch')}${body('applyStops')}${body('cancelStop')}return cancelStop`)(
    {}, [trip], update, () => 'test-time', (fn: (prev: any[]) => any[]) => { state = fn(state) }, toast, () => true, { confirm: () => true }, vi.fn(), recalc,
  ) as (trip: unknown, index: number) => Promise<void>
  return { trip, handler, update, toast, recalc, saved, state: () => state }
}

it('ปุ่มยกเลิกงานส่ง binding ต้นฉบับ [1,2] พร้อม expected stops', async () => {
  const test = arrange()
  await test.handler(test.trip, 0)
  expect(test.update.mock.calls[0][4]).toEqual({ expectedStops: test.trip.stops, sourceIndexes: [1, 2] })
})
it('UI หลังลบใช้ patch ที่บันทึกจริงและล้าง legacy ทันที', async () => {
  const test = arrange()
  await test.handler(test.trip, 0)
  expect(test.state()[0]).toMatchObject(test.saved)
  expect(test.recalc).toHaveBeenCalledOnce()
})
it('บันทึกล้มเหลวไม่เปลี่ยน local stops ไม่คิดระยะหรือแจ้งลบสำเร็จ', async () => {
  const test = arrange(true)
  await test.handler(test.trip, 0)
  expect(test.state()[0]).toEqual(test.trip)
  expect(test.recalc).not.toHaveBeenCalled()
  expect(test.toast).toHaveBeenCalledOnce()
  expect(test.toast.mock.calls[0][0].variant).toBe('destructive')
})
