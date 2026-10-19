import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { inThailand } from '@/lib/roadFlood'

// ดึง calculateRoute ตัวจริงจาก GroupingMap มารันกับ Google ปลอม
const source = ts.createSourceFile('GroupingMap.tsx', readFileSync(new URL('./GroupingMap.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let decl: ts.Expression | undefined
const find = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'calculateRoute') decl = node.initializer
  ts.forEachChild(node, find)
}
find(source)
if (!decl) throw new Error('Actual calculateRoute missing')
const compiled = ts.transpileModule(`const work = ${decl.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

const A = { id: 'A', siteName: 'มีพิกัด', lat: 13.5, lng: 100.8 }
const ZERO = { id: 'Z', siteName: 'ใบขอไม่มีพิกัด', lat: 0, lng: 0 }
const NONE = { id: 'N', siteName: 'พิมพ์ชื่อเอง' }

function mapUi(dests: object[], status = 'OK') {
  const pending: Array<() => void> = []
  const route = vi.fn((_req: any, cb: (r: unknown, s: string) => void) => cb(status === 'OK'
    ? { routes: [{ waypoint_order: [0], legs: [{ distance: { value: 40_000 }, duration: { value: 1800 } }, { distance: { value: 40_000 }, duration: { value: 1800 } }] }] }
    : null, status))
  const deps = {
    React: { useCallback: (fn: unknown) => fn },
    directionsServiceRef: { current: { route } }, directionsRendererRef: { current: { setDirections: vi.fn() } },
    mode: 'auto', manualOrder: [], selectedIds: new Set(dests.map((d: any) => d.id)), destinations: dests,
    setRouteStats: vi.fn(), setMissingCoordCount: vi.fn(), setIsCalculating: vi.fn(), lastRouteKeyRef: { current: null }, routeSeqRef: { current: 0 },
    window: { google: { maps: { LatLng: vi.fn((lat: number, lng: number) => ({ lat, lng })), TravelMode: { DRIVING: 'DRIVING' } } } },
    settings: {}, selectedVehicleRate: 10, onOptimizedOrderChange: vi.fn(), toast: vi.fn(), inThailand,
    HEAD_OFFICE_DEFAULT: { lat: 14.0815, lng: 100.7129 },
  }
  const calculateRoute = new Function(...Object.keys(deps), `${compiled}return work`)(...Object.values(deps))
  return { calculateRoute, route, pending, ...deps }
}

it('งานไม่มีพิกัด/(0,0) ไม่ส่งให้ Google — เส้นทางของงานที่เหลือยังคิดได้ และบอกจำนวนที่ไม่นับ', async () => {
  const ui = mapUi([A, ZERO, NONE])
  await ui.calculateRoute(true)
  expect(ui.route).toHaveBeenCalledTimes(1)
  expect(ui.route.mock.calls[0][0].waypoints.map((w: any) => w.location)).toEqual([{ lat: 13.5, lng: 100.8 }])
  expect(ui.setMissingCoordCount).toHaveBeenLastCalledWith(2)
  expect(ui.setRouteStats.mock.calls.at(-1)?.[0]).toMatchObject({ totalDistance: '80.0 กม.' })
  // ลำดับที่ Google จัดมีเฉพาะงานที่มีพิกัด — งานไม่มีพิกัดหน้าจัดกลุ่มต่อท้ายให้เอง (selectedDestinations.remaining)
  expect(ui.onOptimizedOrderChange).toHaveBeenCalledWith(['A'])
})

it('ทุกงานไม่มีพิกัด = ไม่เรียก Google ไม่ขึ้นตัวเลข', async () => {
  const ui = mapUi([ZERO, NONE])
  await ui.calculateRoute(true)
  expect(ui.route).not.toHaveBeenCalled()
  expect(ui.setRouteStats).toHaveBeenLastCalledWith(null)
  expect(ui.setMissingCoordCount).toHaveBeenLastCalledWith(2)
})

it('Google คิดไม่ได้ = ล้างตัวเลขเดิม (ไม่ค้างของการเลือกชุดก่อน) และแจ้งเตือน', async () => {
  const ui = mapUi([A], 'ZERO_RESULTS')
  await ui.calculateRoute(true)
  expect(ui.setRouteStats).toHaveBeenLastCalledWith(null)
  expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'destructive' })
})

it('แผนที่ไม่ส่งตัวเลขให้หน้าจัดกลุ่มผ่าน window อีกแล้ว (หน้าจัดกลุ่มคิดเองตอนบันทึก)', () => {
  const page = readFileSync(new URL('../../app/(dashboard)/trip-grouping/page.tsx', import.meta.url), 'utf8')
  expect(source.getFullText()).not.toContain('__lastTripStats')
  expect(page).not.toContain('__lastTripStats')
})

it('ผลของการเลือกชุดก่อนที่ตอบช้า ไม่มาทับแผนที่/ตัวเลข/ลำดับของการเลือกล่าสุด', async () => {
  const ui = mapUi([A])
  let late: (() => void) | undefined
  ui.route.mockImplementationOnce((_req: any, cb: (r: unknown, s: string) => void) => {
    late = () => cb({ routes: [{ waypoint_order: [0], legs: [{ distance: { value: 999_000 }, duration: { value: 1 } }] }] }, 'OK')
  })
  await ui.calculateRoute(true) // รอบที่ 1 ยังไม่ตอบ
  ui.selectedIds.clear()
  await ui.calculateRoute(true) // ถอนการเลือกทั้งหมด = ล้าง
  late!() // รอบที่ 1 ตอบกลับทีหลัง
  expect(ui.setRouteStats).toHaveBeenLastCalledWith(null)
  expect(ui.onOptimizedOrderChange).not.toHaveBeenCalled()
  expect(ui.directionsRendererRef.current.setDirections).toHaveBeenLastCalledWith({ routes: [] })
  expect(ui.setIsCalculating).toHaveBeenLastCalledWith(false)
})

it('งานที่เลือกอยู่นอกตัวกรองวันทั้งหมด = ล้างตัวเลขและคำเตือนของชุดก่อน', async () => {
  const ui = mapUi([])
  ui.selectedIds.add('งานวันอื่น')
  await ui.calculateRoute(true)
  expect(ui.route).not.toHaveBeenCalled()
  expect(ui.setRouteStats).toHaveBeenLastCalledWith(null)
  expect(ui.setMissingCoordCount).toHaveBeenLastCalledWith(0)
})
