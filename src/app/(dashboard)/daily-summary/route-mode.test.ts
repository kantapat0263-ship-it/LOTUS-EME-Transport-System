import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { ROUTE_MODES, tripRouteMode } from '@/lib/routeMode'

// เปลี่ยนรูปแบบเส้นทางตัวจริงของใบสรุป — บันทึกผ่านด่านรายการงาน (applyStops) ไม่เขียนทับตรง ๆ
const text = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const source = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function body(name: string) {
  let value: ts.Expression | undefined
  const find = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer; ts.forEachChild(node, find) }
  find(source)
  if (!value) throw new Error(`Actual ${name} missing`)
  return ts.transpileModule(`const work = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}
type Plan = { km: number; minutes: number; fuelCost: number } | 'no-coords' | 'failed'
function modeUi(opts: { plan?: Plan; saved?: boolean; editedDuringPlan?: boolean; live?: (t: any) => any } = {}) {
  const trip = { id: 'T1', routeMode: 'round', totalDistanceKm: 60, stops: [{ siteName: 'A', order: 1, lat: 14.2, lng: 100.62 }] }
  const applyStops = vi.fn(async (..._args: unknown[]) => opts.saved ?? true)
  const distGenRef: { current: Record<string, number> } = { current: {} }
  const compute = vi.fn(async (..._args: unknown[]) => {
    if (opts.editedDuringPlan) distGenRef.current.T1 = (distGenRef.current.T1 ?? 0) + 1 // แทรก/ลบงานของทริปนี้ระหว่างคิด
    return opts.plan ?? { km: 35, minutes: 40, fuelCost: 110 }
  })
  const toast = vi.fn(), statsRefresh = vi.fn()
  const deps = {
    db: {}, routeModeBusy: false, setRouteModeBusy: vi.fn(), isManagedTrip: () => false, tripRouteMode, ROUTE_MODES,
    distGenRef, nextDistGen: vi.fn(), computePlanDistance: compute, applyStops, setStatsRefreshKey: statsRefresh, toast, console: { error: vi.fn() },
    readLiveTrip: vi.fn(async (t: any) => (opts.live ? opts.live(t) : t)), // ทริปล่าสุดบนฐาน
  }
  const handler = new Function(...Object.keys(deps), `${body('changeRouteMode')}return work`)(...Object.values(deps)) as (t: unknown, m: string) => Promise<void>
  return { trip, handler, applyStops, compute, toast, statsRefresh }
}

it('บันทึกโหมด + กม.ผ่านด่านรายการงาน (งานเดิม ลำดับเดิม) ไม่เขียน updateDoc ตรง ๆ', async () => {
  const ui = modeUi()
  await ui.handler(ui.trip, 'outbound')
  expect(ui.compute.mock.calls[0][0]).toMatchObject({ id: 'T1', routeMode: 'outbound' })
  expect(ui.applyStops).toHaveBeenCalledWith(ui.trip, ui.trip.stops, true, undefined, true,
    { routeMode: 'outbound', totalDistanceKm: 35, fuelCost: 110, totalEstimatedTimeMinutes: 40 })
  expect(ui.statsRefresh).toHaveBeenCalledOnce()
  expect(ui.toast.mock.calls.at(-1)?.[0].title).toContain('รูปแบบเส้นทาง')
  expect(text).not.toMatch(/updateDoc\(doc\(db, "trips"/)
})

it('งานในทริปถูกแก้จากหน้าอื่น (ด่านไม่ผ่าน) = ไม่ขึ้นสำเร็จ ไม่ขยับบอร์ด', async () => {
  const ui = modeUi({ saved: false })
  await ui.handler(ui.trip, 'outbound')
  expect(ui.applyStops).toHaveBeenCalledOnce()
  expect(ui.statsRefresh).not.toHaveBeenCalled()
  expect(ui.toast).not.toHaveBeenCalled() // ด่าน (persistTripPatch) แจ้งเหตุผลให้โหลดใหม่เอง
})

it('ไม่มีพิกัดเลย = เปลี่ยนแค่โหมด กม.คงเดิม (งานไม่ได้เปลี่ยน) · คิดไม่ได้ = ไม่บันทึก', async () => {
  const none = modeUi({ plan: 'no-coords' })
  await none.handler(none.trip, 'return')
  expect(none.applyStops.mock.calls[0][5]).toEqual({ routeMode: 'return' })
  const failed = modeUi({ plan: 'failed' })
  await failed.handler(failed.trip, 'return')
  expect(failed.applyStops).not.toHaveBeenCalled()
  expect(failed.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'ยังไม่เปลี่ยนรูปแบบเส้นทาง', variant: 'destructive' })
})

it('งานในทริปเปลี่ยน (แทรก/ลบ) ระหว่างคิดระยะ = ไม่บันทึก ผลนี้ใช้งานชุดเก่า', async () => {
  const ui = modeUi({ editedDuringPlan: true })
  await ui.handler(ui.trip, 'outbound')
  expect(ui.applyStops).not.toHaveBeenCalled()
  expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'ยังไม่เปลี่ยนรูปแบบเส้นทาง', variant: 'destructive' })
})

it('คิดและบันทึกจากทริปล่าสุดบนฐาน — งานที่เพิ่งรวมจากหน้าอื่นถูกนับด้วย (ไม่ใช้งานชุดเก่าบนจอ)', async () => {
  const merged = { siteName: 'B รวมจากหน้าจัดกลุ่ม', order: 2, lat: 13.9, lng: 100.6 }
  const ui = modeUi({ live: (t: any) => ({ ...t, stops: [...t.stops, merged] }) })
  await ui.handler(ui.trip, 'outbound')
  expect((ui.compute.mock.calls[0][1] as any[]).map(s => s.siteName)).toEqual(['A', 'B รวมจากหน้าจัดกลุ่ม'])
  const [liveTrip, stops] = ui.applyStops.mock.calls[0] as [any, any[]]
  expect(liveTrip.stops).toHaveLength(2)
  expect(stops).toHaveLength(2) // ด่านตรวจกับงานชุดล่าสุด
})
it('ทริปถูกเปลี่ยนเป็นโหมดนี้จากหน้าอื่นแล้ว = ไม่ทำซ้ำ และบอกผู้ใช้ (ไม่จบเงียบ)', async () => {
  const ui = modeUi({ live: (t: any) => ({ ...t, routeMode: 'outbound' }) })
  await ui.handler(ui.trip, 'outbound')
  expect(ui.compute).not.toHaveBeenCalled()
  expect(ui.applyStops).not.toHaveBeenCalled()
  expect(ui.toast.mock.calls.at(-1)?.[0].description).toContain('อยู่แล้ว')
})
