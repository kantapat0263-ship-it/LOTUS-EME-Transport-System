import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { incomingStopsForTrip } from '@/lib/calculations'
import { TRANSFER_EDIT_AT_SOURCE, transferDisplayOrder, transferLabel, transferNoteForDriver } from '@/lib/transfer'

// จุดรับที่โยกเข้ามาขึ้นก่อนจุดส่งของมัน — ตรวจด้วยโค้ดจริงของหน้าใบสรุป (ใบพิมพ์ + แผงปิดผลงาน) โดยไม่ต้องบูต Firebase
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const jsx = { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
function callbackOf(callee: string) {
  let found: ts.Expression | undefined
  const find = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === callee) found = node.arguments[0]
    ts.forEachChild(node, find)
  }
  find(source)
  if (!found) throw new Error(`Actual ${callee} missing`)
  return ts.transpileModule(`const work = ${found.getText(source)};`, { compilerOptions: jsx }).outputText
}
function variable(name: string) {
  let found: ts.Expression | undefined
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!found) throw new Error(`Actual ${name} missing`)
  return ts.transpileModule(`const work = ${found.getText(source)};`, { compilerOptions: jsx }).outputText
}

type Raw = Record<string, any>
const icon = () => React.createElement('span')

/** แถวของคันเดียวในใบพิมพ์ (callback จริงของ trips.flatMap) → html ของแต่ละ <tr> ตามลำดับบนจอ */
function printRows(trips: Raw[], tripId: string) {
  const deps = {
    React, trips, incomingStopsForTrip, transferDisplayOrder, transferLabel, transferNoteForDriver,
    isFullyMovedOut: () => false, getDriverPhone: () => '', formatThaiDate: (s: string) => s, handleShareClick: () => {},
    Button: ({ children }: { children?: React.ReactNode }) => React.createElement('button', null, children),
    Send: icon, ClipboardList: icon, transferTagStyle: () => ({}),
  }
  const render = new Function(...Object.keys(deps), `${callbackOf('trips.flatMap')}return work`)(...Object.values(deps))
  const rows = render(trips.find(t => t.id === tripId)) as React.ReactElement[]
  const html = renderToStaticMarkup(React.createElement('table', null, React.createElement('tbody', null, rows)))
  return html.split('<tr').slice(1)
}
const rowSpans = (tr: string) => (tr.match(/rowspan=/gi) || []).length
const cells = (tr: string) => (tr.match(/<td/g) || []).length

const shop = { siteName: 'ดูโฮม', cargoDetails: 'ปูน 10 ถุง', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง' } as const
const drop = { siteName: 'ดอนเมือง', cargoDetails: 'ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง', transferRole: 'drop', transferId: 'tf_1' } as const
const sourceTrip = (stops: Raw[]) => ({ id: 'T-A', tripDate: '2026-11-05', driverName: 'สมชาย', vehiclePlate: 'กข 1', stops })
const moved = (stop: Raw, to = 'T-B') => ({ ...stop, outcome: 'reassigned', reassignedToTripId: to, reassignedToVehiclePlate: 'ขค 2', reassignedToDriverName: 'สมศักดิ์' })

describe('ใบพิมพ์ใบสรุป: จุดรับที่โยกเข้ามาขึ้นก่อนจุดส่ง', () => {
  it('ไซต์ A, ดอนเมือง + ดูโฮมโยกเข้ามา → ไซต์ A, ดูโฮม, ดอนเมือง เลข 1-3 · ช่องวันที่/คนขับอยู่แถวแรกแถวเดียว · ไม่มีบรรทัดเตือนลำดับ', () => {
    const receiver = { id: 'T-B', tripDate: '2026-11-05', driverName: 'สมศักดิ์', vehiclePlate: 'ขค 2', stopNotes: { stop_1: 'โน้ตของจุดส่ง' }, stops: [{ siteName: 'ไซต์ A' }, drop] }
    const rows = printRows([sourceTrip([moved(shop)]), receiver], 'T-B')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('<span>1.</span><span>ไซต์ A</span>')
    expect(rows[1]).toContain('<span>2.</span><span>ดูโฮม</span>')
    expect(rows[1]).toContain('🔄 รับโยกงานต่อ')
    expect(rows[2]).toContain('<span>3.</span><span>ดอนเมือง</span>')
    expect(rows.map(rowSpans)).toEqual([2, 0, 0])
    expect(rows.map(cells)).toEqual([4, 2, 2])
    expect(rows.join('')).not.toContain('⚠️')
    // หมายเหตุยังผูกกับ index ที่บันทึก (stop_1 = ดอนเมือง) ไม่ใช่ตำแหน่งบนจอ
    expect(rows[2]).toContain('โน้ตของจุดส่ง')
    expect(rows[0]).not.toContain('โน้ตของจุดส่ง')
  })

  it('คันมีแต่จุดส่ง + จุดรับโยกเข้ามา → แถวรับโยกขึ้นแถวแรก และได้ช่องวันที่/คนขับแทน (ตารางไม่เหลื่อม)', () => {
    const receiver = { id: 'T-B', tripDate: '2026-11-05', driverName: 'สมศักดิ์', vehiclePlate: 'ขค 2', stops: [drop] }
    const rows = printRows([sourceTrip([moved(shop)]), receiver], 'T-B')
    expect(rows[0]).toContain('<span>1.</span><span>ดูโฮม</span>')
    expect(rows[1]).toContain('<span>2.</span><span>ดอนเมือง</span>')
    expect(rows.map(rowSpans)).toEqual([2, 0])
    expect(rows.map(cells)).toEqual([4, 2])
    expect(rows.join('')).not.toContain('⚠️')
  })

  it('จุดส่งของคันนี้เลื่อนไปแล้ว → จุดรับที่โยกเข้ามาอยู่ท้ายเหมือนเดิม พร้อมบอกคนขับว่าจุดส่งไม่ได้ไปกับเที่ยวนี้', () => {
    const receiver = { id: 'T-B', tripDate: '2026-11-05', driverName: 'สมศักดิ์', vehiclePlate: 'ขค 2', stops: [{ siteName: 'ไซต์ A' }, { ...drop, outcome: 'postponed' }] }
    const rows = printRows([sourceTrip([moved(shop)]), receiver], 'T-B')
    expect(rows[2]).toContain('<span>3.</span><span>ดูโฮม</span>')
    expect(rows[2]).toContain('จุดส่งของงานนี้ไม่ได้ไปกับเที่ยวนี้')
    expect(rows.map(rowSpans)).toEqual([2, 0, 0])
  })

  it('ทริปปกติ (ไม่มีงานรับ-ส่ง) งานตัวเอง 1 จุด + งานโยกเข้า → เหมือนเดิม: แถวตัวเองไม่มีเลข งานโยกเป็น "2." อยู่ท้าย', () => {
    const receiver = { id: 'T-B', tripDate: '2026-11-05', driverName: 'สมศักดิ์', vehiclePlate: 'ขค 2', stops: [{ siteName: 'ไซต์ A' }] }
    const rows = printRows([sourceTrip([moved({ siteName: 'วังโค' })]), receiver], 'T-B')
    expect(rows[0]).toContain('<span>ไซต์ A</span>')
    expect(rows[0]).not.toContain('1.</span>')
    expect(rows[1]).toContain('<span>2.</span><span>วังโค</span>')
    expect(rows.map(rowSpans)).toEqual([2, 0])
  })

  it('คันมีแต่งานรับโยก (ไม่มีงานตัวเอง) → ช่องวันที่/คนขับอยู่แถวรับโยกแถวแรก เหมือนเดิม', () => {
    const receiver = { id: 'T-B', tripDate: '2026-11-05', driverName: 'สมศักดิ์', vehiclePlate: 'ขค 2', stops: [] }
    const rows = printRows([sourceTrip([moved({ siteName: 'วังโค' }), moved({ siteName: 'บางขันธ์' })]), receiver], 'T-B')
    expect(rows.map(rowSpans)).toEqual([2, 0])
    expect(rows[0]).toContain('<span>1.</span><span>วังโค</span>')
    expect(rows[1]).toContain('<span>2.</span><span>บางขันธ์</span>')
  })
})

describe('แผงปิดผลงานจริง: บรรทัดอ่านอย่างเดียวเฉพาะจุดรับที่แทรกก่อนจุดส่งของคันนี้', () => {
  const receiver = { id: 'T-B', tripDate: '2026-11-05', stops: [{ siteName: 'ไซต์ A' }, drop] }
  const trips = [sourceTrip([moved({ siteName: 'งานโยกปกติ' }), moved(shop)]), receiver]
  const incoming = incomingStopsForTrip(trips as never[], 'T-B')
  const view = transferDisplayOrder(receiver.stops, incoming)
  const displayOf = () => view

  it('ปุ่มของจุดในคันยังได้ index ที่บันทึก · จุดรับที่แทรกขึ้นเป็นบรรทัดอ่านอย่างเดียวพร้อมเลขบนจอ · งานโยกท้ายใบไม่แสดง', () => {
    const renderIncomingRow = new Function('React', 'displayOf', 'transferLabel', 'cn', 'TRANSFER_EDIT_AT_SOURCE', `${variable('renderIncomingRow')}return work`)(
      React, displayOf, transferLabel, (...c: unknown[]) => c.filter(Boolean).join(' '), TRANSFER_EDIT_AT_SOURCE,
    )
    const renderStopRow = vi.fn((_trip: unknown, stop: Raw, sIdx: number) => React.createElement('div', { key: sIdx }, `OWN:${sIdx}:${stop.siteName}`))
    const row = new Function('trip', 'renderStopRow', 'renderIncomingRow', 'incomingOf', `${callbackOf('displayOf(trip).order.map')}return work`)(
      receiver, renderStopRow, renderIncomingRow, () => incoming,
    )
    const html = renderToStaticMarkup(React.createElement('div', null, view.order.map(row)))
    expect(renderStopRow.mock.calls.map(c => c[2])).toEqual([0, 1])
    expect(html.indexOf('OWN:0:ไซต์ A')).toBeLessThan(html.indexOf('2. ดูโฮม'))
    expect(html.indexOf('2. ดูโฮม')).toBeLessThan(html.indexOf('OWN:1:ดอนเมือง'))
    expect(html).toContain('🔄 รับโยกงานต่อ · จาก กข 1 (สมชาย)')
    expect(html).toContain('📦 รับของ → ไปส่งต่อที่ ดอนเมือง')
    expect(html).toContain(TRANSFER_EDIT_AT_SOURCE)
    expect(html).not.toContain('งานโยกปกติ')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('⚠️')
  })
})
