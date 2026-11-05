import { describe, it, expect } from 'vitest'
import { buildDropDescription, orderPickupsBeforeDrop, postponedPickupNote, TRANSFER_WARNING, transferDisplayOrder, transferLabel, transferMateReminder, transferNoteForDriver, transferShapeProblem, transferStopFields, type TransferFields } from './transfer'

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
