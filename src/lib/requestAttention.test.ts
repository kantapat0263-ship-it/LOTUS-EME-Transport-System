import { describe, it, expect } from 'vitest'
import { isAwaitingPickup, sortForManage, waitingLabel, requestCreatedMs } from './requestAttention'

const ts = (ms: number) => ({ toDate: () => new Date(ms) })
const T0 = Date.parse('2026-10-16T09:00:00+07:00')

describe('requestAttention: คำขอที่ยังไม่มีใครรับงาน', () => {
  it('isAwaitingPickup: เฉพาะ pending (ตรงกับเลขบนเมนู "ขอรถ")', () => {
    expect(isAwaitingPickup({ status: 'pending' })).toBe(true)
    for (const status of ['in_progress', 'partial', 'rescheduled', 'cancelled', 'approved', undefined]) {
      expect(isAwaitingPickup({ status })).toBe(false)
    }
  })

  it('requestCreatedMs: อ่าน Timestamp ได้ · ยังไม่มีเวลา (serverTimestamp ค้างเขียน) / ผิดชนิด = null', () => {
    expect(requestCreatedMs({ createdAt: ts(T0) })).toBe(T0)
    expect(requestCreatedMs({ createdAt: null })).toBeNull()
    expect(requestCreatedMs({})).toBeNull()
    expect(requestCreatedMs({ createdAt: 'x' })).toBeNull()
    expect(requestCreatedMs({ createdAt: ts(NaN) })).toBeNull()
  })

  it('sortForManage: ใบรอรับงานขึ้นก่อน ที่เหลือคงลำดับใหม่สุดก่อนเหมือนเดิม ไม่แก้ array เดิม', () => {
    const reqs = [
      { id: 'a', status: 'in_progress', createdAt: ts(T0 + 3) },
      { id: 'b', status: 'pending', createdAt: ts(T0 + 1) },
      { id: 'c', status: 'in_progress', createdAt: ts(T0 + 4) },
      { id: 'd', status: 'pending', createdAt: ts(T0 + 2) },
      { id: 'e', status: 'partial', createdAt: null },
    ]
    const copy = [...reqs]
    expect(sortForManage(reqs).map((r) => r.id)).toEqual(['d', 'b', 'c', 'a', 'e'])
    expect(reqs).toEqual(copy)
  })

  it('waitingLabel: เวลาที่รอนับจากส่งคำขอ', () => {
    const at = (min: number) => T0 + min * 60_000
    expect(waitingLabel(null, T0)).toBeNull()
    expect(waitingLabel(T0, at(0.5))).toBe('ส่งมาเมื่อสักครู่')
    expect(waitingLabel(T0, at(-2))).toBe('ส่งมาเมื่อสักครู่') // นาฬิกาเครื่องเดินช้ากว่า server
    expect(waitingLabel(T0, at(12))).toBe('ส่งมา 12 นาทีที่แล้ว')
    expect(waitingLabel(T0, at(60))).toBe('ส่งมา 1 ชม.ที่แล้ว')
    expect(waitingLabel(T0, at(135))).toBe('ส่งมา 2 ชม. 15 นาทีที่แล้ว')
    expect(waitingLabel(T0, at(60 * 24 + 5))).toBe('ส่งมา 1 วันที่แล้ว')
    expect(waitingLabel(T0, at(60 * 24 * 3))).toBe('ส่งมา 3 วันที่แล้ว')
  })
})
