import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { inThailand } from '@/lib/roadFlood'
import { assertTripStopsUnchanged } from '@/lib/tripQueueGuard'
import { isManagedTrip } from '@/lib/continuousQueue'

// แทรกงานด่วนตัวจริงของใบสรุป (handleInsertJob + ตัวเขียนจุด + ตัวคิดระยะ) — mock แค่ Google/Firestore
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function body(name: string) {
  let value: ts.Expression | undefined
  const find = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer; ts.forEachChild(node, find) }
  find(source)
  if (!value) throw new Error(`Actual ${name} missing`)
  return ts.transpileModule(`const ${name} = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

type Plan = { km: number; minutes: number; fuelCost: number } | 'no-coords' | 'failed'
const SITE = { id: 'S1', name: 'ไซต์แทรก (ทดสอบ)', status: 'Active', latitude: 13.5, longitude: 100.8 }

function insertUi(opts: { plan?: Plan; vehicleId?: string; modeChangeDuringPlan?: boolean; otherTrip?: boolean } = {}) {
  const trip = { id: 'T1', tripDate: '2026-10-19', vehicleId: 'V1', vehiclePlate: 'รถหนึ่ง', driverId: 'D1', driverName: 'คนขับ', fuelRateUsed: 12, dieselPriceUsed: 31,
    stops: [{ siteId: 'OLD', siteName: 'งานเดิม', order: 1, lat: 14.2, lng: 100.62 }] }
  const other = { id: 'T2', tripDate: '2026-10-19', vehicleId: 'V2', vehiclePlate: 'รถหกล้อ', driverId: 'D2', driverName: 'คนขับสอง', status: 'Planned', fuelRateUsed: 6, dieselPriceUsed: 31,
    stops: [{ siteId: 'O2', siteName: 'งานของรถหกล้อ', order: 1, lat: 14.0, lng: 100.6 }] }
  const trips = opts.otherTrip ? [trip, other] : [trip]
  const gens: Record<string, number> = {}
  const compute = vi.fn(async (tripDoc: any, _stops: unknown) => {
    if (opts.modeChangeDuringPlan) gens[tripDoc.id] = (gens[tripDoc.id] ?? 0) + 1 // เปลี่ยนรูปแบบเส้นทางเขียนไปก่อน
    return opts.plan ?? { km: 140, minutes: 110, fuelCost: 362 }
  })
  const update = vi.fn(async (_db: unknown, _id: string, patch: any) => patch)
  const create = vi.fn().mockResolvedValue(undefined)
  const toast = vi.fn(), setInsertDialog = vi.fn(), setInsertForm = vi.fn(), statsRefresh = vi.fn()
  let state: any[] = structuredClone(trips)
  const deps = {
    db: {}, trips, insertDialog: { tripId: 'T1' }, setInsertDialog, setInsertForm, allowOrdinaryEdit: () => true, todayStr: '2026-10-19', toast,
    insertForm: { place: '', detail: 'ส่งของด่วน', requester: '', vehicleId: opts.vehicleId ?? '', siteId: 'S1' },
    sitesData: [SITE], inThailand, recordedBy: 'คนจัดรถ', passLeaveGate: async () => true,
    vehiclesData: [{ id: 'V1', licensePlate: 'รถหนึ่ง', type: 'Pickup', fuelRate: 12 }, { id: 'V2', licensePlate: 'รถหกล้อ', type: '6-wheel truck', fuelRate: 6 }],
    companySettings: { dieselPrice: 30, defaultFuelRate: 9 }, createTripWithQueueGuard: create, updateTripWithQueueGuard: update, serverTimestamp: () => 'ts',
    setTrips: (fn: (prev: any[]) => any[]) => { state = fn(state) }, setRefusalDrafts: vi.fn(), setStatsRefreshKey: statsRefresh,
    computePlanDistance: compute, nextDistGen: (id: string) => (gens[id] = (gens[id] ?? 0) + 1), isLatestDistGen: (id: string, gen: number) => gens[id] === gen,
    console: { error: vi.fn() },
    // ทริปบนฐาน = ตรงกับบนจอ
    doc: (_db: unknown, _col: string, id: string) => id, assertTripStopsUnchanged, isManagedTrip,
    getDoc: async (id: string) => { const t = trips.find(x => x.id === id); return { exists: () => !!t, data: () => structuredClone(t) } },
  }
  const code = ['isPickableSite', 'persistTripPatch', 'applyStops', 'readLiveTrip', 'planDistanceFields', 'applyStopsWithDistance', 'handleInsertJob'].map(body).join('')
  const handler = new Function(...Object.keys(deps), `${code}return handleInsertJob`)(...Object.values(deps)) as () => Promise<void>
  return { trip, other, handler, compute, update, create, toast, setInsertDialog, statsRefresh, state: () => state }
}

it('แทรกเข้าทริปเดิม: คิด กม.ของจุดชุดใหม่ก่อน แล้วเขียนจุด + กม./เวลา/ค่าน้ำมัน ในการเขียนเดียว', async () => {
  const ui = insertUi()
  await ui.handler()
  const [planTrip, planStops] = ui.compute.mock.calls[0] as [any, any[]]
  expect(planTrip).toEqual(ui.trip) // routeMode/ต้นทาง/อัตราของทริปนั้น (อ่านล่าสุดจากฐาน)
  expect(planStops.map(s => s.siteName)).toEqual(['งานเดิม', 'ไซต์แทรก (ทดสอบ)'])
  expect(planStops[1]).toMatchObject({ lat: 13.5, lng: 100.8, adhoc: true })
  expect(ui.update).toHaveBeenCalledTimes(1)
  const patch = ui.update.mock.calls[0][2]
  expect(patch).toMatchObject({ totalDistanceKm: 140, totalEstimatedTimeMinutes: 110, fuelCost: 362 })
  expect(patch.stops.map((s: any) => s.siteName)).toEqual(['งานเดิม', 'ไซต์แทรก (ทดสอบ)'])
  expect(ui.state()[0]).toMatchObject({ totalDistanceKm: 140 }) // จอได้เลขใหม่พร้อมงาน
  expect(ui.statsRefresh).toHaveBeenCalledOnce()
  expect(ui.setInsertDialog).toHaveBeenCalledWith(null)
})

it('แทรกเข้าทริปเดิม: คิดระยะไม่ได้ = ไม่เขียน หน้าต่างแทรกค้างไว้ บอกให้กดใหม่', async () => {
  const ui = insertUi({ plan: 'failed' })
  await ui.handler()
  expect(ui.update).not.toHaveBeenCalled()
  expect(ui.setInsertDialog).not.toHaveBeenCalled()
  expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'ยังไม่ได้แทรกงาน', variant: 'destructive' })
})

it('แทรกเข้าทริปเดิม: รูปแบบเส้นทางถูกเปลี่ยนระหว่างคิด = ไม่เขียน (ผลคิดด้วยโหมดเก่า)', async () => {
  const ui = insertUi({ modeChangeDuringPlan: true })
  await ui.handler()
  expect(ui.update).not.toHaveBeenCalled()
  expect(ui.setInsertDialog).not.toHaveBeenCalled()
  expect(ui.toast.mock.calls.at(-1)?.[0].description).toContain('รูปแบบเส้นทาง')
})

it('เปลี่ยนเป็นรถที่ยังไม่มีทริปวันนี้: คิดก่อนสร้าง + freeze อัตรารถคันนั้น/ราคาดีเซล/จุดออฟฟิศ', async () => {
  const ui = insertUi({ vehicleId: 'V2' })
  await ui.handler()
  const [planTrip] = ui.compute.mock.calls[0] as [any, any[]]
  expect(planTrip).toMatchObject({ vehicleId: 'V2', fuelRateUsed: 6, dieselPriceUsed: 30, originLat: 14.0815, originLng: 100.7129 })
  expect(ui.create).toHaveBeenCalledTimes(1)
  expect(ui.create.mock.calls[0][2]).toMatchObject({ vehicleId: 'V2', fuelRateUsed: 6, dieselPriceUsed: 30, totalDistanceKm: 140, totalEstimatedTimeMinutes: 110, fuelCost: 362 })
  expect(ui.update).not.toHaveBeenCalled()
  expect(ui.state().at(-1)).toMatchObject({ vehicleId: 'V2', totalDistanceKm: 140 })
  expect(ui.setInsertDialog).toHaveBeenCalledWith(null)
})

it('เปลี่ยนเป็นรถที่ยังไม่มีทริปวันนี้: คิดระยะไม่ได้ = ไม่สร้างทริป หน้าต่างค้างไว้', async () => {
  const ui = insertUi({ vehicleId: 'V2', plan: 'failed' })
  await ui.handler()
  expect(ui.create).not.toHaveBeenCalled()
  expect(ui.setInsertDialog).not.toHaveBeenCalled()
  expect(ui.state()).toHaveLength(1)
  expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'ยังไม่ได้แทรกงาน', variant: 'destructive' })
})

it('เปลี่ยนเป็นรถที่มีทริปวันนี้อยู่แล้ว: แทรกเข้าทริปของคันนั้น คิดด้วยข้อมูลทริปปลายทาง แล้วเขียนพร้อมกัน', async () => {
  const ui = insertUi({ vehicleId: 'V2', otherTrip: true })
  await ui.handler()
  const [planTrip, planStops] = ui.compute.mock.calls[0] as [any, any[]]
  expect(planTrip).toEqual(ui.other) // อัตรา/รูปแบบเส้นทางของทริปปลายทาง ไม่ใช่ทริปต้นทาง
  expect(planStops.map(s => s.siteName)).toEqual(['งานของรถหกล้อ', 'ไซต์แทรก (ทดสอบ)'])
  expect(ui.create).not.toHaveBeenCalled()
  expect(ui.update).toHaveBeenCalledTimes(1)
  expect(ui.update.mock.calls[0][1]).toBe('T2')
  expect(ui.update.mock.calls[0][2]).toMatchObject({ totalDistanceKm: 140, fuelCost: 362 })
  expect(ui.setInsertDialog).toHaveBeenCalledWith(null)
})
