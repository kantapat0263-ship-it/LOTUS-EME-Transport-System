import { describe, it, expect } from 'vitest'
import { parseThaiTime, normalizeRoads, RoadFloodDataError } from './roadFlood'

const FETCHED = Date.parse('2026-10-05T14:13:00+07:00')
const MIN = 60_000

/** record ดิบรูปแบบ POPNIX api_roads.php — ค่าเริ่มต้น = จุดท่วม 15 ซม. ที่ใช้ได้ */
function road(over: Record<string, unknown> = {}) {
  return {
    code: 'FL.T.01', kind: 1, grp: 1, name: 'ถ.ทดสอบ', road: 'ถนนทดสอบ', district: 'บางบอน', dir: null,
    lat: 13.7, lng: 100.5, depth: 15, measured_at: '2026-10-05 14:05:00', level: 'flood', since: '2026-10-05 13:40:00',
    ...over,
  }
}
function payload(roads: unknown[], summary: Record<string, unknown> = { latest: '2026-10-05 14:10:00', stale: false, scrape_failing: false }) {
  return { summary, roads }
}
/** เวลาไทยแบบ POPNIX จาก epoch ms */
function th(ms: number) {
  const d = new Date(ms + 7 * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

describe('parseThaiTime', () => {
  it('ตีความเป็น +07:00', () => expect(parseThaiTime('2026-10-05 14:05:00')).toBe(Date.parse('2026-10-05T07:05:00Z')))
  it.each([[''], [null], [123], ['2026-10-05T14:05:00'], ['2026-10-05 14:05'], ['2026-02-30 10:00:00'],
           ['2026-02-29 10:00:00'], ['2026-10-05 24:00:00'], ['2026-10-05 23:59:60'], ['2026-13-01 00:00:00']])
    ('%s → null', (s) => expect(parseThaiTime(s)).toBeNull())
  it('29 ก.พ. ปีอธิกสุรทินผ่าน', () => expect(parseThaiTime('2028-02-29 10:00:00')).not.toBeNull())
})

describe('normalizeRoads', () => {
  it('แยก flood/slight/dry/off — points มีแค่จุดที่มีน้ำ', () => {
    const s = normalizeRoads(payload([
      road({ code: 'A', level: 'flood' }), road({ code: 'B', level: 'slight', depth: 7 }),
      road({ code: 'C', level: 'dry', depth: 0 }), road({ code: 'D', level: 'off', depth: null }),
    ]), FETCHED)
    expect(s.points.map((p) => p.code).sort()).toEqual(['A', 'B'])
    expect([s.usable, s.offline, s.assessable, s.invalid]).toEqual([4, 1, 3, 0])
  })

  it('record เสีย (level แปลก, พิกัด 0,0, สลับแกน, ไม่มี code, ไม่มีเวลา) → invalid', () => {
    const s = normalizeRoads(payload([
      road({ code: 'L', level: 'wet' }), road({ code: 'Z', lat: 0, lng: 0 }), road({ code: 'S', lat: 100.5, lng: 13.7 }),
      road({ code: undefined }), road({ code: 'T', measured_at: null }), road({ code: 'OK', level: 'dry' }),
    ]), FETCHED)
    expect(s.invalid).toBe(5)
    expect(s.usable).toBe(1)
    expect(s.points).toEqual([])
  })

  it('depth null หรือ string → depthCm null (ไม่กลายเป็น 0)', () => {
    const s = normalizeRoads(payload([road({ code: 'N', depth: null }), road({ code: 'S', depth: '15' })]), FETCHED)
    expect(s.points.map((p) => p.depthCm)).toEqual([null, null])
  })

  it('grp 2 ที่ 20 ซม. = อย่างน้อย 20 · kind 2 = อุโมงค์', () => {
    const s = normalizeRoads(payload([
      road({ code: 'G2', grp: 2, depth: 20 }), road({ code: 'G1', grp: 1, depth: 20 }), road({ code: 'TN', kind: 2 }),
    ]), FETCHED)
    const by = Object.fromEntries(s.points.map((p) => [p.code, p]))
    expect(by.G2.depthAtLeast).toBe(true)
    expect(by.G1.depthAtLeast).toBe(false)
    expect(by.TN.isTunnel).toBe(true)
    expect(by.G1.isTunnel).toBe(false)
  })

  it('code ซ้ำ: wet เก่า + dry ใหม่ → ใช้ dry (ไม่ปักหมุด wet เก่า)', () => {
    const s = normalizeRoads(payload([
      road({ code: 'A', level: 'flood', measured_at: '2026-10-05 13:00:00' }),
      road({ code: 'A', level: 'dry', measured_at: '2026-10-05 14:00:00' }),
    ]), FETCHED)
    expect(s.points).toHaveLength(0)
    expect(s.usable).toBe(1)
    expect(s.invalid).toBe(0)
  })

  it('code ซ้ำเวลาเท่ากัน → ตัวแรกในฟีดชนะ', () => {
    const s = normalizeRoads(payload([road({ code: 'A', level: 'flood' }), road({ code: 'A', level: 'dry' })]), FETCHED)
    expect(s.points.map((p) => p.level)).toEqual(['flood'])
  })

  it('ตัวใหม่สุด level เสีย → invalid ทั้ง code ไม่ย้อนใช้ dry เก่า', () => {
    const s = normalizeRoads(payload([
      road({ code: 'A', level: 'dry', measured_at: '2026-10-05 14:00:00' }),
      road({ code: 'A', level: '???', measured_at: '2026-10-05 14:10:00' }),
      road({ code: 'B', level: 'dry' }),
    ]), FETCHED)
    expect(s.usable).toBe(1)
    expect(s.invalid).toBe(1)
  })

  it('ตัวใหม่สุดพิกัดเสีย → invalid ไม่ย้อนใช้ตัวเก่า', () => {
    const s = normalizeRoads(payload([
      road({ code: 'A', level: 'dry', measured_at: '2026-10-05 14:00:00' }),
      road({ code: 'A', level: 'flood', lat: 0, lng: 0, measured_at: '2026-10-05 14:10:00' }),
      road({ code: 'B', level: 'dry' }),
    ]), FETCHED)
    expect(s.points.find((p) => p.code === 'A')).toBeUndefined()
    expect(s.usable).toBe(1)
    expect(s.invalid).toBe(1)
  })

  it('ตัวที่เวลาอ่านไม่ได้ไม่ถือว่าใหม่กว่า → ใช้ dry เก่า + นับ invalid', () => {
    const s = normalizeRoads(payload([
      road({ code: 'A', level: 'dry', measured_at: '2026-10-05 14:00:00' }),
      road({ code: 'A', level: 'flood', measured_at: 'bad' }),
    ]), FETCHED)
    expect(s.usable).toBe(1)
    expect(s.points).toHaveLength(0)
    expect(s.invalid).toBe(1)
  })

  it('เวลาอนาคต: +5 นาทีผ่าน · +5 นาที 1 วิ invalid (เทียบ fetchedAt)', () => {
    const s = normalizeRoads(payload([
      road({ code: 'OK5', measured_at: th(FETCHED + 5 * MIN) }),
      road({ code: 'BAD', measured_at: th(FETCHED + 5 * MIN + 1000) }),
    ]), FETCHED)
    expect(s.points.map((p) => p.code)).toEqual(['OK5'])
    expect(s.invalid).toBe(1)
  })

  it('ทุก record เวลาอนาคตเกิน 5 นาที → throw', () => {
    expect(() => normalizeRoads(payload([road({ measured_at: th(FETCHED + 10 * MIN) })]), FETCHED)).toThrow(RoadFloodDataError)
  })

  it('ทุกจุดขัดข้อง → ไม่ throw แต่ assessable 0', () => {
    const s = normalizeRoads(payload([road({ code: 'A', level: 'off' }), road({ code: 'B', level: 'off' })]), FETCHED)
    expect(s.usable).toBe(2)
    expect(s.assessable).toBe(0)
  })

  it('summary: latest อนาคต → sourceLatest null · stale/scrape_failing → sourceStale', () => {
    const fut = normalizeRoads(payload([road()], { latest: th(FETCHED + 10 * MIN), stale: false, scrape_failing: false }), FETCHED)
    expect(fut.sourceLatest).toBeNull()
    const ok = normalizeRoads(payload([road()]), FETCHED)
    expect(ok.sourceLatest).toBe(Date.parse('2026-10-05T14:10:00+07:00'))
    expect(ok.sourceStale).toBe(false)
    expect(normalizeRoads(payload([road()], { latest: '2026-10-05 14:10:00', stale: true }), FETCHED).sourceStale).toBe(true)
    expect(normalizeRoads(payload([road()], { latest: '2026-10-05 14:10:00', scrape_failing: true }), FETCHED).sourceStale).toBe(true)
    expect(ok.fetchedAt).toBe(FETCHED)
  })

  it('ข้อความ: ชื่อว่าง → "จุดวัด {code}" · ช่องว่างล้วน → null · ยาวเกิน 120 ตัด', () => {
    const s = normalizeRoads(payload([
      road({ code: 'FL.T.01', name: '', road: '  ' }), road({ code: 'LONG', name: 'ก'.repeat(200) }),
    ]), FETCHED)
    const by = Object.fromEntries(s.points.map((p) => [p.code, p]))
    expect(by['FL.T.01'].name).toBe('จุดวัด FL.T.01')
    expect(by['FL.T.01'].road).toBeNull()
    expect(by.LONG.name).toHaveLength(120)
  })

  it('เก็บค่าที่ต้องใช้แสดงผล (เวลาวัด/เริ่มท่วม/พิกัด/ความลึก)', () => {
    const [p] = normalizeRoads(payload([road()]), FETCHED).points
    expect(p).toMatchObject({
      code: 'FL.T.01', name: 'ถ.ทดสอบ', road: 'ถนนทดสอบ', district: 'บางบอน', dir: null, lat: 13.7, lng: 100.5,
      level: 'flood', depthCm: 15, measuredAt: Date.parse('2026-10-05T14:05:00+07:00'),
      floodingSince: Date.parse('2026-10-05T13:40:00+07:00'),
    })
  })

  it.each([[{}], [{ roads: 'x' }], [{ roads: [] }], [null], [payload([road({ code: undefined }), road({ level: 'x' })])]])
    ('ข้อมูลใช้ไม่ได้ทั้งชุด → throw (%#)', (raw) => {
      expect(() => normalizeRoads(raw, FETCHED)).toThrow(RoadFloodDataError)
    })
})
