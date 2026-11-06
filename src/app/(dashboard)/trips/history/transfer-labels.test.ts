import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { incomingStopsForTrip } from '@/lib/calculations'
import { isInactiveStop, isTransferStop, syncDropsInTripEdit, TRANSFER_EDIT_AT_SOURCE, TRANSFER_WARNING, transferDisplayOrder, transferLabel, transferMissingWarning, transferStopName, transferTagStyle } from '@/lib/transfer'
import { cn } from '@/lib/utils'
import { isOneOffJobStop, jobSetLabel, jobSetMissingWarning, jobSetTagStyle } from '@/lib/sequence'

// ป้ายรับ-ส่งในหน้าประวัติ — คอมไพล์โค้ดจริงของหน้า (ไม่บูต Firebase) แล้วเรนเดอร์เป็น HTML
const read = (file: string) => ts.createSourceFile('page.tsx', readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const listSource = read('./page.tsx')
const detailSource = read('./[tripId]/page.tsx')
const compile = (name: string, code: string) => ts.transpileModule(`const ${name} = ${code}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText

/** callback ของ `<callee>(...)` ที่อยู่ใน JSX ({...}) และมีข้อความ `mustInclude` — ต้องเจอตัวเดียวพอดี (ในไฟล์มี .map ชื่อเดียวกันหลายที่) */
function jsxCallback(source: ts.SourceFile, callee: string, mustInclude: string) {
  const found: ts.Expression[] = []
  function find(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === callee && ts.isJsxExpression(node.parent) && node.arguments[0].getText(source).includes(mustInclude)) found.push(node.arguments[0])
    ts.forEachChild(node, find)
  }
  find(source)
  if (found.length !== 1) throw new Error(`${callee} (${mustInclude}): found ${found.length}`)
  return compile('render', found[0].getText(source))
}
function declaration(source: ts.SourceFile, name: string) {
  let value: ts.Expression | undefined
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!value) throw new Error(`${name} missing`)
  return compile('work', value.getText(source))
}

type Stop = Record<string, unknown>
const pickup = (siteName: string, extra: Stop = {}): Stop => ({ siteName, transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง', cargoDetails: 'ปูน 10 ถุง', ...extra })
const drop = (extra: Stop = {}): Stop => ({ siteName: 'ดอนเมือง', transferRole: 'drop', transferId: 'tf_1', cargoDetails: 'ส่งของที่รับจาก วังโค: ปูน 10 ถุง', ...extra })
const normal = (siteName: string): Stop => ({ siteName, cargoDetails: 'งานปกติ' })
const trip = (id: string, stops: Stop[], extra: Stop = {}) => ({ id, tripId: id, tripDate: '2026-11-05', status: 'Planned', driverName: `คนขับ ${id}`, vehiclePlate: `ทะเบียน ${id}`, stops, ...extra })

// ---------- หน้ารายการประวัติ (page.tsx) ----------

/** transferViewFor ตัวจริงของหน้า — trips = ทริปที่หน้าโหลดมา (ทุกวัน ทุกสถานะ) */
function listViewFor(trips: unknown[]) {
  const incoming = vi.fn(incomingStopsForTrip)
  const work = new Function('trips', 'isOneOffJobStop', 'incomingStopsForTrip', 'transferDisplayOrder', `${declaration(listSource, 'transferViewFor')}return work`)(
    trips, isOneOffJobStop, incoming, transferDisplayOrder,
  ) as (tripId: string, stops: Stop[]) => { peers: Stop[]; ownPos: number[] }
  return { viewFor: work, incoming }
}

/** การ์ดจุดในหน้าต่าง "ใบงาน" (พิมพ์ให้คนขับ) — ป้ายคิดจากจุดของทริปที่เลือกเท่านั้น · ส่ง trips/transferViewFor ของหน้าไปด้วย ถ้าโค้ดกลับไปนับงานโยกเข้า เทสต์จะเห็น */
function worksheet(selectedTrip: { id: string; stops: Stop[] }, trips: unknown[] = [selectedTrip]) {
  const { viewFor } = listViewFor(trips)
  const render = new Function('React', 'selectedTrip', 'trips', 'transferViewFor', 'jobSetLabel', 'jobSetTagStyle', 'isInactiveStop', 'RequestTimingBadge', `${jsxCallback(listSource, 'selectedTrip?.stops?.map', 'RequestTimingBadge')}; return render`)(
    React, selectedTrip, trips, viewFor, jobSetLabel, jobSetTagStyle, isInactiveStop, () => null,
  ) as (stop: Stop, idx: number) => React.ReactElement
  return selectedTrip.stops.map((stop, idx) => renderToStaticMarkup(render(stop, idx)))
}

/** editOpenedPeers ตัวจริงของหน้า (ลิสต์ตอนเปิดหน้าต่างแก้ไข) */
const openedPeersFor = (editingTrip: { id: string; stops: Stop[] }, viewFor: unknown) =>
  new Function('isEditOpen', 'editingTrip', 'transferViewFor', `${declaration(listSource, 'editOpenedPeers')}return work`)(true, editingTrip, viewFor) as Stop[]

/** แถวจุดในหน้าต่างแก้ไขทริป — stops = จุดในฟอร์มตอนนี้ (เช่น หลังกดลบ) · editingTrip.stops = จุดตอนเปิดหน้าต่าง */
function editRows(editingTrip: { id: string; stops: Stop[] }, stops: Stop[], trips: unknown[] = [editingTrip], originalStopIndexes: (number | null)[] = stops.map((_, i) => i)) {
  const { viewFor } = listViewFor(trips)
  const editFormData = { stops, originalStopIndexes, vehicleId: '', driverId: '', note: '' }
  const editView = new Function('isEditOpen', 'editingTrip', 'editFormData', 'transferViewFor', `${declaration(listSource, 'editView')}return work`)(true, editingTrip, editFormData, viewFor)
  const editOpenedPeers = openedPeersFor(editingTrip, viewFor)
  const editDropSync = new Function('isEditOpen', 'editingTrip', 'editFormData', 'syncDropsInTripEdit', `${declaration(listSource, 'editDropSync')}return work`)(true, editingTrip, editFormData, syncDropsInTripEdit)
  const stub = (tag: string) => ({ children }: { children?: React.ReactNode }) => React.createElement(tag, null, children)
  const render = new Function('React', 'editFormData', 'setEditFormData', 'editView', 'editOpenedPeers', 'editDropSync', 'jobSetLabel', 'jobSetMissingWarning', 'isInactiveStop', 'cn', 'Textarea', 'Button', 'Trash2', `${jsxCallback(listSource, 'editFormData.stops.map', 'Textarea')}; return render`)(
    React, editFormData, vi.fn(), editView, editOpenedPeers, editDropSync, jobSetLabel, jobSetMissingWarning, isInactiveStop, cn, stub('textarea'), stub('button'), stub('i'),
  ) as (stop: Stop, idx: number) => React.ReactElement
  return stops.map((stop, idx) => renderToStaticMarkup(render(stop, idx)))
}

/** บรรทัดเตือนใต้รายการจุดในหน้าต่างแก้ไข สำหรับงานที่คันอื่นโยกเข้ามา (ไม่มีแถวของตัวเองในหน้าต่างนี้) */
function editIncoming(editingTrip: { id: string; stops: Stop[] }, stops: Stop[], trips: unknown[] = [editingTrip]) {
  const { viewFor } = listViewFor(trips)
  const editFormData = { stops, originalStopIndexes: stops.map(() => null), vehicleId: '', driverId: '', note: '' }
  const editView = new Function('isEditOpen', 'editingTrip', 'editFormData', 'transferViewFor', `${declaration(listSource, 'editView')}return work`)(true, editingTrip, editFormData, viewFor) as { incomingPos: number[] }
  const render = new Function('React', 'editView', 'editOpenedPeers', 'jobSetMissingWarning', 'transferStopName', 'TRANSFER_EDIT_AT_SOURCE', `${jsxCallback(listSource, 'editView?.incomingPos.map', 'TRANSFER_EDIT_AT_SOURCE')}; return render`)(
    React, editView, openedPeersFor(editingTrip, viewFor), jobSetMissingWarning, transferStopName, TRANSFER_EDIT_AT_SOURCE,
  ) as (pos: number, i: number) => React.ReactElement | null
  return editView.incomingPos.map(render).filter((el): el is React.ReactElement => !!el).map(el => renderToStaticMarkup(el))
}

describe('หน้าประวัติ — ตัวคิดลิสต์ป้าย (transferViewFor)', () => {
  const receiver = trip('T-B', [normal('ไซต์ A'), drop()])
  const moved = pickup('ดูโฮม', { outcome: 'reassigned', reassignedToTripId: 'T-B' })

  it('งานที่คันอื่นโยกเข้ามาเรียงแบบใบสรุป: จุดรับที่โยกมาอยู่ก่อนจุดส่ง', () => {
    const { viewFor } = listViewFor([receiver, trip('T-A', [moved])])
    const view = viewFor('T-B', receiver.stops)
    expect(view.peers.map(p => p.siteName)).toEqual(['ไซต์ A', 'ดูโฮม', 'ดอนเมือง'])
    expect(view.ownPos).toEqual([0, 2])
  })

  it('ไม่นับงานจากทริปที่ยกเลิก (ใบสรุปก็ไม่นับ)', () => {
    const { viewFor } = listViewFor([receiver, trip('T-A', [moved], { status: 'Cancelled' })])
    expect(viewFor('T-B', receiver.stops).peers.map(p => p.siteName)).toEqual(['ไซต์ A', 'ดอนเมือง'])
  })

  it('ทริปที่ไม่มีงานรับ-ส่ง → คืนจุดเดิม ไม่ไล่หางานโยกเข้าจากทุกทริป', () => {
    const plain = trip('T-C', [normal('ไซต์ A'), normal('ไซต์ B')])
    const { viewFor, incoming } = listViewFor([plain, trip('T-D', [{ ...normal('ไซต์ X'), outcome: 'reassigned', reassignedToTripId: 'T-C' }])])
    const view = viewFor('T-C', plain.stops)
    expect(incoming).not.toHaveBeenCalled()
    expect(view.peers).toEqual(plain.stops)
    expect(view.ownPos).toEqual([0, 1])
  })
})

describe('หน้าประวัติ — หน้าต่าง "ใบงาน" (พิมพ์ให้คนขับ)', () => {
  it('จุดรับ/จุดส่งขึ้นป้ายสีเดียวกับใบสรุปที่พิมพ์ ไม่มีคำเตือน', () => {
    const [p, d] = worksheet(trip('T-1', [pickup('วังโค'), drop()]))
    expect(p).toContain('📦 รับของ → ไปส่งต่อที่ ดอนเมือง')
    expect(p).toContain('background:#ffedd5')
    expect(d).toContain('🏁 ส่งของที่รับจาก วังโค')
    expect(d).toContain('background:#dcfce7')
    for (const html of [p, d]) expect(html).not.toContain('⚠️')
  })

  it('จุดรับที่เลื่อนวันไม่มีป้าย (กันคนขับไปรับของที่ไม่ต้องไป) · จุดส่งยังมีป้าย ไม่พิมพ์คำเตือน/คำอธิบายคนขับ', () => {
    const [p, d] = worksheet(trip('T-1', [pickup('วังโค', { outcome: 'postponed' }), drop()]))
    expect(p).toContain('วังโค')
    expect(p).not.toContain('📦')
    expect(d).toContain('🏁 ส่งของที่รับจาก วังโค')
    expect(d).not.toContain('⚠️')
    expect(d).not.toContain('ถามคนจัดรถ')
    expect(d).not.toContain(TRANSFER_WARNING.pickupMissing)
  })

  it('รับ 2 ร้าน ร้านหนึ่งโยกไปคันอื่น → ไม่พิมพ์ "ของจาก ... ไม่ได้มากับเที่ยวนี้"', () => {
    const [p1, p2, d] = worksheet(trip('T-1', [pickup('วังโค', { outcome: 'reassigned' }), pickup('ดูโฮม'), drop()]))
    expect(p1).not.toContain('📦')
    expect(p2).toContain('📦 รับของ → ไปส่งต่อที่ ดอนเมือง')
    expect(d).toContain('🏁 ส่งของที่รับจาก วังโค, ดูโฮม')
    expect(d).not.toContain('ไม่ได้มากับเที่ยวนี้')
  })

  it('จุดส่งของคันนี้ + จุดรับที่โยกมาจากคันอื่น → ป้ายคิดจากจุดของทริปนี้เท่านั้น ไม่เอ่ยชื่อร้านที่ไม่มีแถวในใบ (ผลตรวจรวม L1)', () => {
    // ใบนี้ไม่พิมพ์งานโยกเข้า — เดิมป้ายขึ้น "ส่งของที่รับจาก ดูโฮม" แต่ไม่มีแถวดูโฮม · หน้ารายละเอียดทริปก็คิดแบบนี้
    const receiver = trip('T-B', [normal('ไซต์ A'), drop()])
    const [site, d] = worksheet(receiver, [receiver, trip('T-A', [pickup('ดูโฮม', { outcome: 'reassigned', reassignedToTripId: 'T-B' })])])
    expect(site).not.toContain('🏁')
    expect(d).toContain('🏁 จุดส่งของ')
    expect(d).not.toContain('ดูโฮม')
    expect(d).not.toContain('⚠️')
    expect(d).not.toContain('ไปรับของ')
    expect(d).not.toContain(TRANSFER_WARNING.pickupMissing)
  })

  it('ทริปปกติไม่มีป้าย', () => {
    // (เดิมมีเช็ก "ปิดหน้าต่างแล้วไม่คิดป้าย" ของ worksheetView ซึ่งกันการไล่งานโยกเข้าจากทุกทริป — ใบนี้ไม่อ่านทริปอื่นแล้ว จึงไม่มีตัวกั้นนั้น)
    for (const html of worksheet(trip('T-1', [normal('ไซต์ A'), normal('ไซต์ B')]))) {
      expect(html).not.toContain('📦')
      expect(html).not.toContain('🏁')
    }
  })
})

describe('หน้าประวัติ — หน้าต่างแก้ไขทริป', () => {
  it('ลบจุดรับแล้ว จุดส่งขึ้นเตือน "จุดรับไม่อยู่ในเที่ยวนี้" ทันที (ป้ายเขียว)', () => {
    const [d] = editRows(trip('T-1', [pickup('วังโค'), drop()]), [drop()])
    expect(d).toContain('🏁 จุดส่งของ')
    expect(d).toContain(`⚠️ ${TRANSFER_WARNING.pickupMissing}`)
    expect(d).toContain('bg-emerald-500/15')
  })

  it('ลบจุดส่งแล้ว จุดรับขึ้นเตือน "จุดส่งไม่อยู่ในเที่ยวนี้" (ป้ายส้ม)', () => {
    const [p] = editRows(trip('T-1', [pickup('วังโค'), drop()]), [pickup('วังโค')])
    expect(p).toContain('📦 รับของ → ไปส่งต่อที่ ดอนเมือง')
    expect(p).toContain(`⚠️ ${TRANSFER_WARNING.dropMissing}`)
    expect(p).toContain('bg-orange-500/15')
  })

  it('ครบคู่ → มีป้าย ไม่มีเตือน · ลำดับผิดไม่เตือน (หน้าต่างนี้สลับลำดับไม่ได้)', () => {
    for (const stops of [[pickup('วังโค'), drop()], [drop(), pickup('วังโค')]]) {
      const rows = editRows(trip('T-1', stops), stops)
      expect(rows.join('')).toContain('📦')
      expect(rows.join('')).toContain('🏁')
      for (const html of rows) expect(html).not.toContain('⚠️')
    }
  })

  it('จุดรับโยกมาจากคันอื่น → นับว่าไปกับเที่ยวนี้ ไม่เตือนจุดส่ง', () => {
    const receiver = trip('T-B', [drop()])
    const [d] = editRows(receiver, receiver.stops, [receiver, trip('T-A', [pickup('ดูโฮม', { outcome: 'reassigned', reassignedToTripId: 'T-B' })])])
    expect(d).toContain('🏁 ส่งของที่รับจาก ดูโฮม')
    expect(d).not.toContain('⚠️')
  })

  it('จุดรับที่เลื่อนแล้วไม่มีป้าย · จุดส่งไม่ขึ้น "ของจาก ... ไม่ได้มา" (เตือนเฉพาะจุดคู่หายจากเที่ยว)', () => {
    const stops = [pickup('วังโค', { outcome: 'postponed' }), pickup('ดูโฮม'), drop()]
    const [p1, p2, d] = editRows(trip('T-1', stops), stops)
    expect(p1).not.toContain('📦')
    expect(p2).toContain('📦')
    expect(d).toContain('🏁')
    expect(d).not.toContain('⚠️')
  })

  it('จุดคู่ยังอยู่ในลิสต์แต่เลื่อน/โยกออกแล้ว (รับร้านเดียว) → ไม่เตือน "ไม่อยู่ในเที่ยวนี้" · ลบจุดนั้นออกจากฟอร์มแล้วค่อยเตือน', () => {
    // หน้าต่างนี้ไม่มีป้ายเลื่อน/โยกบอกเหตุผล — เห็นชื่อร้านในลิสต์แต่ระบบบอกว่าไม่อยู่ คนจัดรถจะนึกว่าข้อมูลค้างแล้วลบทิ้ง
    const postponed = [pickup('วังโค', { outcome: 'postponed' }), drop()]
    const [p, d] = editRows(trip('T-1', postponed), postponed)
    expect(p).not.toContain('📦')
    expect(d).toContain('🏁 ส่งของที่รับจาก วังโค')
    expect(d).not.toContain('⚠️')
    const movedDrop = [drop({ outcome: 'reassigned' }), pickup('วังโค')]
    const [d2, p2] = editRows(trip('T-2', movedDrop), movedDrop)
    expect(d2).not.toContain('🏁')
    expect(p2).toContain('📦 รับของ → ไปส่งต่อที่ ดอนเมือง')
    expect(p2).not.toContain('⚠️')
    // ลบจุดที่เลื่อน/โยกแล้วออกจากฟอร์ม = จุดคู่หายจากเที่ยวจริง → เตือน
    expect(editRows(trip('T-1', postponed), [drop()], undefined, [1])[0]).toContain(`⚠️ ${TRANSFER_WARNING.pickupMissing}`)
    expect(editRows(trip('T-2', movedDrop), [pickup('วังโค')], undefined, [1])[0]).toContain(`⚠️ ${TRANSFER_WARNING.dropMissing}`)
  })

  it('รับ 2 ร้าน ร้านหนึ่งเลื่อน/โยกออกแล้ว → ลบร้านที่ยังไปกับเที่ยวออกจากฟอร์ม จุดส่งต้องเตือน "จุดรับไม่อยู่ในเที่ยวนี้" (ผลตรวจรวม F1)', () => {
    for (const outcome of ['postponed', 'reassigned']) {
      const opened = trip('T-1', [pickup('วังโค', { outcome }), pickup('ดูโฮม'), drop()])
      // ตอนเปิดหน้าต่าง ดูโฮมยังไปกับเที่ยว = ไม่เตือน
      expect(editRows(opened, opened.stops)[2]).not.toContain('⚠️')
      const [p, d] = editRows(opened, [opened.stops[0], opened.stops[2]], undefined, [0, 2])
      expect(p).not.toContain('📦')
      expect(d).toContain('🏁 ส่งของที่รับจาก วังโค')
      expect(d).toContain(`⚠️ ${TRANSFER_WARNING.pickupMissing}`)
    }
  })

  it('งานจุดส่งที่โยกเข้ามา + จุดรับของคันนี้ 2 ร้าน (ร้านหนึ่งเลื่อนแล้ว) → ลบร้านที่ยังไปกับเที่ยว ใต้รายการต้องเตือนงานโยกเข้า (ผลตรวจรวม F1)', () => {
    const receiver = trip('T-B', [pickup('วังโค', { outcome: 'postponed' }), pickup('ดูโฮม')])
    const trips = [receiver, trip('T-A', [drop({ outcome: 'reassigned', reassignedToTripId: 'T-B' })])]
    expect(editIncoming(receiver, receiver.stops, trips)).toEqual([])
    const [line, ...rest] = editIncoming(receiver, [receiver.stops[0]], trips)
    expect(rest).toEqual([])
    expect(line).toContain(`⚠️ งานที่โยกเข้ามา ดอนเมือง (จุดส่ง): ${TRANSFER_WARNING.pickupMissing} · ${TRANSFER_EDIT_AT_SOURCE}`)
  })

  it('ลบจุดส่งที่มีจุดรับโยกเข้ามาจากคันอื่น → ใต้รายการขึ้นเตือนงานโยกเข้า + บอกให้แก้ที่คันต้นทาง', () => {
    const receiver = trip('T-B', [normal('ไซต์ A'), drop()])
    const trips = [receiver, trip('T-A', [pickup('ดูโฮม', { outcome: 'reassigned', reassignedToTripId: 'T-B' })])]
    // ตอนเปิดหน้าต่าง ครบคู่ = ไม่มีบรรทัดเตือน
    expect(editIncoming(receiver, receiver.stops, trips)).toEqual([])
    const [line, ...rest] = editIncoming(receiver, [normal('ไซต์ A')], trips)
    expect(rest).toEqual([])
    expect(line).toContain(`⚠️ งานที่โยกเข้ามา ดูโฮม (จุดรับ): ${TRANSFER_WARNING.dropMissing} · ${TRANSFER_EDIT_AT_SOURCE}`)
    // แถวที่เหลือในฟอร์ม (งานปกติ) ไม่มีป้าย
    expect(editRows(receiver, [normal('ไซต์ A')], trips, [0])[0]).not.toContain('🏁')
  })

  it('งานโยกเข้าที่ไม่ใช่งานรับ-ส่ง / ทริปที่ไม่มีงานรับ-ส่งเลย → ไม่มีบรรทัดเตือน', () => {
    const receiver = trip('T-B', [normal('ไซต์ A'), drop()])
    const plainJob = { ...normal('ไซต์ X'), outcome: 'reassigned', reassignedToTripId: 'T-B' }
    expect(editIncoming(receiver, [normal('ไซต์ A')], [receiver, trip('T-A', [plainJob])])).toEqual([])
    const plain = trip('T-C', [normal('ไซต์ A')])
    expect(editIncoming(plain, plain.stops, [plain, trip('T-A', [pickup('ดูโฮม', { outcome: 'reassigned', reassignedToTripId: 'T-C' })])])).toEqual([])
  })

  it('จุดปกติไม่มีป้าย', () => {
    for (const html of editRows(trip('T-1', [normal('ไซต์ A')]), [normal('ไซต์ A')])) {
      expect(html).not.toContain('📦')
      expect(html).not.toContain('🏁')
    }
  })

  it('แก้ของที่จุดรับ → ใต้จุดรับบอกว่ากดบันทึกแล้วจะแก้บรรทัดของที่จุดส่งให้ (จุดส่งอยู่เที่ยวนี้เท่านั้น)', () => {
    const hint = 'กดบันทึกแล้วระบบจะแก้บรรทัดของที่จุดส่งให้'
    const opened = trip('T-1', [pickup('วังโค'), drop()])
    const [p, d] = editRows(opened, [pickup('วังโค', { cargoDetails: 'ปูน 15 ถุง' }), drop()])
    expect(p).toContain(hint)
    expect(d).not.toContain(hint)
    // ยังไม่แก้ / จุดส่งไม่อยู่ในเที่ยว / ทริปปกติ = ไม่บอก
    for (const html of editRows(opened, opened.stops)) expect(html).not.toContain(hint)
    const alone = trip('T-2', [pickup('วังโค')])
    expect(editRows(alone, [pickup('วังโค', { cargoDetails: 'ปูน 15 ถุง' })])[0]).not.toContain(hint)
    const plain = trip('T-3', [normal('ไซต์ A')])
    expect(editRows(plain, [{ ...normal('ไซต์ A'), cargoDetails: 'แก้' }])[0]).not.toContain(hint)
  })
})

// ---------- หน้ารายละเอียดทริป ([tripId]/page.tsx) — ใช้แค่จุดของทริปนี้ ไม่อ่านทริปอื่น ----------

function detailScreen(t: { stops: Stop[] }) {
  const icon = () => React.createElement('span')
  const Badge = ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children)
  const render = new Function('React', 'trip', 'Badge', 'User', 'Phone', 'Info', 'cn', 'jobSetLabel', 'isInactiveStop', `${jsxCallback(detailSource, '(trip.stops || []).map', 'รายการสินค้า')}; return render`)(
    React, t, Badge, icon, icon, icon, cn, jobSetLabel, isInactiveStop,
  ) as (stop: Stop, index: number) => React.ReactElement
  return t.stops.map((stop, index) => renderToStaticMarkup(render(stop, index)))
}
function detailPrint(t: { stops: Stop[] }) {
  const render = new Function('React', 'trip', 'getStopLocation', 'jobSetLabel', 'isInactiveStop', 'jobSetTagStyle', `${jsxCallback(detailSource, '(trip.stops || []).map', 'getStopLocation')}; return render`)(
    React, t, () => 'ที่อยู่', jobSetLabel, isInactiveStop, jobSetTagStyle,
  ) as (stop: Stop, index: number) => React.ReactElement
  return t.stops.map((stop, index) => renderToStaticMarkup(render(stop, index)))
}

describe('หน้ารายละเอียดทริป — บนจอและใบพิมพ์', () => {
  it.each([['บนจอ', detailScreen], ['ใบพิมพ์', detailPrint]] as const)('%s: จุดรับ/จุดส่งมีป้าย ข้อความอย่างเดียว ไม่มีคำเตือน', (_, render) => {
    const [p, d] = render(trip('T-1', [pickup('วังโค'), drop()]))
    expect(p).toContain('📦 รับของ → ไปส่งต่อที่ ดอนเมือง')
    expect(d).toContain('🏁 ส่งของที่รับจาก วังโค')
    for (const html of [p, d]) expect(html).not.toContain('⚠️')
  })

  it.each([['บนจอ', detailScreen], ['ใบพิมพ์', detailPrint]] as const)('%s: จุดส่งที่จุดรับอยู่คันอื่น ไม่เตือน "จุดรับไม่อยู่ในเที่ยวนี้" (หน้านี้ไม่รู้งานโยกเข้า)', (_, render) => {
    const [d] = render(trip('T-B', [drop()]))
    expect(d).toContain('🏁 จุดส่งของ')
    expect(d).not.toContain('⚠️')
    expect(d).not.toContain(TRANSFER_WARNING.pickupMissing)
  })

  it.each([['บนจอ', detailScreen], ['ใบพิมพ์', detailPrint]] as const)('%s: จุดรับที่เลื่อนวันไม่มีป้าย · จุดส่งยังมี ไม่พิมพ์คำอธิบายคนขับ', (_, render) => {
    const [p, d] = render(trip('T-1', [pickup('วังโค', { outcome: 'postponed' }), drop()]))
    expect(p).not.toContain('📦 รับของ')
    expect(d).toContain('🏁 ส่งของที่รับจาก วังโค')
    expect(d).not.toContain('⚠️')
    expect(d).not.toContain('ถามคนจัดรถ')
  })

  it.each([['บนจอ', detailScreen], ['ใบพิมพ์', detailPrint]] as const)('%s: ทริปปกติไม่มีป้าย', (_, render) => {
    for (const html of render(trip('T-1', [normal('ไซต์ A'), normal('ไซต์ B')]))) {
      expect(html).not.toContain('📦 รับของ')
      expect(html).not.toContain('🏁')
    }
  })
})
