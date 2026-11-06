import { describe, it, expect } from 'vitest'
import {
  enforceSetOrder, isOneOffJobStop, isSequenceStop, jobSetFields, jobSetLabel, jobSetMateReminder, orderSequences, postponedSequenceNote,
  SEQUENCE_MAX_STOPS, SEQUENCE_RELOAD, SEQUENCE_WARNING, sequenceLabel, sequenceMateReminder, sequenceNoteForDriver, sequenceRouteText,
  sequenceShapeProblem, sequenceStopFields, type SequenceFields,
} from './sequence'
import { activeTransferSet, stopSetKey, transferDisplayOrder, transferSetOutside, transferStopName, type TransferFields } from './transfer'

type S = SequenceFields & TransferFields & { id: string; siteName: string; outcome?: string; siteId?: string; lat?: number; lng?: number; assistForPlate?: string; postponedRequestId?: string }
// ไซต์A (รับคนงาน) → สนง.เอกสาร → ไซต์A (ส่งกลับ)
const Q = (id: string, index: number, siteName: string, group = 'sq_1', size = 3): S => ({ id, siteName, sequenceId: group, sequenceIndex: index, sequenceSize: size })
const N = (id: string, siteName = id): S => ({ id, siteName })
const P = (id: string, group = 'tf_1', siteName = id): S => ({ id, siteName, transferRole: 'pickup', transferId: group })
const D = (id: string, group = 'tf_1', siteName = id): S => ({ id, siteName, transferRole: 'drop', transferId: group })
const ids = (items: { id: string }[]) => items.map(i => i.id).join(',')
const trip = () => [Q('a1', 0, 'ไซต์A'), Q('doc', 1, 'สนง.เอกสาร'), Q('a2', 2, 'ไซต์A')]

describe('isSequenceStop / fields', () => {
  it('ต้องมี sequenceId และ sequenceIndex เป็นจำนวนเต็ม ≥ 0', () => {
    expect(isSequenceStop(Q('x', 0, 'A'))).toBe(true)
    expect(isSequenceStop({ sequenceId: 'sq', sequenceIndex: -1 })).toBe(false)
    expect(isSequenceStop({ sequenceId: '', sequenceIndex: 0 })).toBe(false)
    expect(isSequenceStop({ sequenceId: 'sq', sequenceIndex: 1.5 })).toBe(false)
    expect(isSequenceStop(N('x'))).toBe(false)
    expect(isSequenceStop(null)).toBe(false)
  })
  it('sequenceStopFields คัดเฉพาะฟิลด์ชุด · งานปกติได้ {} (ไม่เขียน undefined)', () => {
    expect(sequenceStopFields(Q('x', 1, 'A'))).toEqual({ sequenceId: 'sq_1', sequenceIndex: 1, sequenceSize: 3 })
    expect(sequenceStopFields({ sequenceId: 'sq', sequenceIndex: 0 })).toEqual({ sequenceId: 'sq', sequenceIndex: 0 })
    expect(sequenceStopFields(N('x'))).toEqual({})
  })
  it('jobSetFields รวมทั้งสองแบบ', () => {
    expect(jobSetFields(P('p'))).toEqual({ transferRole: 'pickup', transferId: 'tf_1' })
    expect(jobSetFields(Q('x', 0, 'A'))).toEqual({ sequenceId: 'sq_1', sequenceIndex: 0, sequenceSize: 3 })
    expect(jobSetFields(N('x'))).toEqual({})
  })
  it('isOneOffJobStop = รับ-ส่ง หรือ งานต่อเนื่อง', () => {
    expect(isOneOffJobStop(P('p'))).toBe(true)
    expect(isOneOffJobStop(Q('x', 0, 'A'))).toBe(true)
    expect(isOneOffJobStop(N('x'))).toBe(false)
  })
})

describe('sequenceShapeProblem', () => {
  const A = { siteId: 'site-a' }
  const B = { siteId: 'doc' }
  it('ไม่มี sequenceIndex เลย = ไม่ใช่ใบแบบนี้ (ผ่าน)', () => {
    expect(sequenceShapeProblem([{}, {}])).toBeNull()
    expect(sequenceShapeProblem([{ transferRole: 'pickup' }, { transferRole: 'drop' }])).toBeNull()
  })
  it('ไป-กลับ A → B → A ผ่าน', () => {
    expect(sequenceShapeProblem([{ sequenceIndex: 0 }, { sequenceIndex: 1 }, { sequenceIndex: 2 }], [A, B, A])).toBeNull()
  })
  it('index ไม่ตรงตำแหน่ง / ขาดบางจุด / ปนงานรับ-ส่ง → ให้โหลดหน้าใหม่', () => {
    expect(sequenceShapeProblem([{ sequenceIndex: 1 }, { sequenceIndex: 0 }])).toBe(SEQUENCE_RELOAD)
    expect(sequenceShapeProblem([{ sequenceIndex: 0 }, {}])).toBe(SEQUENCE_RELOAD)
    expect(sequenceShapeProblem([{ sequenceIndex: 0, transferRole: 'pickup' }, { sequenceIndex: 1 }])).toBe(SEQUENCE_RELOAD)
    expect(sequenceShapeProblem([{ sequenceIndex: '0' }, { sequenceIndex: 1 }])).toBe(SEQUENCE_RELOAD)
  })
  it('จุดเดียว → ให้ใช้งานปกติ · เกินจำนวน → แยกใบ', () => {
    expect(sequenceShapeProblem([{ sequenceIndex: 0 }])).toContain('งานปกติ')
    const many = Array.from({ length: SEQUENCE_MAX_STOPS + 1 }, (_, i) => ({ sequenceIndex: i }))
    expect(sequenceShapeProblem(many)).toContain(`${SEQUENCE_MAX_STOPS} จุด`)
  })
  it('จุดติดกันที่เดียวกัน (รหัสไซต์ หรือพิกัดตรงกัน) → บอกเลขจุด', () => {
    expect(sequenceShapeProblem([{ sequenceIndex: 0 }, { sequenceIndex: 1 }], [A, A])).toBe('จุดที่ 2 เป็นที่เดียวกับจุดที่ 1 — รวมงานไว้ในจุดเดียว')
    expect(sequenceShapeProblem([{ sequenceIndex: 0 }, { sequenceIndex: 1 }, { sequenceIndex: 2 }],
      [A, { lat: 13.7, lng: 100.5 }, { lat: 13.7, lng: 100.5 }])).toContain('จุดที่ 3')
    // ไม่ติดกัน (ไป-กลับ) ได้ · ไม่มีข้อมูลสถานที่ = ไม่ตรวจที่ซ้ำ
    expect(sequenceShapeProblem([{ sequenceIndex: 0 }, { sequenceIndex: 1 }], [{}, {}])).toBeNull()
  })
})

describe('orderSequences / enforceSetOrder', () => {
  it('Google สลับ + แทรกงานอื่นกลางชุด → จุดของชุดติดกันตามลำดับ ณ ตำแหน่งตัวแรก งานอื่นคงลำดับเดิม', () => {
    const [a1, doc, a2] = trip()
    expect(ids(orderSequences([N('x'), a2, N('y'), a1, doc, N('z')]))).toBe('x,a1,doc,a2,y,z')
  })
  it('ไม่มีงานต่อเนื่อง = ลำดับเดิมทุกตำแหน่ง', () => {
    const items = [N('x'), P('p'), D('d'), N('y')]
    expect(orderSequences(items)).toEqual(items)
  })
  it('สองชุดแยกกันไม่ปนกัน', () => {
    const s1 = [Q('a', 0, 'A', 'sq_1', 2), Q('b', 1, 'B', 'sq_1', 2)]
    const s2 = [Q('c', 0, 'C', 'sq_2', 2), Q('d', 1, 'D', 'sq_2', 2)]
    expect(ids(orderSequences([s2[1], s1[1], s2[0], s1[0]]))).toBe('c,d,a,b')
  })
  it('เลขขาดช่วง (ถอดบางจุดแล้ว) ยังเรียงตามลำดับสัมพัทธ์', () => {
    expect(ids(orderSequences([Q('c', 4, 'C'), N('x'), Q('a', 0, 'A')]))).toBe('a,c,x')
  })
  it('รวมกับงานรับ-ส่ง: จุดส่งที่ถูกย้ายไปติดจุดรับ ไม่แทรกกลางงานต่อเนื่องที่อยู่ที่เดียวกัน', () => {
    // [D, P(ร้าน), S1(ร้าน), S2(ไซต์)] → orderPickupsBeforeDrop วาง D หลังงานที่ร้าน (กลางชุด) → enforceSetOrder ดึงชุดกลับมาติดกัน
    const p = { ...P('p'), siteId: 'shop' }
    const d = { ...D('d'), siteId: 'site' }
    const s1 = { ...Q('s1', 0, 'ร้าน', 'sq_1', 2), siteId: 'shop' }
    const s2 = { ...Q('s2', 1, 'ไซต์', 'sq_1', 2), siteId: 'site' }
    expect(ids(enforceSetOrder([d, p, s1, s2]))).toBe('p,s1,s2,d')
  })
})

describe('sequenceLabel', () => {
  it('จุดที่ k/n + ต่อจากจุดก่อนหน้า', () => {
    const peers = trip()
    expect(sequenceLabel(peers, 0)).toEqual({ role: 'sequence', text: '🔁 จุดที่ 1/3' })
    expect(sequenceLabel(peers, 1)).toEqual({ role: 'sequence', text: '🔁 จุดที่ 2/3 · ต่อจาก ไซต์A' })
    expect(sequenceLabel(peers, 2)?.text).toBe('🔁 จุดที่ 3/3 · ต่อจาก สนง.เอกสาร')
    expect(sequenceLabel([N('x')], 0)).toBeNull()
  })
  it('บางจุดไม่ได้ไปกับเที่ยวนี้ (ถอดไปคันอื่น/เลื่อน) → เตือนเลขจุด', () => {
    const peers = [Q('a1', 0, 'ไซต์A'), Q('doc', 1, 'สนง.เอกสาร')]
    expect(sequenceLabel(peers, 0)).toMatchObject({ warning: 'จุดที่ 3 ไม่ได้ไปกับเที่ยวนี้', missing: [3] })
    const postponed = [...trip()]
    postponed[2] = { ...postponed[2], outcome: 'postponed' }
    expect(sequenceLabel(postponed, 1)?.warning).toBe('จุดที่ 3 ไม่ได้ไปกับเที่ยวนี้')
    // จุดที่ไม่ทำแล้วเองไม่มีคำเตือน (มีป้ายเลื่อน/โยกบอกอยู่แล้ว)
    expect(sequenceLabel(postponed, 2)?.warning).toBeUndefined()
  })
  it('ลำดับบนจอสลับกับลำดับที่ผู้ขอกรอก → เตือน', () => {
    const [a1, doc, a2] = trip()
    expect(sequenceLabel([doc, a1, a2], 0)?.warning).toBe(SEQUENCE_WARNING.outOfOrder)
    expect(sequenceLabel([doc, a1, a2], 1)?.warning).toBe(SEQUENCE_WARNING.outOfOrder)
    // จุดที่ไม่ได้ไปแล้วไม่นับว่าสลับ
    expect(sequenceLabel([{ ...doc, outcome: 'reassigned' }, a1, a2], 1)?.warning).toBe('จุดที่ 2 ไม่ได้ไปกับเที่ยวนี้')
  })
  it('ไม่มี sequenceSize (ข้อมูลเก่า) → ใช้เลขสูงสุดที่เห็น', () => {
    const old: S[] = [{ id: 'a', siteName: 'A', sequenceId: 's', sequenceIndex: 0 }, { id: 'b', siteName: 'B', sequenceId: 's', sequenceIndex: 1 }]
    expect(sequenceLabel(old, 1)?.text).toBe('🔁 จุดที่ 2/2 · ต่อจาก A')
  })
  it('jobSetLabel ใช้ได้ทั้งสองแบบ', () => {
    expect(jobSetLabel([P('p', 'tf_1', 'ร้าน'), D('d', 'tf_1', 'ไซต์')], 0)?.role).toBe('pickup')
    expect(jobSetLabel(trip(), 1)?.role).toBe('sequence')
    expect(jobSetLabel([N('x')], 0)).toBeNull()
  })
})

describe('reminders / notes', () => {
  it('sequenceMateReminder บอกจุดอื่นที่ยังไปกับเที่ยวนี้ (เรียงตามลำดับ)', () => {
    expect(sequenceMateReminder(trip(), 1)).toBe('ยังมี จุดที่ 1 ไซต์A, จุดที่ 3 ไซต์A ของงานต่อเนื่องเดียวกันอยู่ในเที่ยวนี้')
    expect(sequenceMateReminder([Q('a', 0, 'A')], 0)).toBeNull()
    expect(jobSetMateReminder(trip(), 0)).toContain('จุดที่ 2 สนง.เอกสาร')
  })
  it('postponedSequenceNote เขียนเส้นทางเดิมพร้อมเลขจุด + จุดที่เลื่อนมาด้วยกัน', () => {
    expect(postponedSequenceNote(trip(), 2)).toBe('(งานต่อเนื่อง 1.ไซต์A → 2.สนง.เอกสาร → 3.ไซต์A · ใบนี้ = จุดที่ 3 · เลื่อนมาเฉพาะจุดนี้)')
    expect(postponedSequenceNote(trip(), 0, [0, 1, 2])).toContain('· ใบนี้ = จุดที่ 1 · เลื่อนมาทั้งชุด)')
    // สนง.อยู่คันอื่น (ไม่อยู่ในลิสต์) แล้วเลื่อนทั้งชุดที่เหลือ → บอกว่าจุดที่ 2 อยู่คันอื่น และเลื่อนมาแค่ 1, 3
    const split = [Q('a1', 0, 'ไซต์A'), Q('a2', 2, 'ไซต์A')]
    expect(postponedSequenceNote(split, 1, [0, 1])).toBe('(งานต่อเนื่อง 1.ไซต์A → 2.(คันอื่น) → 3.ไซต์A · ใบนี้ = จุดที่ 3 · เลื่อนมาพร้อมกัน: จุดที่ 1, 3)')
    expect(postponedSequenceNote([N('x')], 0)).toBeNull()
    expect(sequenceRouteText([Q('b', 1, ''), Q('a', 0, 'A')], 'sq_1', 3)).toBe('1.A → 2.ไม่ระบุสถานที่ → 3.(คันอื่น)')
  })
  it('"ต่อจาก" ใช้จุดก่อนหน้าที่ยังไปกับเที่ยวนี้ (สนง.เลื่อนแล้ว = ต่อจากไซต์ ไม่ใช่สนง.)', () => {
    const [a1, doc, a2] = trip()
    expect(sequenceLabel([a1, { ...doc, outcome: 'postponed' }, a2], 2)?.text).toBe('🔁 จุดที่ 3/3 · ต่อจาก ไซต์A')
  })
  it('งานอื่นที่ยังไปคั่นกลางชุด → เตือนคนจัดรถ (ไม่บอกคนขับ) · งานที่ไม่ไปแล้วคั่นได้', () => {
    const [a1, doc, a2] = trip()
    const label = sequenceLabel([a1, doc, N('y'), a2], 3)
    expect(label?.warning).toBe(SEQUENCE_WARNING.interleaved)
    expect(sequenceNoteForDriver(label)).toBeNull()
    expect(sequenceLabel([a1, doc, { ...N('y'), outcome: 'reassigned' }, a2], 3)?.warning).toBeUndefined()
  })
  it('sequenceNoteForDriver', () => {
    const [a1, doc, a2] = trip()
    expect(sequenceNoteForDriver(sequenceLabel([doc, a1, a2], 0))).toContain('จุดที่ 1 ก่อน')
    expect(sequenceNoteForDriver(sequenceLabel([a1, doc], 0))).toBe('จุดที่ 3 ของงานนี้ไม่ได้อยู่ในใบงานนี้ — ถามคนจัดรถก่อนไป')
    expect(sequenceNoteForDriver(sequenceLabel(trip(), 0))).toBeNull()
  })
})

describe('ทำทั้งชุด (transfer.ts) ใช้ได้กับงานต่อเนื่อง', () => {
  it('stopSetKey แยกสองแบบ ไม่ชนกันแม้รหัสเหมือนกัน', () => {
    expect(stopSetKey(P('p', 'x'))).toBe('tf:x')
    expect(stopSetKey(Q('a', 0, 'A', 'x'))).toBe('sq:x')
    expect(stopSetKey(N('n'))).toBeNull()
  })
  it('activeTransferSet คืนทุกจุดของชุดที่ยังไปกับเที่ยวนี้ ไม่นับสำเนาคันช่วย/จุดที่ไม่ทำแล้ว', () => {
    const stops = [N('x'), ...trip(), { ...Q('copy', 1, 'สนง.เอกสาร'), assistForPlate: 'กข-1' }]
    expect(activeTransferSet(stops, 2)).toEqual([1, 2, 3])
    stops[3] = { ...stops[3], outcome: 'postponed' }
    expect(activeTransferSet(stops, 1)).toEqual([1, 2])
    expect(activeTransferSet(stops, 0)).toEqual([])
  })
  it('transferStopName บอกเลขจุด', () => {
    expect(transferStopName(Q('a', 2, 'ไซต์A'))).toBe('ไซต์A (จุดที่ 3)')
    expect(transferStopName(Q('a', 0, ''))).toBe('จุดงาน (จุดที่ 1)')
  })
  it('transferSetOutside บอกจุดของชุดที่อยู่คันอื่น', () => {
    const [a1, doc, a2] = trip()
    const lines = transferSetOutside([a1, doc], 0, [], [{ vehiclePlate: 'กข-9', stops: [a2] }], 'กข-1')
    expect(lines).toEqual(['ไซต์A (จุดที่ 3) — อยู่บนรถ กข-9 ไม่ถูกทำตาม — จัดการเองที่คันนั้น'])
  })
})

describe('transferDisplayOrder: งานต่อเนื่องที่โยกเข้า', () => {
  it('ไม่มีจุดลำดับถัดไปในเที่ยวนี้ → ต่อท้ายจุดลำดับก่อนหน้าของชุด (ไม่ต่อท้ายใบหลังงานอื่น)', () => {
    const [a1, doc, a2] = trip()
    const view = transferDisplayOrder([a1, doc, N('y')], [a2])
    expect(view.peers.map(p => p.id)).toEqual(['a1', 'doc', 'a2', 'y'])
  })
  it('มีจุดลำดับถัดไปในเที่ยวนี้ → ขึ้นก่อนจุดนั้น', () => {
    const [a1, doc, a2] = trip()
    expect(transferDisplayOrder([a1, a2, N('y')], [doc]).peers.map(p => p.id)).toEqual(['a1', 'doc', 'a2', 'y'])
  })
})
