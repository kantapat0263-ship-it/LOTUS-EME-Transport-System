import { describe, it, expect } from 'vitest'
import { computeDailySummary, computeStopStatuses, repeatOccurrences } from './tracking'

// งานไปหลายจุดตามลำดับ: ไซต์ (รับคนงาน) → สนง.เอกสาร → ไซต์ (ส่งกลับ) — ไซต์อยู่ไกลออฟฟิศ (เข้าใกล้ = ถึง)
const OFFICE = { lat: 14.0815, lng: 100.7129 }
const SITE = { lat: 13.7276, lng: 100.7796 }
const DOC = { lat: 13.8452, lng: 100.5603 }
const MIN = 60_000
const T0 = Date.UTC(2026, 10, 7, 1, 0) // 08:00 ไทย
const at = (p: { lat: number; lng: number }, minute: number) => ({ ...p, t: T0 + minute * MIN })
const stay = (p: { lat: number; lng: number }, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => at(p, from + k))
const seq = (order: number, p: { lat: number; lng: number }, index: number, siteName: string) => ({ order, ...p, siteName, sequenceId: 'sq_1', sequenceIndex: index })
const stops = [seq(1, SITE, 0, 'ไซต์'), seq(2, DOC, 1, 'สนง.เอกสาร'), seq(3, SITE, 2, 'ไซต์')]

describe('repeatOccurrences', () => {
  it('ไซต์ → สนง. → ไซต์: จุดที่ 3 = การไปไซต์รอบที่ 2', () => {
    expect(repeatOccurrences(stops)).toEqual([0, 0, 1])
  })
  it('จุดที่ไม่ใช่งานต่อเนื่อง / ไม่ซ้ำ = 0 ทั้งหมด (กติกาเดิม)', () => {
    expect(repeatOccurrences([{ ...SITE }, { ...DOC }, { ...SITE }])).toEqual([0, 0, 0])
    expect(repeatOccurrences([seq(1, SITE, 0, 'A'), seq(2, DOC, 1, 'B')])).toEqual([0, 0])
  })
  it('จุดกลางไม่ได้ไปแล้ว (เลื่อน/โยกออก) = ไซต์สองจุดติดกัน → รอบเดียวกัน', () => {
    const skipped = [stops[0], { ...stops[1], outcome: 'postponed' }, stops[2]]
    expect(repeatOccurrences(skipped)).toEqual([0, 0, 0])
  })
  it('ลำดับในทริปสลับกับลำดับที่ผู้ขอกรอก ยังนับตามลำดับที่ผู้ขอกรอก', () => {
    expect(repeatOccurrences([stops[2], stops[0], stops[1]])).toEqual([1, 0, 0])
  })
  it('สองชุดคนละใบที่ไซต์เดียวกัน ไม่นับต่อกัน', () => {
    const other = [{ ...seq(4, SITE, 0, 'ไซต์'), sequenceId: 'sq_2' }, { ...seq(5, DOC, 1, 'สนง.'), sequenceId: 'sq_2' }]
    expect(repeatOccurrences([...stops, ...other])).toEqual([0, 0, 1, 0, 0])
  })
})

describe('computeStopStatuses: กลับมาที่เดิม', () => {
  const morning = [at(OFFICE, 0), ...stay(SITE, 60, 75), at(OFFICE, 100), ...stay(DOC, 120, 240)]
  it('ไปถึงไซต์รอบแรกแล้วไปสนง. — จุดที่ 3 (ส่งกลับไซต์) ยังไม่ถึง = จุดปัจจุบัน', () => {
    const st = computeStopStatuses(stops, morning, { office: OFFICE })
    expect(st.map(s => s.arrived)).toEqual([true, true, false])
    expect(st[2].isCurrent).toBe(true)
  })
  it('กลับไปถึงไซต์รอบสอง → จุดที่ 3 ถึง เวลาถึง = รอบสอง', () => {
    const back = [...morning, at(OFFICE, 270), ...stay(SITE, 300, 310)]
    const st = computeStopStatuses(stops, back, { office: OFFICE })
    expect(st.map(s => s.arrived)).toEqual([true, true, true])
    expect(st[0].arrivedAt).toBe(T0 + 60 * MIN)
    expect(st[2].arrivedAt).toBe(T0 + 300 * MIN)
  })
  it('GPS กระโดดออกนอกรัศมีชั่วครู่ระหว่างจอดไซต์รอบแรก ไม่นับเป็นรอบสอง', () => {
    const bounce = [at(OFFICE, 0), ...stay(SITE, 60, 65), at(DOC, 66), ...stay(SITE, 66.5, 75)]
    expect(computeStopStatuses(stops, bounce, { office: OFFICE })[2].arrived).toBe(false)
  })
  it('งานปกติที่ไปที่เดิมสองจุด ยังนับถึงพร้อมกันเหมือนเดิม', () => {
    const plain = stops.map(({ sequenceId: _s, sequenceIndex: _i, ...rest }) => rest)
    expect(computeStopStatuses(plain, morning, { office: OFFICE }).map(s => s.arrived)).toEqual([true, true, true])
  })
  it('trail ไม่มีเวลา = แยกรอบไม่ได้ ใช้กติกาเดิม', () => {
    const untimed = [{ ...SITE }, { ...DOC }]
    expect(computeStopStatuses(stops, untimed).map(s => s.arrived)).toEqual([true, true, true])
  })
})

describe('computeDailySummary: เวลาถึงของจุดที่กลับมาที่เดิม', () => {
  it('จุดที่ 3 ได้เวลาถึงรอบสอง ไม่ใช่เวลาเช้าซ้ำกับจุดที่ 1', () => {
    const trail = [...stay(OFFICE, 0, 10), ...stay(SITE, 60, 75), ...stay(DOC, 120, 240), ...stay(SITE, 300, 310), ...stay(OFFICE, 360, 380)]
    const sum = computeDailySummary(trail, stops, OFFICE)
    expect(sum.stops[0].arrivedAt).toBe(T0 + 60 * MIN)
    expect(sum.stops[2].arrivedAt).toBe(T0 + 300 * MIN)
    // จอดรอบแรกไม่ถูกรวมเข้ากับจุดที่ 3 · จุดที่ 1 ไม่ถูกรวมรอบหลัง (ตัดที่เวลาถึงจุดถัดไป)
    expect(sum.stops[0].departedAt).toBe(T0 + 75 * MIN)
    expect(sum.stops[2].departedAt).toBe(T0 + 310 * MIN)
  })
})
