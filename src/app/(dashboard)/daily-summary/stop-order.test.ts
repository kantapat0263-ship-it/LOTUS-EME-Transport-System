import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { assertTripStopsUnchanged } from '@/lib/tripQueueGuard'
import { isManagedTrip } from '@/lib/continuousQueue'

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
type Plan = { km: number; minutes: number; fuelCost: number } | 'no-coords' | 'failed'
function arrange(reject = false, opts: { stops?: any[]; incoming?: number; plan?: Plan; live?: (trip: any) => any } = {}) {
  const trip = { id: 'T1', driverName: 'ทดสอบ', vehiclePlate: 'ทดสอบ', stops: opts.stops ?? [
    { order: 1, siteName: 'A' }, { order: 2, siteName: 'B' }, { order: 3, siteName: 'C' },
  ], stopNotes: { stop_0: 'A', stop_1: 'B', stop_2: 'C' }, stopNoteAuthors: { stop_1: 'ข' } }
  let state: any[] = [structuredClone(trip)]
  const saved = { stops: [{ ...trip.stops[1], dispatcherNote: 'B', dispatcherName: 'ข' }, { ...trip.stops[2], dispatcherNote: 'C' }], stopNotes: {}, stopNoteAuthors: {} }
  const update = reject ? vi.fn().mockRejectedValue(new Error('เปลี่ยนแล้ว')) : vi.fn().mockResolvedValue(saved)
  const toast = vi.fn()
  // ตัวคิดระยะตัวจริงของหน้า (planDistanceFields/applyStopsWithDistance) — mock แค่ Google
  const compute = vi.fn(async (..._args: unknown[]) => opts.plan ?? { km: 90, minutes: 70, fuelCost: 290 })
  const gens: Record<string, number> = {}
  const statsRefresh = vi.fn()
  const remove = vi.fn().mockResolvedValue(undefined)
  const incoming = vi.fn(() => Array.from({ length: opts.incoming ?? 0 }, () => ({ fromTripId: 'SRC' })))
  const handler = new Function('db', 'trips', 'updateTripWithQueueGuard', 'serverTimestamp', 'setTrips', 'toast', 'allowOrdinaryEdit', 'window', 'deleteTripWithQueueGuard', 'setRefusalDrafts', 'incomingStopsForTrip', 'recordedBy', 'user',
    'computePlanDistance', 'nextDistGen', 'isLatestDistGen', 'setStatsRefreshKey', 'getDoc', 'assertTripStopsUnchanged', 'doc', 'isManagedTrip',
    `${body('persistTripPatch')}${body('applyStops')}${body('readLiveTrip')}${body('planDistanceFields')}${body('applyStopsWithDistance')}${body('cancelStop')}return cancelStop`)(
    {}, [trip], update, () => 'test-time', (fn: (prev: any[]) => any[]) => { state = fn(state) }, toast, () => true, { confirm: () => true }, remove, vi.fn(), incoming, 'คนจัดรถ', null,
    compute, (id: string) => (gens[id] = (gens[id] ?? 0) + 1), (id: string, gen: number) => gens[id] === gen, statsRefresh,
    // ทริปบนฐาน (ค่าเริ่มต้น = ตรงกับบนจอ)
    async () => ({ exists: () => true, data: () => structuredClone(opts.live ? opts.live(trip) : trip) }), assertTripStopsUnchanged, () => 'trip-ref', isManagedTrip,
  ) as (trip: unknown, index: number) => Promise<void>
  return { trip, handler, update, toast, compute, statsRefresh, saved, remove, state: () => state }
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
  expect(test.compute).toHaveBeenCalledOnce()
})
it('บันทึกล้มเหลวไม่เปลี่ยน local stops ไม่ขยับบอร์ดหรือแจ้งลบสำเร็จ', async () => {
  const test = arrange(true)
  await test.handler(test.trip, 0)
  expect(test.state()[0]).toEqual(test.trip)
  expect(test.statsRefresh).not.toHaveBeenCalled()
  expect(test.toast).toHaveBeenCalledOnce()
  expect(test.toast.mock.calls[0][0].variant).toBe('destructive')
})

it('ยกเลิกงานสุดท้ายของคันที่ยังถืองานโยกเข้า = ไม่ลบทริป (เก็บไว้ถืองานที่โยกมา)', async () => {
  const test = arrange(false, { stops: [{ order: 1, siteName: 'A' }], incoming: 1 })
  await test.handler(test.trip, 0)
  expect(test.remove).not.toHaveBeenCalled()
  expect(test.update).toHaveBeenCalledOnce()
  expect(test.update.mock.calls[0][2].stops).toEqual([])
})
it('ยกเลิกงานสุดท้ายที่ไม่มีงานโยกเข้า = ลบทริปตามเดิม', async () => {
  const test = arrange(false, { stops: [{ order: 1, siteName: 'A' }] })
  await test.handler(test.trip, 0)
  expect(test.remove).toHaveBeenCalledOnce()
  expect(test.update).not.toHaveBeenCalled()
  expect(test.statsRefresh).toHaveBeenCalledOnce() // บอร์ดนักขับไม่นับทริปที่ลบแล้ว
})
it('ยกเลิกงานที่เคยเลื่อนไปวันอื่น = ปลดใบวันใหม่ในคำสั่งเดียวกัน (ทั้งลบจุดและลบทั้งทริป)', async () => {
  const postponed = { order: 2, siteName: 'B', outcome: 'postponed', postponedRequestId: 'VR-NEW', postponedToDate: '2026-10-09' }
  const keepTrip = arrange(false, { stops: [{ order: 1, siteName: 'A' }, postponed] })
  await keepTrip.handler(keepTrip.trip, 1)
  expect(keepTrip.update.mock.calls[0][4]).toMatchObject({ sourceIndexes: [0], supersedeRequest: { id: 'VR-NEW', by: 'คนจัดรถ' } })
  const lastStop = arrange(false, { stops: [postponed] })
  await lastStop.handler(lastStop.trip, 0)
  expect(lastStop.remove.mock.calls[0][3]).toEqual({ id: 'VR-NEW', by: 'คนจัดรถ' })
  expect(lastStop.remove.mock.calls[0][4]).toEqual({ cancelJob: true })
})

it('ลบงาน: คิด กม.ของจุดที่เหลือก่อน แล้วเขียนจุด + กม./เวลา/ค่าน้ำมัน ในการเขียนเดียวกัน', async () => {
  const test = arrange()
  await test.handler(test.trip, 0)
  const [planTrip, planStops] = test.compute.mock.calls[0]
  expect(planTrip).toMatchObject(test.trip) // ทริปล่าสุดที่อ่านจากฐาน (ตรงกับบนจอ)
  expect((planStops as any[]).map(s => s.siteName)).toEqual(['B', 'C'])
  expect(test.update).toHaveBeenCalledOnce()
  expect(test.update.mock.calls[0][2]).toMatchObject({ totalDistanceKm: 90, totalEstimatedTimeMinutes: 70, fuelCost: 290 })
  expect(test.update.mock.calls[0][2].stops.map((s: any) => s.siteName)).toEqual(['B', 'C'])
  expect(test.statsRefresh).toHaveBeenCalledOnce()
})
it('ลบงาน: คิดระยะไม่ได้ = ยังไม่ลบ ไม่เขียน บอกให้กดใหม่', async () => {
  const test = arrange(false, { plan: 'failed' })
  await test.handler(test.trip, 0)
  expect(test.update).not.toHaveBeenCalled()
  expect(test.state()[0]).toEqual(test.trip)
  expect(test.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'ยังไม่ได้ยกเลิกงาน', variant: 'destructive' })
})
it('ลบงาน: จุดที่เหลือไม่มีพิกัดเลย = ลบได้ กม./เวลา/ค่าน้ำมัน 0 (ไม่ค้าง กม.ของงานที่ลบ)', async () => {
  const test = arrange(false, { plan: 'no-coords' })
  await test.handler(test.trip, 0)
  expect(test.update).toHaveBeenCalledOnce()
  expect(test.update.mock.calls[0][2]).toMatchObject({ totalDistanceKm: 0, totalEstimatedTimeMinutes: 0, fuelCost: 0 })
})
it('ลบงานสุดท้ายของคันที่ถืองานโยกเข้า = กม./ค่าน้ำมัน/เวลาของตัวเองเป็น 0 โดยไม่เรียก Google', async () => {
  const test = arrange(false, { stops: [{ order: 1, siteName: 'A' }], incoming: 1 })
  await test.handler(test.trip, 0)
  expect(test.compute).not.toHaveBeenCalled()
  expect(test.update.mock.calls[0][2]).toMatchObject({ stops: [], totalDistanceKm: 0, fuelCost: 0, totalEstimatedTimeMinutes: 0 })
})

it('ลบงาน: คิดด้วยอัตรา/รูปแบบเส้นทางล่าสุดบนฐาน (จอเก่า)', async () => {
  const test = arrange(false, { live: (t: any) => ({ ...t, routeMode: 'outbound', fuelRateUsed: 6 }) })
  await test.handler(test.trip, 0)
  expect(test.compute.mock.calls[0][0]).toMatchObject({ id: 'T1', routeMode: 'outbound', fuelRateUsed: 6 })
  expect(test.update).toHaveBeenCalledOnce()
})
it('ลบงาน: งานบนฐานถูกแก้จากหน้าอื่นแล้ว = หยุดก่อนเรียก Google ไม่เขียน อัปเดตจอให้ตรวจแล้วกดใหม่', async () => {
  const test = arrange(false, { live: (t: any) => ({ ...t, stops: [...t.stops, { order: 4, siteName: 'D เพิ่มจากหน้าอื่น' }] }) })
  await test.handler(test.trip, 0)
  expect(test.compute).not.toHaveBeenCalled()
  expect(test.update).not.toHaveBeenCalled()
  expect(test.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'ยังไม่ได้ยกเลิกงาน', variant: 'destructive' })
  expect(test.toast.mock.calls.at(-1)?.[0].description).toContain('ตรวจแล้วกดอีกครั้ง')
  expect(test.state()[0].stops).toHaveLength(4) // ข้อมูลล่าสุดขึ้นจอให้ (กดซ้ำได้ทันที)
})
