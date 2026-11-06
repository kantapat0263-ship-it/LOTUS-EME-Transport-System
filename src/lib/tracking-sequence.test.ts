import { describe, it, expect } from 'vitest'
import { computeDailySummary, computeStopStatuses, returnVisitPlans } from './tracking'

// งานไปหลายจุดตามลำดับ: ไซต์ (รับคนงาน) → สนง.เอกสาร → ไซต์ (ส่งกลับ) — ไซต์อยู่ไกลออฟฟิศ (เข้าใกล้ = ถึง)
const OFFICE = { lat: 14.0815, lng: 100.7129 }
const SITE = { lat: 13.7276, lng: 100.7796 }
const DOC = { lat: 13.8452, lng: 100.5603 }
const NEAR_SITE_OUT = { lat: 13.7310, lng: 100.7796 } // ห่างหมุดไซต์ ~380 ม. (นอกรัศมี 300 ม.)
const MIN = 60_000
const T0 = Date.UTC(2026, 10, 7, 1, 0) // 08:00 ไทย
const at = (p: { lat: number; lng: number }, minute: number) => ({ ...p, t: T0 + minute * MIN })
const stay = (p: { lat: number; lng: number }, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => at(p, from + k))
const seq = (order: number, p: { lat: number; lng: number }, index: number, siteName: string, extra: Record<string, unknown> = {}) =>
  ({ order, ...p, siteName, sequenceId: 'sq_1', sequenceIndex: index, ...extra })
const stops = [seq(1, SITE, 0, 'ไซต์'), seq(2, DOC, 1, 'สนง.เอกสาร'), seq(3, SITE, 2, 'ไซต์')]

describe('returnVisitPlans', () => {
  it('ไซต์ → สนง. → ไซต์: จุดที่ 3 ต้องถึงหลังจุดที่ 2 (anchor)', () => {
    expect(returnVisitPlans(stops)).toEqual([null, null, { anchor: 1 }])
  })
  it('จุดที่ไม่ใช่งานต่อเนื่อง / ไม่ซ้ำ = ไม่มีแผน (กติกาเดิม)', () => {
    expect(returnVisitPlans([{ ...SITE }, { ...DOC }, { ...SITE }])).toEqual([null, null, null])
    expect(returnVisitPlans([seq(1, SITE, 0, 'A'), seq(2, DOC, 1, 'B')])).toEqual([null, null])
  })
  it('จุดกลางอยู่ในเที่ยวแต่ไม่ไปแล้ว (เลื่อน) = รถไม่ได้ออกไป → ไซต์สองจุดเป็นรอบเดียวกัน', () => {
    expect(returnVisitPlans([stops[0], { ...stops[1], outcome: 'postponed' }, stops[2]])).toEqual([null, null, null])
  })
  it('จุดกลางไม่อยู่ในเที่ยวนี้เลย (คันช่วยได้แค่จุด 1 กับ 3) → ต้องเป็นการกลับมารอบใหม่ (after)', () => {
    expect(returnVisitPlans([stops[0], stops[2]])).toEqual([null, { after: 0 }])
  })
  it('ลำดับในทริปสลับกับลำดับที่ผู้ขอกรอก ยังอ้างจุดก่อนหน้าตามลำดับที่ผู้ขอกรอก', () => {
    expect(returnVisitPlans([stops[2], stops[0], stops[1]])).toEqual([{ anchor: 2 }, null, null])
  })
  it('สองชุดคนละใบที่ไซต์เดียวกัน ไม่นับต่อกัน', () => {
    const other = [{ ...seq(4, SITE, 0, 'ไซต์'), sequenceId: 'sq_2' }, { ...seq(5, DOC, 1, 'สนง.'), sequenceId: 'sq_2' }]
    expect(returnVisitPlans([...stops, ...other])).toEqual([null, null, { anchor: 1 }, null, null])
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
  it('จอดไซต์นานไม่มีรายงาน แล้ว GPS เด้งออกนอกรัศมี/กลับเข้ามา (ก่อนไปสนง.) — ไม่นับเป็นการกลับมา', () => {
    const drift = [at(OFFICE, 0), ...stay(SITE, 60, 62), at(NEAR_SITE_OUT, 180), at(SITE, 181), at(SITE, 185), ...stay(DOC, 240, 300)]
    expect(computeStopStatuses(stops, drift, { office: OFFICE })[2].arrived).toBe(false)
  })
  it('คันช่วยได้แค่จุดที่ 1 กับ 3 (ไซต์ ไซต์): GPS เด้งช่วงสั้นไม่นับ · ออกไปนาน ≥ 10 นาทีแล้วกลับมา = ถึงจุดที่ 3', () => {
    const helper = [stops[0], stops[2]]
    const bounce = [at(OFFICE, 0), ...stay(SITE, 60, 62), at(NEAR_SITE_OUT, 180), ...stay(SITE, 181, 185)]
    expect(computeStopStatuses(helper, bounce, { office: OFFICE }).map(s => s.arrived)).toEqual([true, false])
    const away = [at(OFFICE, 0), ...stay(SITE, 60, 75), ...stay(DOC, 90, 150), ...stay(SITE, 200, 210)]
    const st = computeStopStatuses(helper, away, { office: OFFICE })
    expect(st.map(s => s.arrived)).toEqual([true, true])
    expect(st[1].arrivedAt).toBe(T0 + 200 * MIN)
  })
  it('คันช่วย: GPS เด้งออกจุดเดียวแล้วเงียบนาน (จอดนิ่ง) ไม่นับว่าออกไป', () => {
    const helper = [stops[0], stops[2]]
    const driftThenSilence = [at(OFFICE, 0), ...stay(SITE, 60, 62), at(NEAR_SITE_OUT, 63), ...stay(SITE, 180, 185)]
    expect(computeStopStatuses(helper, driftThenSilence, { office: OFFICE }).map(s => s.arrived)).toEqual([true, false])
  })
  it('หน้าติดตามตัดจุดกลางที่เลื่อนออก แต่ส่ง context ว่าจุดนั้นอยู่ในเที่ยว → ไซต์สองจุดเป็นรอบเดียวกัน (ถึงพร้อมกัน)', () => {
    const route = [stops[0], stops[2]]
    const context = [{ sequenceId: 'sq_1', sequenceIndex: 0 }, { sequenceId: 'sq_1', sequenceIndex: 1 }, { sequenceId: 'sq_1', sequenceIndex: 2 }]
    const once = [at(OFFICE, 0), ...stay(SITE, 60, 75), ...stay(OFFICE, 120, 130)]
    expect(computeStopStatuses(route, once, { office: OFFICE, sequenceContext: context }).map(s => s.arrived)).toEqual([true, true])
    expect(returnVisitPlans(route, undefined, context)).toEqual([null, null])
  })
  it('รถขับผ่าน สนง. ก่อนไปไซต์ (เข้ารัศมี) — จุดที่ 3 ไม่ถึงตอนเช้า (สนง.ต้องถึงหลังไซต์ก่อน)', () => {
    const driveBy = [at(OFFICE, 0), at(DOC, 30), ...stay(SITE, 60, 75)]
    expect(computeStopStatuses(stops, driveBy, { office: OFFICE })[2].arrived).toBe(false)
  })
  it('ไป สนง. ก่อนแล้วไปไซต์ครั้งเดียว — จุดที่ 3 ไม่ถึง', () => {
    const docFirst = [at(OFFICE, 0), ...stay(DOC, 30, 60), ...stay(SITE, 120, 140)]
    expect(computeStopStatuses(stops, docFirst, { office: OFFICE })[2].arrived).toBe(false)
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
  it('ยังไม่กลับไปไซต์ → จุดที่ 3 ไม่มีเวลาถึง (ไม่ใช่เวลาเช้า)', () => {
    const trail = [...stay(OFFICE, 0, 10), ...stay(SITE, 60, 75), ...stay(DOC, 120, 240)]
    expect(computeDailySummary(trail, stops, OFFICE).stops[2].arrivedAt).toBeNull()
  })
})
