import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildDriverTicket } from '@/server/driverTicket'
import { validCoordinates } from '@/lib/tripCoordinateSync'
import { transferDisplayOrder, transferLabel, type TransferFields, type TransferLabel } from '@/lib/transfer'

const pageSource = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function compiledCallback(callee: string, name: string) {
  let callback: ts.Expression | undefined
  function find(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.getText(pageSource) === callee) callback = node.arguments[0]
    ts.forEachChild(node, find)
  }
  find(pageSource)
  if (!callback) throw new Error(`${callee} not found`)
  return ts.transpileModule(`const ${name} = ${callback.getText(pageSource)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
}

// เรนเดอร์การ์ดจุดจริงของใบงานคนขับ (callback ของ trip.stops.map) โดยไม่ต้องบูต Firebase
// ป้าย/เลขข้อคิดจากลำดับบนจอตัวจริง (transferDisplayOrder) ของจุดในคัน + งานที่โยกเข้ามา เหมือนหน้าใบงาน
function stopCards(trip: { stops: Record<string, unknown>[] }, withTransferTag = false, incoming: TransferFields[] = []) {
  const compiled = compiledCallback('trip.stops?.map', 'renderCard')
  const icon = () => React.createElement('span')
  // withTransferTag: ใช้ป้ายรับ-ส่งตัวจริงของใบงาน (ตรวจว่าจุดที่ไม่ต้องไปไม่ขึ้นป้าย) · WARN: = มีคำเตือนที่คนขับจะเห็น
  const tag = withTransferTag ? ({ label }: { label: TransferLabel }) => React.createElement('span', null, `TAG:${label.text}${label.warning ? ` WARN:${label.warning}` : ''}`) : () => null
  const view = transferDisplayOrder(trip.stops as TransferFields[], incoming)
  const renderCard = new Function('React', 'trip', 'transferLabel', 'transferPeers', 'ownPos', 'TransferTag', 'validCoordinates', 'Navigation', 'User', 'Phone', 'Info', 'FileText', `${compiled}; return renderCard`)(
    React, trip, withTransferTag ? transferLabel : () => null, view.peers, view.ownPos, tag, validCoordinates, icon, icon, icon, icon, icon,
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

  it('งานรับของไปส่งต่อ: จุดรับที่โยกมาจากคันอื่นขึ้นก่อนจุดส่ง — การ์ดจุดส่งได้เลขตามลำดับบนจอ ไม่มีคำเตือนลำดับ (ผ่านข้อมูลใบงานจริงจาก server)', () => {
    const receiver = { id: 'T-B', tripDate: '2026-11-05', driverId: 'D-B', stops: [
      { siteName: 'ไซต์ A' },
      { siteName: 'ดอนเมือง', transferRole: 'drop', transferId: 'tf_1' },
    ] }
    const source = { id: 'T-A', tripDate: '2026-11-05', driverId: 'D-A', driverName: 'สมชาย', vehiclePlate: 'กข 1', stops: [
      { siteName: 'ดูโฮม', outcome: 'reassigned', reassignedToTripId: 'T-B', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง' },
    ] }
    const ticket = buildDriverTicket(receiver, [receiver, source], '')
    expect(ticket.incoming).toHaveLength(1) // ต้องมีงานโยกเข้าจริง ไม่งั้นเคสนี้ไม่ได้ตรวจลำดับใหม่
    const [site, drop] = stopCards(ticket.trip, true, ticket.incoming)
    // ไซต์ A = 1 · ดูโฮม (โยกเข้า) = 2 · ดอนเมือง = 3
    expect(site).toContain('>1</div>')
    expect(drop).toContain('>3</div>')
    expect(drop).toContain('TAG:🏁 ส่งของที่รับจาก ดูโฮม')
    expect(drop).not.toContain('WARN:')
  })

  it('ใบงานคนขับ: จุดรับที่แทรกก่อนจุดส่งอยู่ในรายการหลัก (กรอบรับงานต่อ) ไม่อยู่ในกล่องด้านบน · งานโยกอื่นอยู่ในกล่องเหมือนเดิม', () => {
    const P = { siteName: 'ดูโฮม', transferRole: 'pickup', transferId: 'tf_1' } as const
    const D = { siteName: 'ดอนเมือง', transferRole: 'drop', transferId: 'tf_1' } as const
    const view = transferDisplayOrder([{ siteName: 'ไซต์ A' }, D], [{ siteName: 'งานโยกปกติ' }, P])
    const boxed = new Function('view', `${compiledCallback('view.order.filter', 'keep')}; return view.order.filter(keep)`)(view) as { index: number }[]
    expect(boxed.map(e => e.index)).toEqual([0])
    const icon = () => React.createElement('span')
    const ownCards = ['OWN:ไซต์ A', 'OWN:ดอนเมือง'].map(text => React.createElement('section', { key: text }, text))
    const incomingCards = ['INC:งานโยกปกติ', 'INC:ดูโฮม'].map(text => React.createElement('div', { key: text }, text))
    const row = new Function('React', 'ownCards', 'incomingCards', 'Repeat', `${compiledCallback('view.order.map', 'row')}; return row`)(React, ownCards, incomingCards, icon)
    const html = renderToStaticMarkup(React.createElement('div', null, view.order.map(row)))
    expect(html.indexOf('OWN:ไซต์ A')).toBeLessThan(html.indexOf('INC:ดูโฮม'))
    expect(html.indexOf('INC:ดูโฮม')).toBeLessThan(html.indexOf('OWN:ดอนเมือง'))
    expect(html).toContain('รับงานต่อ — โยกมาให้คันนี้')
    expect(html).not.toContain('INC:งานโยกปกติ')
  })

  it('จุดปกติ / ส่งตามแผน ยังมีปุ่มนำทาง ไม่มีป้าย', () => {
    for (const html of stopCards({ stops: [{ siteName: 'A' }, { siteName: 'B', outcome: 'delivered', lat: 13.7, lng: 100.5 }] })) {
      expect(html).toContain(NAV)
      expect(html).not.toContain('⏭️')
    }
  })
})
