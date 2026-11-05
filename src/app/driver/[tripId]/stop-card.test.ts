import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildDriverTicket } from '@/server/driverTicket'
import { validCoordinates } from '@/lib/tripCoordinateSync'
import { transferLabel, type TransferLabel } from '@/lib/transfer'

// เรนเดอร์การ์ดจุดจริงของใบงานคนขับ (callback ของ trip.stops.map) โดยไม่ต้องบูต Firebase
function stopCards(trip: { stops: Record<string, unknown>[] }, withTransferTag = false) {
  const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let card: ts.Expression | undefined
  function find(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.getText(source) === 'trip.stops?.map') card = node.arguments[0]
    ts.forEachChild(node, find)
  }
  find(source)
  if (!card) throw new Error('Stop card not found')
  const compiled = ts.transpileModule(`const renderCard = ${card.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  const icon = () => React.createElement('span')
  // withTransferTag: ใช้ป้ายรับ-ส่งตัวจริงของใบงาน (ตรวจว่าจุดที่ไม่ต้องไปไม่ขึ้นป้าย)
  const tag = withTransferTag ? ({ label }: { label: TransferLabel }) => React.createElement('span', null, `TAG:${label.text}`) : () => null
  const renderCard = new Function('React', 'trip', 'transferLabel', 'transferPeers', 'TransferTag', 'validCoordinates', 'Navigation', 'User', 'Phone', 'Info', 'FileText', `${compiled}; return renderCard`)(
    React, trip, withTransferTag ? transferLabel : () => null, trip.stops, tag, validCoordinates, icon, icon, icon, icon, icon,
  ) as (stop: unknown, index: number) => React.ReactElement
  return trip.stops.map((stop, index) => renderToStaticMarkup(renderCard(stop, index)))
}

const NAV = 'นำทางด้วย Google Maps'

describe('ใบงานคนขับ — จุดที่วันนี้ไม่ต้องไป', () => {
  it('จุดที่เลื่อนวัน: ไม่มีปุ่มนำทาง ขึ้น "เลื่อนไปวันอื่นแล้ว — วันนี้ไม่ต้องไปจุดนี้" (ผ่านข้อมูลใบงานจริงจาก server)', () => {
    const ticket = buildDriverTicket({ id: 'T-1', stops: [{ siteName: 'บางขันธ์', outcome: 'postponed', postponedToDate: '2026-11-07', lat: 14.1, lng: 100.6 }] }, [], '')
    const [html] = stopCards(ticket.trip)
    expect(html).not.toContain(NAV)
    expect(html).toContain('⏭️ เลื่อนไปวันอื่นแล้ว — วันนี้ไม่ต้องไปจุดนี้')
    expect(html).toContain('⏭️ เลื่อนไปวันอื่น')
  })

  it('ปฏิเสธ/โยก แต่ยังไม่มีคันรับ: ไม่มีปุ่มนำทาง ขึ้น "วันนี้ไม่ต้องไปจุดนี้" ไม่บอกเหตุผลภายใน', () => {
    const ticket = buildDriverTicket({ id: 'T-1', stops: [{ siteName: 'วังโค', outcome: 'driver-refused', outcomeReason: 'บอกไกล' }, { siteName: 'ดูโฮม', outcome: 'reassigned' }] }, [], '')
    for (const html of stopCards(ticket.trip)) {
      expect(html).not.toContain(NAV)
      expect(html).toContain('⏭️ วันนี้ไม่ต้องไปจุดนี้ — คนจัดรถเอาออกจากเที่ยวนี้แล้ว')
      expect(html).not.toContain('เลื่อนไปวันอื่น')
      expect(html).not.toContain('ปฏิเสธ')
      expect(html).not.toContain('บอกไกล')
    }
  })

  it('ลิงก์รุ่นเก่า (อ่านผลดิบจากทริป) เลื่อนวันก็ขึ้นป้ายเหมือนกัน', () => {
    const [html] = stopCards({ stops: [{ siteName: 'บางขันธ์', outcome: 'postponed' }] })
    expect(html).not.toContain(NAV)
    expect(html).toContain('เลื่อนไปวันอื่นแล้ว')
  })

  it('โยกให้คันอื่นแล้ว ยังขึ้นกรอบ "โยกให้ ..." แบบเดิม ไม่ขึ้นป้ายวันนี้ไม่ต้องไป', () => {
    const [html] = stopCards({ stops: [{ siteName: 'A', outcome: 'reassigned', reassignedToVehiclePlate: 'กข 1', reassignedToDriverName: 'สมชาย' }] })
    expect(html).toContain('✋ งานนี้โยกให้ สมชาย (กข 1) แล้ว — ไม่ต้องวิ่งจุดนี้')
    expect(html).not.toContain('⏭️')
    expect(html).not.toContain(NAV)
  })

  it('โยกให้คันอื่นแล้ว ผ่านข้อมูลใบงานจริงจาก server (not-delivered + ทะเบียน) ก็ขึ้นกรอบ "โยกให้ ..." เหมือนกัน', () => {
    const ticket = buildDriverTicket({ id: 'T-1', stops: [{ siteName: 'A', outcome: 'driver-refused', reassignedToVehiclePlate: 'กข 1', reassignedToDriverName: 'สมชาย' }] }, [], '')
    const [html] = stopCards(ticket.trip)
    expect(html).toContain('✋ งานนี้โยกให้ สมชาย (กข 1) แล้ว — ไม่ต้องวิ่งจุดนี้')
    expect(html).not.toContain('⏭️')
    expect(html).not.toContain(NAV)
  })

  it('งานรับของไปส่งต่อ: จุดรับที่เลื่อนวันไม่ขึ้นป้ายรับ-ส่ง ส่วนจุดส่งที่ยังไปยังขึ้นป้าย', () => {
    const ticket = buildDriverTicket({ id: 'T-1', stops: [
      { siteName: 'วังโค', outcome: 'postponed', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง' },
      { siteName: 'ดอนเมือง', transferRole: 'drop', transferId: 'tf_1' },
    ] }, [], '')
    const [pickup, drop] = stopCards(ticket.trip, true)
    expect(pickup).toContain('เลื่อนไปวันอื่นแล้ว')
    expect(pickup).not.toContain('TAG:')
    expect(drop).toContain('TAG:')
    expect(drop).toContain(NAV)
  })

  it('จุดปกติ / ส่งตามแผน ยังมีปุ่มนำทาง ไม่มีป้าย', () => {
    for (const html of stopCards({ stops: [{ siteName: 'A' }, { siteName: 'B', outcome: 'delivered', lat: 13.7, lng: 100.5 }] })) {
      expect(html).toContain(NAV)
      expect(html).not.toContain('⏭️')
    }
  })
})
