import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { inThailand } from '@/lib/roadFlood'
import { orderPickupsBeforeDrop } from '@/lib/transfer'
import { enforceSetOrder } from '@/lib/sequence'

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
    settings: {}, selectedVehicleRate: 10, onOptimizedOrderChange: vi.fn(), toast: vi.fn(), inThailand, orderPickupsBeforeDrop, enforceSetOrder,
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

it('งานรับของไปส่งต่อ: Google จัดจุดส่งไว้ก่อนจุดรับ → ขอเส้นทางใหม่ตามลำดับรับก่อนส่ง (ไม่จัดซ้ำ) และส่งลำดับนั้นให้หน้าจัดกลุ่ม', async () => {
  const PICK = { id: 'P', siteName: 'ดูโฮม', lat: 14.0, lng: 100.6, transferRole: 'pickup', transferId: 'tf_1' }
  const DROP = { id: 'D', siteName: 'ดอนเมือง', lat: 13.9, lng: 100.6, transferRole: 'drop', transferId: 'tf_1' }
  const ui = mapUi([DROP, PICK])
  const legs = (km: number) => [0, 1, 2].map(() => ({ distance: { value: km * 1000 }, duration: { value: 600 } }))
  ui.route
    // ลำดับตั้งต้นจัดรับก่อนส่งแล้ว (enforceSetOrder) → [P, D] · Google สลับเป็นส่งก่อนรับ
    .mockImplementationOnce((_req: any, cb: (r: unknown, s: string) => void) => cb({ routes: [{ waypoint_order: [1, 0], legs: legs(10) }] }, 'OK')) // Google: ส่งก่อนรับ
    .mockImplementationOnce((_req: any, cb: (r: unknown, s: string) => void) => cb({ routes: [{ waypoint_order: [0, 1], legs: legs(20) }] }, 'OK'))
  await ui.calculateRoute(true)
  expect(ui.route).toHaveBeenCalledTimes(2)
  const second = ui.route.mock.calls[1][0]
  expect(second.optimizeWaypoints).toBe(false)
  expect(second.waypoints.map((w: any) => w.location)).toEqual([{ lat: 14.0, lng: 100.6 }, { lat: 13.9, lng: 100.6 }])
  expect(ui.onOptimizedOrderChange).toHaveBeenCalledWith(['P', 'D'])
  // ตัวเลขบนแผนที่มาจากเส้นทางที่ซ่อมแล้ว ไม่ใช่ของ Google รอบแรก
  expect(ui.setRouteStats.mock.calls.at(-1)?.[0]).toMatchObject({ totalDistance: '60.0 กม.' })
})

it('งานรับของไปส่งต่อ: Google จัดรับก่อนส่งอยู่แล้ว → เรียก Google ครั้งเดียวเหมือนเดิม', async () => {
  const PICK = { id: 'P', siteName: 'ดูโฮม', lat: 14.0, lng: 100.6, transferRole: 'pickup', transferId: 'tf_1' }
  const DROP = { id: 'D', siteName: 'ดอนเมือง', lat: 13.9, lng: 100.6, transferRole: 'drop', transferId: 'tf_1' }
  const ui = mapUi([PICK, DROP])
  ui.route.mockImplementationOnce((_req: any, cb: (r: unknown, s: string) => void) => cb({ routes: [{ waypoint_order: [0, 1], legs: [0, 1, 2].map(() => ({ distance: { value: 5000 }, duration: { value: 60 } })) }] }, 'OK'))
  await ui.calculateRoute(true)
  expect(ui.route).toHaveBeenCalledTimes(1)
  expect(ui.onOptimizedOrderChange).toHaveBeenCalledWith(['P', 'D'])
})

it('งานไปหลายจุดตามลำดับ: Google รวมจุดที่เดียวกันติดกัน → ขอเส้นทางใหม่ตามลำดับที่ผู้ขอกรอก (ไซต์ → สนง. → ไซต์)', async () => {
  const A1 = { id: 'A1', siteName: 'ไซต์', lat: 13.7, lng: 100.7, sequenceId: 'sq_1', sequenceIndex: 0, sequenceSize: 3 }
  const DOC = { id: 'DOC', siteName: 'สนง.เอกสาร', lat: 13.8, lng: 100.5, sequenceId: 'sq_1', sequenceIndex: 1, sequenceSize: 3 }
  const A2 = { id: 'A2', siteName: 'ไซต์', lat: 13.7, lng: 100.7, sequenceId: 'sq_1', sequenceIndex: 2, sequenceSize: 3 }
  const ui = mapUi([A2, DOC, A1])
  const legs = [0, 1, 2, 3].map(() => ({ distance: { value: 10_000 }, duration: { value: 600 } }))
  ui.route
    // ลำดับตั้งต้น [A1, DOC, A2] · Google รวมไซต์ติดกัน → [A1, A2, DOC]
    .mockImplementationOnce((_req: any, cb: (r: unknown, s: string) => void) => cb({ routes: [{ waypoint_order: [0, 2, 1], legs }] }, 'OK'))
    .mockImplementationOnce((_req: any, cb: (r: unknown, s: string) => void) => cb({ routes: [{ waypoint_order: [0, 1, 2], legs }] }, 'OK'))
  await ui.calculateRoute(true)
  expect(ui.route).toHaveBeenCalledTimes(2)
  expect(ui.route.mock.calls[1][0].optimizeWaypoints).toBe(false)
  expect(ui.onOptimizedOrderChange).toHaveBeenCalledWith(['A1', 'DOC', 'A2'])
})
