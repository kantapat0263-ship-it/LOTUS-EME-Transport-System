import { describe, it, expect } from 'vitest'
import { activeTransferSet, applyPickupItemsEdit, buildDropDescription, dropLine, dropSyncNote, isInactiveStop, orderPickupsBeforeDrop, pickupEditMessage, postponedPickupNote, syncDropsInTripEdit, syncDropText, TRANSFER_EDIT_AT_SOURCE, TRANSFER_WARNING, transferDisplayOrder, transferLabel, transferMateReminder, transferMissingWarning, transferNoteForDriver, transferSetOutside, transferShapeProblem, transferStopFields, transferStopName, transferTagStyle, type TransferFields } from './transfer'

type S = TransferFields & { id: string; siteName: string }
const P = (id: string, group = 'g1', siteName = id): S => ({ id, transferRole: 'pickup', transferId: group, siteName, transferDropName: 'ดอนเมือง' })
const D = (id: string, group = 'g1', siteName = id): S => ({ id, transferRole: 'drop', transferId: group, siteName })
const N = (id: string): S => ({ id, siteName: id })
const ids = (items: { id: string }[]) => items.map(i => i.id).join(',')

describe('transferShapeProblem', () => {
  it('ใบปกติ (ไม่มี role) ผ่านเสมอ', () => {
    expect(transferShapeProblem([undefined])).toBeNull()
    expect(transferShapeProblem([undefined, undefined])).toBeNull()
  })
  it('รับ 1 ส่ง 1 / รับหลายจุดส่ง 1 ผ่าน', () => {
    expect(transferShapeProblem(['pickup', 'drop'])).toBeNull()
    expect(transferShapeProblem(['pickup', 'pickup', 'pickup', 'drop'])).toBeNull()
  })
  it('ผิดรูป → มีข้อความ', () => {
    expect(transferShapeProblem(['pickup'])).toContain('จุดส่ง')
    expect(transferShapeProblem(['drop'])).toContain('จุดรับ')
    expect(transferShapeProblem(['drop', 'pickup'])).toContain('1 จุด')
    expect(transferShapeProblem(['pickup', 'drop', 'drop'])).toContain('1 จุด')
    expect(transferShapeProblem(['pickup', undefined, 'drop'])).toContain('โหลดหน้าใหม่')
    expect(transferShapeProblem(['pickup', 'other', 'drop'])).toContain('โหลดหน้าใหม่')
  })
})

describe('buildDropDescription', () => {
  it('หนึ่งบรรทัดต่อจุดรับ + งานเพิ่มเติม', () => {
    expect(buildDropDescription([{ name: 'ดูโฮม', items: ' ปูนสกิม 10 ถุง ' }, { name: 'วานิช', items: 'ยางมะตอย' }], ' ท่อ EMT จากออฟฟิศ '))
      .toBe('ส่งของที่รับจาก ดูโฮม: ปูนสกิม 10 ถุง\nส่งของที่รับจาก วานิช: ยางมะตอย\nท่อ EMT จากออฟฟิศ')
  })
  it('ไม่มีงานเพิ่มเติม = ไม่มีบรรทัดว่างท้าย', () => {
    expect(buildDropDescription([{ name: 'TMT', items: 'เหล็ก' }], '  ')).toBe('ส่งของที่รับจาก TMT: เหล็ก')
  })
})

describe('orderPickupsBeforeDrop', () => {
  it('Google จัดจุดส่งไว้ก่อน → ย้ายไปต่อท้ายจุดรับตัวสุดท้าย จุดอื่นไม่ขยับ', () => {
    expect(ids(orderPickupsBeforeDrop([D('d'), N('x'), P('p'), N('y')]))).toBe('x,p,d,y')
    expect(ids(orderPickupsBeforeDrop([P('p1'), D('d'), N('x'), P('p2')]))).toBe('p1,x,p2,d')
  })
  it('ลำดับถูกอยู่แล้ว / ไม่มีงานรับ-ส่ง → เหมือนเดิม', () => {
    expect(ids(orderPickupsBeforeDrop([P('p'), N('x'), D('d')]))).toBe('p,x,d')
    expect(ids(orderPickupsBeforeDrop([N('a'), N('b')]))).toBe('a,b')
  })
  it('หลายกลุ่มแยกกันอิสระ', () => {
    const r = orderPickupsBeforeDrop([D('d1', 'g1'), D('d2', 'g2'), P('p2', 'g2'), P('p1', 'g1')]).map(i => i.id)
    expect(r.indexOf('p1')).toBeLessThan(r.indexOf('d1'))
    expect(r.indexOf('p2')).toBeLessThan(r.indexOf('d2'))
  })
  it('จุดส่งอยู่คนเดียว (จุดรับไปคันอื่น) → ไม่ขยับ', () => {
    expect(ids(orderPickupsBeforeDrop([D('d'), N('x')]))).toBe('d,x')
  })
  it('ไม่แก้ array ต้นฉบับ', () => {
    const input = [D('d'), P('p')]
    orderPickupsBeforeDrop(input)
    expect(ids(input)).toBe('d,p')
  })
})

describe('orderPickupsBeforeDrop: งานสลับของ 2 ใบ (Best → ดอนเมือง + ดอนเมือง → Best) ไม่วิ่งวนไปกลับ', () => {
  // ใบ A: รับที่ Best ส่งดอนเมือง · ใบ B: รับที่ดอนเมือง ส่ง Best
  const at = (s: S, siteId: string) => ({ ...s, siteId })
  const pA = at(P('pA', 'A'), 'best'), dA = at(D('dA', 'A'), 'dm'), pB = at(P('pB', 'B'), 'dm'), dB = at(D('dB', 'B'), 'best')
  const places = (items: { siteId: string }[]) => items.map(i => i.siteId).filter((s, i, all) => s !== all[i - 1]).join('→')
  it.each([
    [[pA, dB, dA, pB]], [[dB, pA, pB, dA]], [[dA, pB, pA, dB]], [[pB, dA, dB, pA]],
  ])('Google ให้ลำดับไหนมาก็ตาม → แวะแค่ 3 ช่วง และรับก่อนส่งทั้งสองใบ %#', input => {
    const r = orderPickupsBeforeDrop(input)
    expect(places(r).split('→')).toHaveLength(3)
    expect(r.indexOf(pA)).toBeLessThan(r.indexOf(dA))
    expect(r.indexOf(pB)).toBeLessThan(r.indexOf(dB))
  })
  it('จุดพิกัดเดียวกัน (ไม่มีรหัสไซต์) นับเป็นที่เดียวกัน', () => {
    const c = (s: S, lat: number) => ({ ...s, lat, lng: 100 })
    const r = orderPickupsBeforeDrop([c(D('dA', 'A'), 1), c(P('pB', 'B'), 1), c(P('pA', 'A'), 2), c(D('dB', 'B'), 2)])
    expect(ids(r)).toBe('pB,pA,dB,dA')
  })
  it('งานที่อยู่คนละที่ถัดจากจุดรับ → ไม่ข้าม (เหมือนเดิม)', () => {
    expect(ids(orderPickupsBeforeDrop([at(D('d'), 'site'), at(P('p'), 'shop'), at(N('x'), 'other')]))).toBe('p,d,x')
  })
})

describe('transferLabel', () => {
  it('อยู่เที่ยวเดียวกันครบ ลำดับถูก → ไม่มีเตือน', () => {
    const peers = [P('ดูโฮม'), N('ไซต์ A'), P('วานิช'), D('ดอนเมือง')]
    expect(transferLabel(peers, 0)).toEqual({ role: 'pickup', text: '📦 รับของ → ไปส่งต่อที่ ดอนเมือง' })
    expect(transferLabel(peers, 1)).toBeNull()
    expect(transferLabel(peers, 3)).toEqual({ role: 'drop', text: '🏁 ส่งของที่รับจาก ดูโฮม, วานิช' })
  })
  it('จุดส่งอยู่คันอื่น → ใช้ชื่อที่เก็บไว้ + เตือน', () => {
    expect(transferLabel([P('ดูโฮม')], 0)).toEqual({ role: 'pickup', text: '📦 รับของ → ไปส่งต่อที่ ดอนเมือง', warning: 'จุดส่งไม่อยู่ในเที่ยวนี้' })
  })
  it('จุดรับอยู่คันอื่น → เตือนที่จุดส่ง', () => {
    expect(transferLabel([D('ดอนเมือง')], 0)?.warning).toBe('จุดรับไม่อยู่ในเที่ยวนี้')
  })
  it('จุดรับที่โยกเข้ามาแสดงหลังจุดส่ง → เตือนลำดับทั้งสองฝั่ง', () => {
    const peers = [D('ดอนเมือง'), P('ดูโฮม')]
    expect(transferLabel(peers, 0)?.warning).toContain('ตรวจลำดับ')
    expect(transferLabel(peers, 1)?.warning).toContain('ตรวจลำดับ')
  })
  it('คนละกลุ่มไม่นับเป็นคู่กัน', () => {
    expect(transferLabel([P('a', 'g1'), D('b', 'g2')], 0)?.warning).toBe('จุดส่งไม่อยู่ในเที่ยวนี้')
  })
})

describe('transferLabel: จุดที่โยกออก/เลื่อน/ไม่ได้ทำ (ผลตรวจอิสระข้อ 1)', () => {
  it('จุดรับถูกโยกไปคันอื่น → จุดส่งในคันเดิมต้องเตือนว่าจุดรับไม่อยู่', () => {
    expect(transferLabel([{ ...P('ดูโฮม'), outcome: 'reassigned' }, D('ดอนเมือง')], 1)?.warning).toBe('จุดรับไม่อยู่ในเที่ยวนี้')
    expect(transferLabel([{ ...P('ดูโฮม'), outcome: 'postponed' }, D('ดอนเมือง')], 1)?.warning).toBe('จุดรับไม่อยู่ในเที่ยวนี้')
  })
  it('ตัวจุดที่โยกออกเองไม่มีคำเตือน (มีป้ายโยก/เลื่อนบอกแล้ว)', () => {
    expect(transferLabel([{ ...P('วานิช'), outcome: 'reassigned' }], 0)).toEqual({ role: 'pickup', text: '📦 รับของ → ไปส่งต่อที่ ดอนเมือง' })
  })
  it('ส่งแล้ว (delivered) / ใบงานคนขับ "not-delivered" ยังนับตามจริง', () => {
    expect(transferLabel([{ ...P('ดูโฮม'), outcome: 'delivered' }, D('ดอนเมือง')], 1)?.warning).toBeUndefined()
    expect(transferLabel([{ ...P('ดูโฮม'), outcome: 'not-delivered' }, D('ดอนเมือง')], 1)?.warning).toBe('จุดรับไม่อยู่ในเที่ยวนี้')
  })
})

describe('ใบสรุปหลังเลื่อน/ปฏิเสธ/โยกบางจุด (ผลตรวจหน้าใบสรุป ข้อ 2-3)', () => {
  it('จุดรับไม่มากับเที่ยวนี้เลย → คนขับเห็นข้อความกลาง ๆ ให้ถามก่อน (ไม่บอกว่าของมาจากคันอื่น)', () => {
    const label = transferLabel([{ ...P('วังโค'), outcome: 'postponed' }, D('ดอนเมือง')], 1)
    expect(label?.text).toBe('🏁 ส่งของที่รับจาก วังโค')
    expect(transferNoteForDriver(label)).toBe('จุดรับของงานนี้ไม่ได้ไปกับเที่ยวนี้ — ถามคนจัดรถก่อนไปว่าของอยู่ที่ไหน')
    expect(transferNoteForDriver(transferLabel([D('ดอนเมือง')], 0))).not.toContain('คันอื่น')
    // จุดคู่ยังอยู่ในใบงาน (แค่ถูกเลื่อน) — ข้อความต้องไม่บอกว่า "ไม่อยู่ในใบงาน" (ผลตรวจรอบ 2)
    expect(transferNoteForDriver(transferLabel([P('วังโค'), { ...D('ดอนเมือง'), outcome: 'postponed' }], 0))).toBe('จุดส่งของงานนี้ไม่ได้ไปกับเที่ยวนี้ — ถามคนจัดรถว่าเอาของไปไว้ที่ไหน')
  })
  it('จุดรับที่โยกเข้ามาต่อท้าย + มีร้านที่ไม่มา → เตือนทั้งลำดับและของที่ไม่มา (ไม่บังกัน)', () => {
    // คันนี้: วังโค, บางขันธ์ (เลื่อน), ดอนเมือง · ดูโฮมโยกเข้ามาจากคันอื่น (แสดงท้าย)
    const peers = [P('วังโค'), { ...P('บางขันธ์'), outcome: 'postponed' }, D('ดอนเมือง'), P('ดูโฮม')]
    const label = transferLabel(peers, 2)
    expect(label?.warning).toBe('จุดรับอยู่หลังจุดส่ง — ตรวจลำดับ · ของจาก บางขันธ์ ไม่ได้มากับเที่ยวนี้')
    expect(transferNoteForDriver(label)).toBe('ไปรับของที่จุดรับในใบงานนี้ก่อน แล้วค่อยมาส่งจุดนี้ · ของจาก บางขันธ์ ไม่ได้มากับเที่ยวนี้ — ส่งเฉพาะของที่รับมา')
    expect(transferNoteForDriver(transferLabel([D('ดอนเมือง'), P('ดูโฮม')], 0))).toBe('ไปรับของให้ครบก่อน แล้วค่อยมาส่งจุดนี้')
  })
  it('ร้านเดียวกันสองรายการ ไม่ได้ไปรายการหนึ่ง → ยังเตือน (บางรายการ) · จุดรับไม่มีชื่อ → "จุดรับ"', () => {
    expect(transferLabel([P('ดูโฮม'), { ...P('ดูโฮม'), outcome: 'driver-refused' }, D('ดอนเมือง')], 2)?.missingFrom).toEqual(['ดูโฮม (บางรายการ)'])
    expect(transferLabel([P('วังโค'), { ...P('x', 'g1', ''), outcome: 'postponed' }, D('ดอนเมือง')], 2)?.missingFrom).toEqual(['จุดรับ'])
    expect(transferLabel([P('x', 'g1', ''), { ...P('y', 'g1', ''), outcome: 'postponed' }, D('ดอนเมือง')], 2)?.missingFrom).toEqual(['จุดรับ (บางรายการ)'])
  })
  it('รับหลายร้าน มีร้านหนึ่งไม่ได้ไป → จุดส่งเตือนชื่อร้านนั้น ทั้งคนจัดรถและคนขับ', () => {
    const peers = [P('วังโค'), { ...P('บางขันธ์'), outcome: 'driver-refused' }, P('ดูโฮม'), D('ดอนเมือง')]
    const label = transferLabel(peers, 3)
    expect(label).toEqual({ role: 'drop', text: '🏁 ส่งของที่รับจาก วังโค, บางขันธ์, ดูโฮม', warning: 'ของจาก บางขันธ์ ไม่ได้มากับเที่ยวนี้', missingFrom: ['บางขันธ์'] })
    expect(transferNoteForDriver(label)).toBe('ของจาก บางขันธ์ ไม่ได้มากับเที่ยวนี้ — ส่งเฉพาะของที่รับมา')
  })
  it('จุดส่งเองถูกเลื่อน → ไม่เตือน (มีป้ายเลื่อนอยู่แล้ว)', () => {
    expect(transferLabel([{ ...P('บางขันธ์'), outcome: 'postponed' }, P('วังโค'), { ...D('ดอนเมือง'), outcome: 'postponed' }], 2)?.warning).toBeUndefined()
  })
})

describe('transferDisplayOrder (จุดรับที่โยกเข้ามาขึ้นก่อนจุดส่ง — แสดงผลอย่างเดียว)', () => {
  const shown = (v: { peers: { id: string }[] }) => ids(v.peers)
  // จุดของเที่ยวต้องเรียงตาม index ที่บันทึกเสมอ (ข้อ 9)
  const ownAscending = (v: { order: { kind: string; index: number }[] }) => {
    const own = v.order.filter(e => e.kind === 'own').map(e => e.index)
    expect(own).toEqual([...own].sort((a, b) => a - b))
  }

  it('ทริปปกติมีงานโยกเข้า → ลำดับ/เลขเหมือนเดิมทุกตำแหน่ง', () => {
    const own = [N('a'), N('b')], incoming = [N('x')]
    const v = transferDisplayOrder(own, incoming)
    expect(v.order).toEqual([{ kind: 'own', index: 0 }, { kind: 'own', index: 1 }, { kind: 'incoming', index: 0, inline: false }])
    expect(v.ownPos).toEqual([0, 1])
    expect(v.incomingPos).toEqual([2])
    expect(v.peers).toEqual([...own, ...incoming])
  })

  it('จุดรับโยกเข้ามา + จุดส่งอยู่ในคันนี้ → ขึ้นก่อนจุดส่ง ป้ายไม่มีคำเตือนลำดับ', () => {
    const v = transferDisplayOrder([N('a'), D('d')], [P('p')])
    expect(shown(v)).toBe('a,p,d')
    expect(v.ownPos).toEqual([0, 2])
    expect(v.incomingPos).toEqual([1])
    expect(v.order[1]).toEqual({ kind: 'incoming', index: 0, inline: true })
    expect(transferLabel(v.peers, 1)).toEqual({ role: 'pickup', text: '📦 รับของ → ไปส่งต่อที่ d' })
    expect(transferLabel(v.peers, 2)).toEqual({ role: 'drop', text: '🏁 ส่งของที่รับจาก p' })
    expect(transferNoteForDriver(transferLabel(v.peers, 2))).toBeNull()
  })

  it('รับหลายร้านที่โยกเข้ามา → คงลำดับเดิม P1, P2 แล้วจุดส่ง', () => {
    const v = transferDisplayOrder([D('d')], [P('p1'), P('p2')])
    expect(shown(v)).toBe('p1,p2,d')
    expect(v.incomingPos).toEqual([0, 1])
    expect(v.ownPos).toEqual([2])
    expect(transferLabel(v.peers, 2)?.warning).toBeUndefined()
  })

  it.each(['reassigned', 'postponed', 'not-delivered', 'driver-refused'])('จุดส่งของคันนี้ไม่ได้ไปแล้ว (%s) → ไม่ย้าย จุดรับอยู่ท้ายพร้อมคำเตือนเดิม', outcome => {
    const v = transferDisplayOrder([{ ...D('d'), outcome }], [P('p')])
    expect(shown(v)).toBe('d,p')
    expect(v.order[1]).toEqual({ kind: 'incoming', index: 0, inline: false })
    expect(transferLabel(v.peers, 1)?.warning).toBe(TRANSFER_WARNING.dropMissing)
  })

  it('จุดส่งส่งแล้ว (delivered) ยังนับว่าไปกับเที่ยวนี้ → ย้าย', () => {
    expect(shown(transferDisplayOrder([{ ...D('d'), outcome: 'delivered' }], [P('p')]))).toBe('p,d')
  })

  it('คนละกลุ่ม / จุดส่งอยู่หลังจุดรับอยู่แล้ว / งานโยกเข้าที่เป็นจุดส่ง → ไม่ย้าย', () => {
    expect(shown(transferDisplayOrder([D('d', 'g2')], [P('p', 'g1')]))).toBe('d,p')
    expect(shown(transferDisplayOrder([N('a')], [P('p'), D('d')]))).toBe('a,p,d')
    expect(shown(transferDisplayOrder([P('p')], [D('d')]))).toBe('p,d')
  })

  it('จุดส่งก็เป็นงานโยกเข้าแต่มาก่อนจุดรับ → สลับกันในส่วนท้าย (ไม่แทรกเข้าจุดของคันนี้)', () => {
    const v = transferDisplayOrder([N('x')], [D('d'), P('p')])
    expect(shown(v)).toBe('x,p,d')
    expect(v.order.slice(1)).toEqual([{ kind: 'incoming', index: 1, inline: false }, { kind: 'incoming', index: 0, inline: false }])
    expect(v.incomingPos).toEqual([2, 1])
  })

  it('จุดรับของคันนี้ + งานอื่น + จุดส่ง + จุดรับที่โยกเข้ามา → จุดรับที่โยกมาวางหน้าจุดส่งพอดี', () => {
    const v = transferDisplayOrder([P('p1'), N('x'), D('d')], [P('p2')])
    expect(shown(v)).toBe('p1,x,p2,d')
    expect(v.ownPos).toEqual([0, 1, 3])
    expect(transferLabel(v.peers, 3)).toEqual({ role: 'drop', text: '🏁 ส่งของที่รับจาก p1, p2' })
  })

  it('จุดของคันนี้เรียงผิดอยู่แล้ว (ส่งก่อนรับ) → ไม่ขยับจุดของคันนี้ คำเตือนเดิมยังขึ้น', () => {
    const v = transferDisplayOrder([D('d'), P('p1')], [P('p2')])
    expect(shown(v)).toBe('p2,d,p1')
    expect(transferLabel(v.peers, 1)?.warning).toBe(TRANSFER_WARNING.pickupAfterDrop)
  })

  it('ทุกกรณี: จุดของคันนี้เรียงตาม index ที่บันทึก · ทุกตำแหน่งมีครบไม่ซ้ำ · ไม่แก้ array ต้นฉบับ', () => {
    const cases: [S[], S[]][] = [
      [[N('a'), N('b')], [N('x')]],
      [[N('a'), D('d')], [P('p')]],
      [[D('d1', 'g1'), N('m'), D('d2', 'g2')], [P('q', 'g2'), N('y'), P('p', 'g1')]],
      [[], [D('d'), P('p')]],
      [[P('p1'), N('x'), D('d')], [P('p2')]],
    ]
    for (const [own, incoming] of cases) {
      const before = ids([...own, ...incoming])
      const v = transferDisplayOrder(own, incoming)
      ownAscending(v)
      expect([...v.ownPos, ...v.incomingPos].sort((a, b) => a - b)).toEqual(v.peers.map((_, i) => i))
      v.ownPos.forEach((pos, i) => expect(v.peers[pos]).toBe(own[i]))
      v.incomingPos.forEach((pos, i) => expect(v.peers[pos]).toBe(incoming[i]))
      expect(ids([...own, ...incoming])).toBe(before)
    }
    expect(shown(transferDisplayOrder([D('d1', 'g1'), N('m'), D('d2', 'g2')], [P('q', 'g2'), N('y'), P('p', 'g1')]))).toBe('p,d1,m,q,d2,y')
  })
})

describe('transferMateReminder (เตือนตอนทำทีละจุด)', () => {
  it('จุดรับ → บอกจุดส่งที่ยังอยู่ · จุดส่ง → บอกจุดรับที่ยังอยู่', () => {
    const peers = [P('วังโค'), P('ดูโฮม'), N('ไปรษณีย์'), D('ดอนเมือง')]
    expect(transferMateReminder(peers, 0)).toBe('ยังมีจุดส่ง ดอนเมือง ของงานเดียวกันอยู่ในเที่ยวนี้')
    expect(transferMateReminder(peers, 3)).toBe('ยังมีจุดรับ วังโค, ดูโฮม ของงานเดียวกันอยู่ในเที่ยวนี้')
  })
  it('จุดคู่ไม่อยู่ / ถูกเลื่อนไปแล้ว / งานปกติ → ไม่เตือน', () => {
    expect(transferMateReminder([P('วังโค')], 0)).toBeNull()
    expect(transferMateReminder([P('วังโค'), { ...D('ดอนเมือง'), outcome: 'postponed' }], 0)).toBeNull()
    expect(transferMateReminder([N('ไซต์ A'), D('ดอนเมือง')], 0)).toBeNull()
  })
})

describe('postponedPickupNote (เลื่อนจุดรับ ใบวันใหม่ยังรู้ว่าต้องไปส่งที่ไหน — ผลตรวจข้อ 1)', () => {
  it('ใช้ชื่อจุดส่งในเที่ยว · ไม่มีก็ใช้ชื่อที่จุดรับจำไว้', () => {
    expect(postponedPickupNote([P('วังโค'), D('ไซต์ RWS')], 0)).toBe('(รับของแล้วเอาไปส่งต่อที่ ไซต์ RWS)')
    expect(postponedPickupNote([P('วังโค')], 0)).toBe('(รับของแล้วเอาไปส่งต่อที่ ดอนเมือง)')
  })
  it('จุดส่ง / งานปกติ → ไม่มีข้อความ', () => {
    expect(postponedPickupNote([P('วังโค'), D('ดอนเมือง')], 1)).toBeNull()
    expect(postponedPickupNote([N('ไซต์ A')], 0)).toBeNull()
  })
})

describe('transferStopFields', () => {
  it('ใบปกติ → ว่าง (ไม่มี undefined)', () => {
    expect(transferStopFields({})).toEqual({})
    expect(transferStopFields(undefined)).toEqual({})
    expect(transferStopFields({ transferRole: 'pickup' })).toEqual({})
  })
  it('จุดรับเก็บชื่อจุดส่ง · จุดส่งไม่เก็บ', () => {
    expect(transferStopFields({ transferRole: 'pickup', transferId: 'g', transferDropName: 'X' })).toEqual({ transferRole: 'pickup', transferId: 'g', transferDropName: 'X' })
    expect(transferStopFields({ transferRole: 'drop', transferId: 'g', transferDropName: 'X' })).toEqual({ transferRole: 'drop', transferId: 'g' })
  })
})

describe('isInactiveStop (ตัวเช็กเดียวของจุดที่ไม่ทำแล้ว — หน้าประวัติใช้ซ่อนป้าย)', () => {
  it('ยังไม่มีผล / ส่งแล้ว = ยังไปกับเที่ยวนี้', () => {
    expect(isInactiveStop({})).toBe(false)
    expect(isInactiveStop({ outcome: undefined })).toBe(false)
    expect(isInactiveStop({ outcome: null })).toBe(false)
    expect(isInactiveStop({ outcome: '' })).toBe(false)
    expect(isInactiveStop({ outcome: 'delivered' })).toBe(false)
  })
  it('โยก / เลื่อน / ปฏิเสธ / ไม่ได้ส่ง = ไม่ทำแล้ว', () => {
    for (const outcome of ['reassigned', 'postponed', 'driver-refused', 'not-delivered']) expect(isInactiveStop({ outcome })).toBe(true)
  })
  it('ตรงกับที่ป้ายใช้: จุดรับที่เลื่อนไม่นับเป็นคู่ของจุดส่ง', () => {
    const pickup = { ...P('วังโค'), outcome: 'postponed' }
    expect(isInactiveStop(pickup)).toBe(true)
    expect(transferLabel([pickup, D('ดอนเมือง')], 1)?.warning).toBe(TRANSFER_WARNING.pickupMissing)
  })
})

describe('transferMissingWarning (หน้าต่างแก้ไขเที่ยววิ่ง — ผลตรวจ history-labels)', () => {
  it('จุดคู่ไม่อยู่ในลิสต์เลย → เตือนแบบเดียวกับป้าย', () => {
    expect(transferMissingWarning([D('ดอนเมือง')], 0)).toBe(TRANSFER_WARNING.pickupMissing)
    expect(transferMissingWarning([P('วังโค')], 0)).toBe(TRANSFER_WARNING.dropMissing)
  })
  it('จุดคู่ยังอยู่ในลิสต์แต่เลื่อน/โยกออกแล้ว → ไม่เตือน (ป้ายยังเตือนเหมือนเดิม)', () => {
    const peers = [{ ...P('วังโค'), outcome: 'postponed' }, D('ดอนเมือง')]
    expect(transferLabel(peers, 1)?.warning).toBe(TRANSFER_WARNING.pickupMissing)
    expect(transferMissingWarning(peers, 1)).toBeNull()
    expect(transferMissingWarning([{ ...D('ดอนเมือง'), outcome: 'reassigned' }, P('วังโค')], 1)).toBeNull()
  })
  it('จุดคู่ของกลุ่มอื่นไม่นับ · ลำดับผิด/ครบคู่/จุดปกติ = ไม่เตือน', () => {
    expect(transferMissingWarning([{ ...P('วังโค', 'g2'), outcome: 'postponed' }, D('ดอนเมือง')], 1)).toBe(TRANSFER_WARNING.pickupMissing)
    expect(transferMissingWarning([D('ดอนเมือง'), P('วังโค')], 0)).toBeNull()
    expect(transferMissingWarning([P('วังโค'), D('ดอนเมือง')], 1)).toBeNull()
    expect(transferMissingWarning([N('ไซต์ A')], 0)).toBeNull()
  })
})

describe('transferTagStyle (ย้ายมาจากใบสรุป — สีต้องเหมือนเดิม)', () => {
  it('จุดรับ = ส้ม · จุดส่ง = เขียว · ขนาดเดิม', () => {
    expect(transferTagStyle({ role: 'pickup' })).toEqual({ fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: '#ffedd5', color: '#9a3412' })
    expect(transferTagStyle({ role: 'drop' })).toEqual({ fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: '#dcfce7', color: '#166534' })
  })
})

// ---------- แก้ของที่จุดรับ แล้วจุดส่งอัปเดตตาม (drop-sync) ----------

describe('dropLine (รูปบรรทัดเดียวกับตอนส่งใบ)', () => {
  it('ตรงกับ buildDropDescription ทุกตัวอักษร · ไม่มีชื่อ = "จุดรับ"', () => {
    expect(dropLine(' ดูโฮม ', ' ปูน 10 ถุง ')).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง')
    expect(buildDropDescription([{ name: ' ดูโฮม ', items: ' ปูน 10 ถุง ' }], '')).toBe(dropLine(' ดูโฮม ', ' ปูน 10 ถุง '))
    expect(dropLine('  ', 'เหล็ก')).toBe('ส่งของที่รับจาก จุดรับ: เหล็ก')
  })
})

describe('syncDropText', () => {
  const two = buildDropDescription([{ name: 'ดูโฮม', items: 'ปูน 10 ถุง' }, { name: 'วานิช', items: 'ยางมะตอย' }], 'ท่อ EMT จากออฟฟิศ')
  it('จุดรับเดียว → แทนบรรทัด (updated)', () => {
    expect(syncDropText('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง', 'ดูโฮม', 'ปูน 10 ถุง', 'ปูน 15 ถุง')).toEqual({ text: 'ส่งของที่รับจาก ดูโฮม: ปูน 15 ถุง', result: 'updated' })
  })
  it('รับ 2 ร้าน → เปลี่ยนเฉพาะบรรทัดของร้านที่แก้ · บรรทัดงานอื่นของผู้ขอยังอยู่ครบ', () => {
    const r = syncDropText(two, 'วานิช', 'ยางมะตอย', 'ยางมะตอย 2 ถัง')
    expect(r.result).toBe('updated')
    expect(r.text).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง\nส่งของที่รับจาก วานิช: ยางมะตอย 2 ถัง\nท่อ EMT จากออฟฟิศ')
  })
  it('ของหลายบรรทัด (ทั้งก่อนและหลังแก้)', () => {
    const text = buildDropDescription([{ name: 'ดูโฮม', items: 'ปูน 10 ถุง\nทราย 2 คิว' }, { name: 'วานิช', items: 'ยางมะตอย' }], '')
    const r = syncDropText(text, 'ดูโฮม', 'ปูน 10 ถุง\nทราย 2 คิว', 'ปูน 10 ถุง\nทราย 3 คิว\nหิน 1 คิว')
    expect(r).toEqual({ text: 'ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง\nทราย 3 คิว\nหิน 1 คิว\nส่งของที่รับจาก วานิช: ยางมะตอย', result: 'updated' })
  })
  it('ของเดิม "ปูน 10" ไม่ไปจับบรรทัด "ปูน 10 ถุง" (ต้องจบบรรทัดพอดี)', () => {
    expect(syncDropText('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง', 'ดูโฮม', 'ปูน 10', 'ปูน 12')).toEqual({ text: 'ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง', result: 'manual' })
    expect(syncDropText('หมายเหตุ ส่งของที่รับจาก ดูโฮม: ปูน 10', 'ดูโฮม', 'ปูน 10', 'ปูน 12').result).toBe('manual')
  })
  it('แก้แค่ช่องว่างหัวท้าย / มีบรรทัดใหม่อยู่แล้ว → same (ไม่แตะข้อความ)', () => {
    expect(syncDropText(two, 'ดูโฮม', ' ปูน 10 ถุง ', 'ปูน 10 ถุง')).toEqual({ text: two, result: 'same' })
    expect(syncDropText(two, 'ดูโฮม', 'ปูน 5 ถุง', 'ปูน 10 ถุง')).toEqual({ text: two, result: 'same' })
  })
  it('ข้อความถูกแก้มือจนหาบรรทัดเดิมไม่เจอ → manual และข้อความไม่เปลี่ยน', () => {
    const edited = 'รับปูนจากดูโฮมมาด้วย\nท่อ EMT จากออฟฟิศ'
    expect(syncDropText(edited, 'ดูโฮม', 'ปูน 10 ถุง', 'ปูน 15 ถุง')).toEqual({ text: edited, result: 'manual' })
  })
  it('ร้านเดียวกัน 2 บรรทัด ของเหมือนกัน → manual (ไม่รู้ว่าบรรทัดไหน)', () => {
    const text = buildDropDescription([{ name: 'ดูโฮม', items: 'ปูน' }, { name: 'ดูโฮม', items: 'ปูน' }], '')
    expect(syncDropText(text, 'ดูโฮม', 'ปูน', 'เหล็ก')).toEqual({ text, result: 'manual' })
  })
  it('ของใหม่ว่าง → บรรทัดที่ไม่มีรายการของ (รูปเดียวกับตอนส่งใบ)', () => {
    expect(syncDropText('ส่งของที่รับจาก ดูโฮม: ปูน', 'ดูโฮม', 'ปูน', '  ').text).toBe(buildDropDescription([{ name: 'ดูโฮม', items: '' }], ''))
  })
  it('ชื่อร้านมีอักขระพิเศษ ( ) . + * ? → หาแบบข้อความธรรมดา ไม่ใช่ RegExp', () => {
    const name = 'บ.ดูโฮม (สาขา+รังสิต)*?'
    const text = buildDropDescription([{ name, items: 'ปูน 10 ถุง' }, { name: 'ABC', items: 'ปูน 10 ถุง' }], '')
    expect(syncDropText(text, name, 'ปูน 10 ถุง', 'ปูน 15 ถุง')).toEqual({ text: `ส่งของที่รับจาก ${name}: ปูน 15 ถุง\nส่งของที่รับจาก ABC: ปูน 10 ถุง`, result: 'updated' })
    // "A.C" ต้องไม่จับ "ABC" (ถ้าใช้ RegExp โดยไม่ escape จะจับ)
    expect(syncDropText(text, 'A.C', 'ปูน 10 ถุง', 'ปูน 15 ถุง')).toEqual({ text, result: 'manual' })
  })
})

describe('applyPickupItemsEdit (หน้าคำขอ)', () => {
  type Dest = TransferFields & { siteName: string; jobDescription: string; withdrawn?: boolean }
  const pickup = (siteName: string, jobDescription: string, group = 'tf_1'): Dest => ({ siteName, jobDescription, transferRole: 'pickup', transferId: group, transferDropName: 'ดอนเมือง' })
  const drop = (jobDescription: string, group = 'tf_1', extra: Partial<Dest> = {}): Dest => ({ siteName: 'ดอนเมือง', jobDescription, transferRole: 'drop', transferId: group, ...extra })
  const dropText = buildDropDescription([{ name: 'ดูโฮม', items: 'ปูน 10 ถุง' }, { name: 'วานิช', items: 'ยางมะตอย' }], 'ท่อ EMT จากออฟฟิศ')
  const request = (assignedDestinations: number[] = [], extra: Dest[] = []) => ({ destinations: [pickup('ดูโฮม', 'ปูน 10 ถุง'), pickup('วานิช', 'ยางมะตอย'), drop(dropText), ...extra], assignedDestinations })

  it('จุดส่งยังไม่จัด → ข้อความจุดส่งถูกซิงก์ · ไม่แก้ array/object เดิม', () => {
    const req = request()
    const plan = applyPickupItemsEdit(req, 0, 'ปูน 15 ถุง')
    expect(plan).toMatchObject({ drop: 'updated', dropName: 'ดอนเมือง', pickupOnTrip: false })
    expect(plan.destinations[0].jobDescription).toBe('ปูน 15 ถุง')
    expect(plan.destinations[2].jobDescription).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 15 ถุง\nส่งของที่รับจาก วานิช: ยางมะตอย\nท่อ EMT จากออฟฟิศ')
    expect(plan.destinations[1]).toBe(req.destinations[1])
    expect(req.destinations[0].jobDescription).toBe('ปูน 10 ถุง')
    expect(req.destinations[2].jobDescription).toBe(dropText)
    expect(plan.destinations).not.toBe(req.destinations)
  })
  it('จุดส่งจัดเข้าเที่ยวแล้ว → on-trip และไม่แตะจุดส่ง · สำเนาคันคู่ที่ถอนแล้ว → none', () => {
    const onTrip = request([2])
    const plan = applyPickupItemsEdit(onTrip, 0, 'ปูน 15 ถุง')
    expect(plan.drop).toBe('on-trip')
    expect(plan.destinations[2]).toBe(onTrip.destinations[2])
    expect(plan.destinations[0].jobDescription).toBe('ปูน 15 ถุง')
    const withdrawn = { destinations: [pickup('ดูโฮม', 'ปูน 10 ถุง'), drop('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง', 'tf_1', { withdrawn: true })], assignedDestinations: [1] }
    expect(applyPickupItemsEdit(withdrawn, 0, 'ปูน 15 ถุง').drop).toBe('none')
  })
  it('pickupOnTrip = จุดรับนี้จัดเข้าเที่ยวแล้ว (ไม่นับสำเนาที่ถอน) · จุดส่งที่ยังไม่จัดยังซิงก์', () => {
    const plan = applyPickupItemsEdit(request([0]), 0, 'ปูน 15 ถุง')
    expect(plan).toMatchObject({ pickupOnTrip: true, drop: 'updated' })
    expect(applyPickupItemsEdit(request([1]), 0, 'ปูน 15 ถุง').pickupOnTrip).toBe(false)
    const withdrawn = { destinations: [{ ...pickup('ดูโฮม', 'ปูน 10 ถุง'), withdrawn: true }, drop('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง')], assignedDestinations: [0] }
    expect(applyPickupItemsEdit(withdrawn, 0, 'ปูน 15 ถุง').pickupOnTrip).toBe(false)
  })
  it('ชุดคันคู่ (transferId ต่างกัน) ไม่ถูกแตะ', () => {
    const copyDrop = drop(dropText, 'tf_copy')
    const req = request([], [pickup('ดูโฮม', 'ปูน 10 ถุง', 'tf_copy'), pickup('วานิช', 'ยางมะตอย', 'tf_copy'), copyDrop])
    const plan = applyPickupItemsEdit(req, 0, 'ปูน 15 ถุง')
    expect(plan.destinations[2].jobDescription).toContain('ปูน 15 ถุง')
    expect(plan.destinations[5]).toBe(copyDrop)
    expect(plan.destinations[3].jobDescription).toBe('ปูน 10 ถุง')
  })
  it('ใบปกติ → none และเปลี่ยนแค่จุดนั้น · จุดส่งถูกแก้มือ → manual (ไม่แตะ)', () => {
    const normal = { destinations: [{ siteName: 'ไซต์ A', jobDescription: 'งาน A' }, { siteName: 'ไซต์ B', jobDescription: 'งาน B' }] }
    const plan = applyPickupItemsEdit(normal, 1, 'งาน B ใหม่')
    expect(plan).toMatchObject({ drop: 'none', dropName: '', pickupOnTrip: false })
    expect(plan.destinations).toEqual([{ siteName: 'ไซต์ A', jobDescription: 'งาน A' }, { siteName: 'ไซต์ B', jobDescription: 'งาน B ใหม่' }])
    const handEdited = { destinations: [pickup('ดูโฮม', 'ปูน 10 ถุง'), drop('รับปูนจากดูโฮม')] }
    const manual = applyPickupItemsEdit(handEdited, 0, 'ปูน 15 ถุง')
    expect(manual.drop).toBe('manual')
    expect(manual.destinations[1]).toBe(handEdited.destinations[1])
  })
})

describe('pickupEditMessage (ข้อความต่อท้าย toast หน้าคำขอ)', () => {
  it('ซิงก์แล้ว / ไม่มีอะไรต้องบอก', () => {
    expect(pickupEditMessage({ drop: 'updated', dropName: 'ดอนเมือง', pickupOnTrip: false })).toEqual({ text: 'อัปเดตรายการของที่จุดส่ง ดอนเมือง ให้ตามแล้ว', warn: false })
    expect(pickupEditMessage({ drop: 'same', dropName: 'ดอนเมือง', pickupOnTrip: false })).toEqual({ text: null, warn: false })
    expect(pickupEditMessage({ drop: 'none', dropName: '', pickupOnTrip: false })).toEqual({ text: null, warn: false })
  })
  it('หาบรรทัดไม่เจอ → เตือนให้แก้จุดส่งเอง', () => {
    const m = pickupEditMessage({ drop: 'manual', dropName: 'ดอนเมือง', pickupOnTrip: false })
    expect(m.warn).toBe(true)
    expect(m.text).toContain('จุดส่ง ดอนเมือง ยังเป็นรายการเดิม')
  })
  it('จุดส่งจัดแล้วแต่จุดรับยังไม่จัด → ให้แก้ช่องจุดส่งในเที่ยวนั้นเอง (ไม่สัญญาว่าจะแก้ตามให้) + ทางคิวต่อเนื่อง', () => {
    const m = pickupEditMessage({ drop: 'on-trip', dropName: 'ดอนเมือง', pickupOnTrip: false })
    expect(m.warn).toBe(true)
    expect(m.text).toContain('จุดส่ง ดอนเมือง จัดเข้าเที่ยวแล้ว — แก้ช่องรายละเอียดของจุดส่งในเที่ยวนั้นเอง')
    expect(m.text).toContain('ถ้าเป็นคิวต่อเนื่อง ให้แจ้งคนขับเอง')
    expect(m.text).not.toContain('แก้ตามให้')
  })
  it('จุดรับจัดแล้ว → บอกให้แก้ที่เที่ยว และบอกว่าจุดส่งในใบนี้อัปเดตแล้ว / จุดส่งก็จัดแล้ว', () => {
    const updated = pickupEditMessage({ drop: 'updated', dropName: 'ดอนเมือง', pickupOnTrip: true })
    expect(updated.warn).toBe(true)
    expect(updated.text).toContain('จุดรับนี้จัดเข้าเที่ยวแล้ว')
    expect(updated.text).toContain('จุดส่ง ดอนเมือง ในใบนี้อัปเดตแล้ว')
    expect(pickupEditMessage({ drop: 'on-trip', dropName: 'ดอนเมือง', pickupOnTrip: true }).text).toContain('ถ้าอยู่เที่ยวเดียวกัน')
  })
})

describe('syncDropsInTripEdit (หน้าต่างแก้ไขเที่ยววิ่ง)', () => {
  type Stop = TransferFields & { siteName: string; cargoDetails: string; outcome?: string; assistForPlate?: string; postponedToDate?: string; postponedRequestId?: string }
  const pk = (siteName: string, cargoDetails: string, extra: Partial<Stop> = {}): Stop => ({ siteName, cargoDetails, transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง', ...extra })
  const dr = (cargoDetails: string, extra: Partial<Stop> = {}): Stop => ({ siteName: 'ดอนเมือง', cargoDetails, transferRole: 'drop', transferId: 'tf_1', ...extra })
  const plain = (siteName: string, cargoDetails = 'งานปกติ'): Stop => ({ siteName, cargoDetails })
  const dropText = buildDropDescription([{ name: 'ดูโฮม', items: 'ปูน 10 ถุง' }, { name: 'วานิช', items: 'ยางมะตอย' }], 'ท่อ EMT จากออฟฟิศ')
  const opened = () => [pk('ดูโฮม', 'ปูน 10 ถุง'), plain('ไซต์ X'), pk('วานิช', 'ยางมะตอย'), dr(dropText)]
  const editRow = (stops: Stop[], index: number, cargoDetails: string) => stops.map((s, i) => (i === index ? { ...s, cargoDetails } : s))

  it('จุดส่งอยู่เที่ยวเดียวกัน → แทนบรรทัด · ไม่แก้ฟอร์มเดิม', () => {
    const original = opened()
    const form = editRow(original, 0, 'ปูน 15 ถุง')
    const sync = syncDropsInTripEdit(original, form, [0, 1, 2, 3])
    expect(sync.stops[3].cargoDetails).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 15 ถุง\nส่งของที่รับจาก วานิช: ยางมะตอย\nท่อ EMT จากออฟฟิศ')
    expect(sync).toMatchObject({ updated: ['ดอนเมือง'], replacedFor: [0], notInTrip: [], check: [] })
    expect(form[3].cargoDetails).toBe(dropText)
    expect(sync.stops.slice(0, 3)).toEqual(form.slice(0, 3))
  })
  it('แก้ 2 จุดรับพร้อมกัน → แทนครบทั้ง 2 บรรทัด', () => {
    const original = opened()
    const form = editRow(editRow(original, 0, 'ปูน 15 ถุง'), 2, 'ยางมะตอย 2 ถัง')
    const sync = syncDropsInTripEdit(original, form, [0, 1, 2, 3])
    expect(sync.stops[3].cargoDetails).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 15 ถุง\nส่งของที่รับจาก วานิช: ยางมะตอย 2 ถัง\nท่อ EMT จากออฟฟิศ')
    expect(sync.updated).toEqual(['ดอนเมือง'])
    expect(sync.replacedFor).toEqual([0, 2])
  })
  it('คนจัดรถพิมพ์เรื่องอื่นเพิ่มที่จุดส่งในหน้าต่างเดียวกัน + แก้จุดรับ → บรรทัดของยังถูกแทน ข้อความที่พิมพ์ยังอยู่ (ผลตรวจข้อ 1)', () => {
    const original = opened()
    const form = editRow(editRow(original, 3, `${dropText}\nโทรหาโฟร์แมนก่อนถึง`), 0, 'ปูน 15 ถุง')
    const sync = syncDropsInTripEdit(original, form, [0, 1, 2, 3])
    expect(sync.stops[3].cargoDetails).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 15 ถุง\nส่งของที่รับจาก วานิช: ยางมะตอย\nท่อ EMT จากออฟฟิศ\nโทรหาโฟร์แมนก่อนถึง')
    expect(sync.check).toEqual([])
  })
  it('คนจัดรถแก้บรรทัดที่จุดส่งเป็นของใหม่เองแล้ว → same ไม่เตือน · แก้จนหาบรรทัดไม่เจอ → เตือนให้แก้เอง (ไม่แตะ)', () => {
    const original = opened()
    const already = editRow(editRow(original, 3, dropText.replace('ปูน 10 ถุง', 'ปูน 15 ถุง')), 0, 'ปูน 15 ถุง')
    const same = syncDropsInTripEdit(original, already, [0, 1, 2, 3])
    expect(same.stops).toEqual(already)
    expect(same).toMatchObject({ updated: [], replacedFor: [], check: [], notInTrip: [] })
    const lost = editRow(editRow(original, 3, 'ส่งของทั้งหมด'), 0, 'ปูน 15 ถุง')
    const manual = syncDropsInTripEdit(original, lost, [0, 1, 2, 3])
    expect(manual.stops[3].cargoDetails).toBe('ส่งของทั้งหมด')
    expect(manual.check).toEqual(['จุดส่ง ดอนเมือง ยังเป็นรายการเดิม (หาบรรทัดของ ดูโฮม เดิมไม่เจอ) — เปิดแก้ไขอีกครั้งแล้วแก้ช่องของจุดส่งเอง'])
  })
  it('จุดส่งไม่อยู่ในเที่ยว → notInTrip ด้วยชื่อจาก transferDropName · จุดส่งถูกลบในหน้าต่างนี้เอง → ไม่เตือน', () => {
    const alone = [pk('ดูโฮม', 'ปูน 10 ถุง'), plain('ไซต์ X')]
    const split = syncDropsInTripEdit(alone, editRow(alone, 0, 'ปูน 15 ถุง'), [0, 1])
    expect(split).toMatchObject({ notInTrip: ['ดอนเมือง'], updated: [], check: [] })
    const original = opened()
    const removed = editRow(original, 0, 'ปูน 15 ถุง').slice(0, 3)
    expect(syncDropsInTripEdit(original, removed, [0, 1, 2])).toMatchObject({ notInTrip: [], updated: [], check: [] })
  })
  it('จุดส่งเลื่อนวันแล้ว → ไม่แตะ บอกวันกับเลขใบ · จุดรับเลื่อนวันแล้ว → ไม่ซิงก์ บอกวันกับเลขใบ', () => {
    const postponedDrop = [pk('ดูโฮม', 'ปูน 10 ถุง'), dr('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง', { outcome: 'postponed', postponedToDate: '2026-11-06', postponedRequestId: 'VR-20261106-003' })]
    const a = syncDropsInTripEdit(postponedDrop, editRow(postponedDrop, 0, 'ปูน 15 ถุง'), [0, 1])
    expect(a.stops[1].cargoDetails).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง')
    expect(a.check).toEqual(['จุดส่ง ดอนเมือง เลื่อนไปวันที่ 06/11/2026 แล้ว — แก้รายละเอียดที่ใบ VR-20261106-003 ในหน้าคำขอ'])
    const postponedPickup = [pk('ดูโฮม', 'ปูน 10 ถุง', { outcome: 'postponed', postponedToDate: '2026-11-07', postponedRequestId: 'VR-20261107-001' }), dr('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง')]
    const b = syncDropsInTripEdit(postponedPickup, editRow(postponedPickup, 0, 'ปูน 15 ถุง'), [0, 1])
    expect(b.stops[1].cargoDetails).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง')
    expect(b.check).toEqual(['จุดรับ ดูโฮม เลื่อนไปวันที่ 07/11/2026 แล้ว — แก้รายละเอียดที่ใบ VR-20261107-001 ในหน้าคำขอ (จุดส่งไม่ถูกแก้ตาม)'])
    expect(b.updated).toEqual([])
  })
  it('จุดรับที่โยกไปคันอื่นยังซิงก์ (คันที่รับงานอ่านรายละเอียดจากจุดต้นทาง) · แถวที่เพิ่มใหม่ (sourceIndex null) ไม่สน', () => {
    const moved = [pk('ดูโฮม', 'ปูน 10 ถุง', { outcome: 'reassigned' }), dr('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง')]
    expect(syncDropsInTripEdit(moved, editRow(moved, 0, 'ปูน 15 ถุง'), [0, 1]).stops[1].cargoDetails).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 15 ถุง')
    const original = [dr('ส่งของที่รับจาก ดูโฮม: ปูน 10 ถุง')]
    const form = [...original, pk('ดูโฮม', 'อะไรก็ได้')]
    expect(syncDropsInTripEdit(original, form, [0, null]).stops).toEqual(form)
  })
  it('สำเนาคันช่วย: จับคู่เฉพาะ assistForPlate เดียวกัน (ผลตรวจข้อขัดกัน 5)', () => {
    // T2 = [B รับ (จริง), Y ส่ง (จริง), A' สำเนาจุดรับ A ของคัน T1]
    const t2 = [pk('B', 'เหล็ก'), dr(buildDropDescription([{ name: 'A', items: 'ปูน' }, { name: 'B', items: 'เหล็ก' }], '')), pk('A', 'ปูน', { assistForPlate: 'T1' })]
    const copyEdited = syncDropsInTripEdit(t2, editRow(t2, 2, 'ปูน 2 ถุง'), [0, 1, 2])
    expect(copyEdited.stops[1]).toBe(t2[1]) // จุดส่งจริงไม่ถูกแก้ตามสำเนา
    expect(copyEdited).toMatchObject({ updated: [], notInTrip: [], check: [], changed: [{ transferId: 'tf_1', assistForPlate: 'T1' }] })
    const realEdited = syncDropsInTripEdit(t2, editRow(t2, 0, 'เหล็ก 2 เส้น'), [0, 1, 2])
    expect(realEdited.stops[1].cargoDetails).toBe('ส่งของที่รับจาก A: ปูน\nส่งของที่รับจาก B: เหล็ก 2 เส้น')
    // สำเนาจุดรับ + สำเนาจุดส่งจากคันเดียวกัน → สำเนาจุดส่งแก้ตาม
    const helper = [pk('A', 'ปูน', { assistForPlate: 'T1' }), dr('ส่งของที่รับจาก A: ปูน', { assistForPlate: 'T1' })]
    expect(syncDropsInTripEdit(helper, editRow(helper, 0, 'ปูน 2 ถุง'), [0, 1]).stops[1].cargoDetails).toBe('ส่งของที่รับจาก A: ปูน 2 ถุง')
  })
  it('ทริปปกติ → stops เท่าเดิมทุกค่า ไม่มีข้อความ', () => {
    const original = [plain('ไซต์ A', 'a'), plain('ไซต์ B', 'b')]
    const form = editRow(original, 0, 'a แก้')
    const sync = syncDropsInTripEdit(original, form, [0, 1])
    expect(sync.stops).toEqual(form)
    expect(sync).toMatchObject({ updated: [], replacedFor: [], notInTrip: [], check: [], changed: [] })
  })
})

describe('dropSyncNote (ข้อความต่อท้าย toast หน้าประวัติ)', () => {
  const empty = { updated: [], notInTrip: [], check: [], changed: [] }
  it('ไม่มีอะไรต้องบอก = ว่าง ไม่แดง', () => {
    expect(dropSyncNote(empty, [])).toEqual({ text: '', warn: false })
  })
  it('แก้จุดส่งให้แล้ว → บอกให้คนขับเปิดลิงก์ใหม่ (ใบงานไม่โหลดเอง)', () => {
    const n = dropSyncNote({ ...empty, updated: ['ดอนเมือง'], changed: [{ transferId: 'tf_1', assistForPlate: '' }] }, [])
    expect(n).toEqual({ text: ' · อัปเดตรายการของที่จุดส่ง ดอนเมือง ให้ตามแล้ว · ถ้าคนขับเปิดใบงานไว้แล้ว ให้บอกคนขับปิดแล้วเปิดลิงก์ใหม่', warn: false })
  })
  it('จุดส่งไม่อยู่ในเที่ยว → ใช้คำเดียวกับป้าย + ทางคิวต่อเนื่อง · ต้องตรวจเอง → แดง', () => {
    const n = dropSyncNote({ ...empty, notInTrip: ['ดอนเมือง'], check: ['ตรวจเอง'] }, [])
    expect(n.warn).toBe(true)
    expect(n.text).toContain(`⚠️ ${TRANSFER_WARNING.dropMissing} (ดอนเมือง) — ถ้าจัดไปเที่ยวอื่นแล้ว`)
    expect(n.text).toContain('ถ้าเป็นคิวต่อเนื่อง ให้แจ้งคนขับเอง')
    expect(n.text).toContain('⚠️ ตรวจเอง')
  })
  it('มีสำเนาคันช่วยบนคันอื่น (หรือแก้ที่สำเนา) → บอกว่าคันนั้นไม่ถูกแก้ตาม · จุดส่งจริงที่อยู่คันอื่นไม่นับเป็นคันช่วย', () => {
    const changed = { ...empty, changed: [{ transferId: 'tf_1', assistForPlate: '' }] }
    const copy = { siteName: 'A', transferRole: 'pickup' as const, transferId: 'tf_1', assistForPlate: 'T1' }
    expect(dropSyncNote(changed, [copy]).text).toContain('สำเนาคันช่วย/งานต้นทางบนคันอื่นไม่ถูกแก้ตาม')
    expect(dropSyncNote(changed, [{ ...copy, transferId: 'tf_2' }]).text).toBe('')
    const realDrop = { siteName: 'ดอนเมือง', transferRole: 'drop' as const, transferId: 'tf_1' }
    expect(dropSyncNote(changed, [realDrop])).toEqual({ text: '', warn: false })
    const fromCopy = { ...empty, changed: [{ transferId: 'tf_1', assistForPlate: 'T1' }] }
    expect(dropSyncNote(fromCopy, [realDrop]).text).toContain('สำเนาคันช่วย/งานต้นทางบนคันอื่นไม่ถูกแก้ตาม')
  })
})

describe('activeTransferSet (ปุ่มทำทั้งชุดในใบสรุป)', () => {
  const stops = (...list: object[]) => list as never[]
  it('จุดปกติ / index นอกช่วง → []', () => {
    expect(activeTransferSet(stops(N('a'), P('p'), D('d')), 0)).toEqual([])
    expect(activeTransferSet(stops(P('p'), D('d')), 5)).toEqual([])
  })
  it('รับ, รับ, งานอื่น, ส่ง ที่ยังไปกับเที่ยวนี้ → [0,1,3] เรียงตาม stops ไม่ว่ากดจุดไหน', () => {
    const list = stops(P('p1'), P('p2'), N('x'), D('d'))
    expect(activeTransferSet(list, 0)).toEqual([0, 1, 3])
    expect(activeTransferSet(list, 3)).toEqual([0, 1, 3])
  })
  it('จุดคู่ที่เลื่อน/โยก/ปฏิเสธแล้วไม่นับ แต่ "ส่งแล้ว" (delivered) นับ', () => {
    const list = stops({ ...P('p1'), outcome: 'postponed' }, { ...P('p2'), outcome: 'reassigned' }, { ...P('p3'), outcome: 'driver-refused' }, { ...P('p4'), outcome: 'delivered' }, D('d'))
    expect(activeTransferSet(list, 4)).toEqual([3, 4])
  })
  it('จุดที่กดไม่ทำแล้ว → [] (กลับไปใช้ปุ่มทีละจุด)', () => {
    expect(activeTransferSet(stops({ ...P('p'), outcome: 'reassigned' }, D('d')), 0)).toEqual([])
  })
  it('กลุ่มอื่นในทริปเดียวกันไม่นับ · มีแต่ตัวเอง → [i] (ไม่ถามทั้งชุด)', () => {
    const list = stops(P('p1', 'g1'), P('p2', 'g2'), D('d1', 'g1'), D('d2', 'g2'))
    expect(activeTransferSet(list, 0)).toEqual([0, 2])
    expect(activeTransferSet(list, 3)).toEqual([1, 3])
    expect(activeTransferSet(stops(P('p'), { ...D('d'), outcome: 'postponed' }), 0)).toEqual([0])
  })
  it('จุดที่กดเป็นสำเนาคันช่วย → [] · สำเนาคันช่วยไม่ถูกนับเข้าชุดของจุดจริง (ข้อขัดกัน 3)', () => {
    // T2 = [B รับ, Y ส่ง, A' สำเนาคันช่วยของจุดรับ A จากรถ T1]
    const list = stops(P('B'), D('Y'), { ...P('A'), assistForPlate: 'รถ T1' })
    expect(activeTransferSet(list, 2)).toEqual([])
    expect(activeTransferSet(list, 1)).toEqual([0, 1])
  })
  it('มีจุดในชุดที่มี postponedRequestId ค้าง → [] ทั้งชุด (ทางทีละจุดปลดใบวันใหม่ให้ถูก — ข้อขัดกัน 4)', () => {
    const list = stops(P('p'), { ...D('d'), postponedRequestId: 'VR-0611-0011' })
    expect(activeTransferSet(list, 0)).toEqual([])
    expect(activeTransferSet(list, 1)).toEqual([])
    // จุดที่เลื่อนไปแล้ว (ไม่อยู่ในชุด) มี postponedRequestId เป็นปกติ — ไม่กระทบชุด
    expect(activeTransferSet(stops(P('p1'), { ...P('p2'), outcome: 'postponed', postponedRequestId: 'VR-0611-0011' }, D('d')), 0)).toEqual([0, 2])
  })
})

describe('transferStopName', () => {
  it('ชื่อ + บทบาท · ไม่มีชื่อใช้บทบาท · จุดปกติไม่มีวงเล็บ', () => {
    expect(transferStopName(P('วังโค'))).toBe('วังโค (จุดรับ)')
    expect(transferStopName(D('ดอนเมือง'))).toBe('ดอนเมือง (จุดส่ง)')
    expect(transferStopName({ ...D('x'), siteName: ' ' })).toBe('จุดส่ง (จุดส่ง)')
    expect(transferStopName(N('ไซต์ A'))).toBe('ไซต์ A')
  })
})

describe('transferSetOutside (รายชื่อที่ทำทั้งชุดไม่แตะ)', () => {
  it('จุดปกติ → [] · ชุดครบในคันเดียว ไม่มีอะไรนอกชุด → []', () => {
    expect(transferSetOutside([N('a')], 0, [], [], 'รถ 1')).toEqual([])
    expect(transferSetOutside([P('p'), N('x'), D('d')], 0, [], [], 'รถ 1')).toEqual([])
  })
  it('จุดของเที่ยวนี้ที่เลื่อน/โยก/ปฏิเสธแล้ว บอกเหตุผลแยกกัน · กลุ่มอื่นไม่ขึ้น', () => {
    const lines = transferSetOutside([
      P('ร้าน A'),
      { ...P('ร้าน B'), outcome: 'postponed', postponedToDate: '2026-11-06' } as S,
      { ...P('ร้าน C'), outcome: 'reassigned', reassignedToVehiclePlate: 'ขค 2' } as S,
      { ...P('ร้าน E'), outcome: 'driver-refused' } as S,
      P('กลุ่มอื่น', 'g2'),
      D('ดอนเมือง'),
    ], 0, [], [], 'รถ 1')
    expect(lines).toEqual([
      'ร้าน B (จุดรับ) — เลื่อนไปวันที่ 06/11/2026 แล้ว',
      'ร้าน C (จุดรับ) — โยกไปรถ ขค 2 แล้ว',
      'ร้าน E (จุดรับ) — คนขับปฏิเสธแล้ว',
    ])
  })
  it('งานโยกเข้าของกลุ่มเดียวกัน → บอกคันต้นทาง + ประโยคเดียวกับแถวงานโยกเข้า (ข้อขัดกัน 15)', () => {
    const lines = transferSetOutside([P('ร้าน A'), D('ดอนเมือง')], 1, [{ ...P('ดูโฮม'), fromVehiclePlate: 'กข 1', fromDriverName: 'สมชาย' }, { ...N('งานโยกปกติ'), fromVehiclePlate: 'กข 1' }], [], 'รถ 1')
    expect(lines).toEqual([`ดูโฮม (จุดรับ) — โยกมาจาก กข 1 (สมชาย) · ${TRANSFER_EDIT_AT_SOURCE}`])
  })
  it('สำเนาคันช่วยในเที่ยวนี้ และสำเนาคันช่วยของเที่ยวนี้บนรถคันอื่น → บอกว่าไม่ถูกทำตาม (ข้อขัดกัน 3, 7)', () => {
    const own = [P('ร้าน A'), D('ดอนเมือง'), { ...P('ร้าน Z'), assistForPlate: 'รถ 9' } as S]
    const others = [
      { vehiclePlate: 'รถช่วย', driverName: 'คนประจำ', actualDriverName: 'คนขับแทน', stops: [N('งานของคันช่วย'), { ...P('ร้าน A'), assistForPlate: 'รถ 1' } as S] },
      { vehiclePlate: 'รถอื่น', driverName: 'คนอื่น', stops: [{ ...D('ดอนเมือง'), assistForPlate: 'รถ 5' } as S, { ...P('ร้าน A'), assistForPlate: 'รถ 1', outcome: 'reassigned' } as S] },
    ]
    expect(transferSetOutside(own, 0, [], others, 'รถ 1')).toEqual([
      'ร้าน Z (จุดรับ) — สำเนาคันช่วยจากรถ รถ 9 ไม่ถูกทำตาม (จัดการเองที่จุดนั้น)',
      'ร้าน A (จุดรับ) — สำเนาคันช่วยบนรถ รถช่วย (คนขับแทน) ไม่ถูกทำตาม — ไปแก้/ลบเองที่คันนั้น',
    ])
    // ไม่รู้ทะเบียนของเที่ยวนี้ = ไม่เดาสำเนาบนคันอื่น
    expect(transferSetOutside(own, 0, [], others, '')).toHaveLength(1)
  })
})
