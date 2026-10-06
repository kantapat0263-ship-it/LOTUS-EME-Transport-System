import { describe, it, expect } from 'vitest'
import { editStopNote, stopNoteKey, applyNoteEdit, StopNoteConflictError } from './stopNote'

const stops = [
  { order: 1, siteName: 'CP All - Udon Thani', dispatcherNote: 'ขากลับให้นำรถแค็ป ถส-5964 กลับมา', dispatcherName: 'มนทิรา จงบุรี' },
  { order: 2, siteName: 'สสวท.' },
]

describe('stopNote: แก้หมายเหตุคนจัดรถรายจุดในทริป', () => {
  it('คีย์ legacy ของ trip.stopNotes ผูกกับลำดับจุดในทริป', () => {
    expect(stopNoteKey(0)).toBe('stop_0')
  })

  it('แก้ข้อความ → เก็บบน stop พร้อมชื่อคนแก้ล่าสุด (ตัดช่องว่างหัวท้าย)', () => {
    const next = editStopNote(stops, 0, '  ขากลับให้นำรถแค็ป ถส-5694 กลับมา \n', 'คนจัดรถ ก')
    expect(next[0]).toMatchObject({ dispatcherNote: 'ขากลับให้นำรถแค็ป ถส-5694 กลับมา', dispatcherName: 'คนจัดรถ ก' })
  })

  it('ล้างข้อความ → ลบทั้งหมายเหตุและชื่อออกจาก stop (ไม่เหลือ key ว่าง)', () => {
    const next = editStopNote(stops, 0, '   ', 'คนจัดรถ ก')
    expect('dispatcherNote' in next[0]).toBe(false)
    expect('dispatcherName' in next[0]).toBe(false)
    expect(next[0].siteName).toBe('CP All - Udon Thani')
  })

  it('จุดอื่นไม่เปลี่ยน และไม่แก้ array เดิม', () => {
    const next = editStopNote(stops, 1, 'ใหม่', 'ข')
    expect(next[0]).toBe(stops[0])
    expect(next[1]).toMatchObject({ siteName: 'สสวท.', dispatcherNote: 'ใหม่', dispatcherName: 'ข' })
    expect(stops[1]).toEqual({ order: 2, siteName: 'สสวท.' })
  })

  it('ลำดับนอกช่วง → throw (กันเขียนผิดจุด)', () => {
    expect(() => editStopNote(stops, 5, 'x', 'ก')).toThrow()
    expect(() => editStopNote(stops, -1, 'x', 'ก')).toThrow()
  })
})

describe('stopNote: applyNoteEdit (ใช้ใน transaction — อ่านทริปสดแล้วแก้เฉพาะจุดเดิม)', () => {
  const live = [
    { order: 1, siteName: 'CP All - Udon Thani', outcome: 'delivered' },
    { order: 2, siteName: 'สสวท.', dispatcherNote: 'คนอื่นเพิ่งแก้', dispatcherName: 'ข' },
  ]

  it('จุดเดิม (ชื่อ+ลำดับตรง) → แก้เฉพาะจุดนั้น เก็บของที่คนอื่นเพิ่งแก้ในจุดอื่นไว้', () => {
    const next = applyNoteEdit(live, 0, { siteName: 'CP All - Udon Thani', order: 1 }, 'ใหม่', 'ก')
    expect(next[0]).toMatchObject({ outcome: 'delivered', dispatcherNote: 'ใหม่', dispatcherName: 'ก' })
    expect(next[1]).toBe(live[1])
  })

  it('จุดในทริปสดไม่ใช่จุดเดิม (ถูกลบ/แทรก/สลับไประหว่างเปิดหน้าต่าง) → throw StopNoteConflictError', () => {
    expect(() => applyNoteEdit(live, 0, { siteName: 'สสวท.', order: 2 }, 'x', 'ก')).toThrow(StopNoteConflictError)
    expect(() => applyNoteEdit(live, 5, { siteName: 'CP All - Udon Thani', order: 1 }, 'x', 'ก')).toThrow(StopNoteConflictError)
  })

  it('ไม่มีชื่อผู้แก้ → throw (กันบันทึกตอนโปรไฟล์ยังไม่โหลด)', () => {
    expect(() => applyNoteEdit(live, 0, { siteName: 'CP All - Udon Thani', order: 1 }, 'x', '  ')).toThrow()
  })
})
