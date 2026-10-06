import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { incomingStopsForTrip, type IncomingJob } from './calculations'

// Render the actual receiving rows without booting Firebase or querying live trips.
function receivingRow(surface: 'summary' | 'driver') {
  const file = surface === 'summary' ? '../app/(dashboard)/daily-summary/page.tsx' : '../app/driver/[tripId]/page.tsx'
  const source = ts.createSourceFile('page.tsx', readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let row: ts.Expression | undefined
  function find(node: ts.Node) {
    if (surface === 'summary' && ts.isVariableDeclaration(node) && node.name.getText(source) === 'incomingRows' && node.initializer && ts.isCallExpression(node.initializer)) row = node.initializer.arguments[0]
    if (surface === 'driver' && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.getText(source) === 'incoming.map') row = node.arguments[0]
    ts.forEachChild(node, find)
  }
  find(source)
  if (!row) throw new Error(`Receiving row not found: ${surface}`)
  const compiled = ts.transpileModule(`const renderRow = ${row.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  const icon = () => React.createElement('span')
  return new Function('React', 'trip', 'stops', 'dateCell', 'driverCell', 'Navigation', 'FileText', `${compiled}; return renderRow`)(
    React, { id: 'receiver', stops: [] }, [], null, null, icon, icon,
  ) as (job: IncomingJob, index: number) => React.ReactElement
}

describe('dispatcher notes in actual receiving rows', () => {
  it.each(['summary', 'driver'] as const)('%s ไม่มีป้ายหมายเหตุหรือชื่อโดด ๆ เมื่อไม่มีข้อความ', (surface) => {
    const [job] = incomingStopsForTrip([{ id: 'source', stops: [{ reassignedToTripId: 'receiver', dispatcherName: 'ชื่อที่ไม่ควรขึ้นเดี่ยว ๆ' }] }], 'receiver')
    const html = renderToStaticMarkup(receivingRow(surface)(job, 0))
    expect(html).not.toContain('บันทึกจัดรถ:')
    expect(html).not.toContain('ชื่อที่ไม่ควรขึ้นเดี่ยว ๆ')
  })

  it.each(['summary', 'driver'] as const)('%s แสดงหมายเหตุรุ่นเก่าอย่างปลอดภัยพร้อมรายละเอียดงานเดิม', (surface) => {
    const [job] = incomingStopsForTrip([{
      id: 'source', stopNotes: { stop_0: 'โทรก่อนเข้า <script>alert("test")</script>' },
      stops: [{ siteName: 'ไซต์ทดสอบ', cargoDetails: 'เครื่องมือทดสอบ', requestTime: '08:30', reassignedToTripId: 'receiver', outcome: 'driver-refused' }],
    }], 'receiver')
    const html = renderToStaticMarkup(receivingRow(surface)(job, 0))
    expect(html).toContain('บันทึกจัดรถ: โทรก่อนเข้า &lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('(โดย')
    expect(html).not.toContain('ปฏิเสธ')
    expect(html).toContain('เครื่องมือทดสอบ')
    if (surface === 'driver') expect(html).toContain('https://www.google.com/maps/search/?api=1')
    else expect(html).toContain('08:30 น.')
  })

  it.each(['summary', 'driver'] as const)('%s แสดงหมายเหตุคนจัดรถและชื่อ', (surface) => {
    const [job] = incomingStopsForTrip([{
      id: 'source', stops: [{ siteName: 'ไซต์ทดสอบ', reassignedToTripId: 'receiver', note: 'ผู้ขอให้ส่งอุปกรณ์', dispatcherNote: 'โทรหาหน้างานก่อนเข้า\nใช้ประตูด้านหลัง', dispatcherName: 'ผู้จัดคิวทดสอบ' }],
    }], 'receiver')
    const html = renderToStaticMarkup(receivingRow(surface)(job, 0))
    expect(html).toContain('โทรหาหน้างานก่อนเข้า\nใช้ประตูด้านหลัง')
    expect(html).toContain('บันทึกจัดรถ:')
    expect(html).toContain('โดย ผู้จัดคิวทดสอบ')
    expect(html).toContain('whitespace-pre-line')
    expect(html).toContain('break-words')
    if (surface === 'summary') expect(html).toContain('หมายเหตุผู้ขอ: ผู้ขอให้ส่งอุปกรณ์')
  })
})
