import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { assertTripStopsUnchanged } from '@/lib/tripQueueGuard'
import { isManagedTrip } from '@/lib/continuousQueue'

// readLiveTrip ตัวจริงของใบสรุป — อ่านทริปล่าสุดจากฐานก่อนคิด กม. (ใบสรุปโหลดทริปครั้งเดียวตอนเลือกวัน)
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function body(name: string) {
  let value: ts.Expression | undefined
  const find = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer; ts.forEachChild(node, find) }
  find(source)
  if (!value) throw new Error(`Actual ${name} missing`)
  return ts.transpileModule(`const work = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

const screen = () => ({ id: 'T1', tripDate: '2026-10-19', routeMode: 'round', fuelRateUsed: 10, stops: [{ siteName: 'A', order: 1 }, { siteName: 'B', order: 2 }] })
function liveUi(data: Record<string, unknown> | null) {
  let state: any[] = [screen(), { id: 'T2', tripDate: '2026-10-19', stops: [] }]
  const toast = vi.fn()
  const deps = {
    db: {}, doc: (_db: unknown, _col: string, id: string) => id, toast, assertTripStopsUnchanged, isManagedTrip,
    getDoc: vi.fn(async () => ({ exists: () => data !== null, data: () => structuredClone(data) })),
    setTrips: (fn: (prev: any[]) => any[]) => { state = fn(state) },
  }
  const read = new Function(...Object.keys(deps), `${body('readLiveTrip')}return work`)(...Object.values(deps)) as (t: unknown, action: string, sameStops?: boolean) => Promise<any>
  return { read, toast, state: () => state }
}

it('ตรงกับจอ = คืนทริปล่าสุด (อัตรา/โหมดล่าสุด) และอัปเดตจอ', async () => {
  const ui = liveUi({ ...screen(), routeMode: 'outbound', fuelRateUsed: 6 })
  const live = await ui.read(screen(), 'ยกเลิกงาน')
  expect(live).toMatchObject({ id: 'T1', routeMode: 'outbound', fuelRateUsed: 6 })
  expect(ui.state()[0]).toMatchObject({ routeMode: 'outbound', fuelRateUsed: 6 })
  expect(ui.toast).not.toHaveBeenCalled()
})

it('งานบนฐานถูกแก้จากหน้าอื่น = หยุด แต่อัปเดตจอให้ (กดซ้ำได้โดยไม่ต้องปิดหน้าต่าง) · หมายเหตุต่างกันอย่างเดียว = ไม่นับ', async () => {
  const changed = liveUi({ ...screen(), stops: [...screen().stops, { siteName: 'C จากหน้าอื่น', order: 3 }] })
  expect(await changed.read(screen(), 'แทรกงาน')).toBeNull()
  expect(changed.state()[0].stops).toHaveLength(3)
  expect(changed.toast.mock.calls[0][0]).toMatchObject({ title: 'ยังไม่ได้แทรกงาน', variant: 'destructive' })
  const noteOnly = liveUi({ ...screen(), stops: screen().stops.map(s => ({ ...s, dispatcherNote: 'หมายเหตุใหม่' })) })
  expect(await noteOnly.read(screen(), 'แทรกงาน')).not.toBeNull()
  // คำสั่งที่ไม่อ้างงานบนจอ (รูปแบบเส้นทาง/เปลี่ยนรถ) ใช้งานชุดล่าสุดได้เลย
  const routeMode = liveUi({ ...screen(), stops: [...screen().stops, { siteName: 'C', order: 3 }] })
  expect((await routeMode.read(screen(), 'เปลี่ยนรูปแบบเส้นทาง', false))?.stops).toHaveLength(3)
})

it('ไม่พบ/ยกเลิกแล้ว/ย้ายวัน/กลายเป็นคิวต่อเนื่อง = หยุดพร้อมบอกเหตุ', async () => {
  for (const [data, text] of [
    [null, 'ไม่พบทริปนี้แล้ว'],
    [{ ...screen(), status: 'Cancelled' }, 'ไม่พบทริปนี้แล้ว'],
    [{ ...screen(), tripDate: '2026-10-20' }, 'ย้ายวัน'],
    [{ ...screen(), queueLink: { queueId: 'Q1', role: 'segment' } }, 'คิวต่อเนื่อง'],
  ] as const) {
    const ui = liveUi(data as any)
    expect(await ui.read(screen(), 'เปลี่ยนรถ', false)).toBeNull()
    expect(ui.toast.mock.calls[0][0].description).toContain(text)
  }
  // ย้ายวัน = ไม่เอาทริปวันอื่นมาแทนบนจอ
  const moved = liveUi({ ...screen(), tripDate: '2026-10-20', routeMode: 'outbound' })
  await moved.read(screen(), 'เปลี่ยนรถ', false)
  expect(moved.state()[0].routeMode).toBe('round')
})
