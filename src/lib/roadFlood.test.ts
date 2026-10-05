import { describe, it, expect } from 'vitest'
import {
  parseThaiTime, normalizeRoads, RoadFloodDataError, summarizeFlood, depthLabel, ageLabel, formatThaiClock,
  markerKey, parseRoadEventsResponse, floodStatusText,
  type FloodPoint, type RoadFloodSnapshot, type VisibleFloodPoint,
} from './roadFlood'

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

// ---------- Task 2: สรุปผล / ป้าย / ข้อความแถบสถานะ ----------

const NOW = Date.parse('2026-10-05T14:20:00+07:00')

function pt(over: Partial<FloodPoint> = {}): FloodPoint {
  return {
    code: 'P1', name: 'ถ.ทดสอบ', road: null, district: null, dir: null, isTunnel: false, lat: 13.7, lng: 100.5,
    level: 'flood', depthCm: 15, depthAtLeast: false, measuredAt: NOW - 5 * MIN, floodingSince: null, ...over,
  }
}
function snap(points: FloodPoint[], over: Partial<RoadFloodSnapshot> = {}): RoadFloodSnapshot {
  return {
    fetchedAt: Date.parse('2026-10-05T14:13:00+07:00'), sourceLatest: Date.parse('2026-10-05T14:10:00+07:00'),
    sourceStale: false, points, usable: 240, offline: 18, assessable: 222, invalid: 0, ...over,
  }
}

describe('summarizeFlood', () => {
  it('ขอบอายุจุด 45 นาที / 180 นาที', () => {
    const s = summarizeFlood(snap([
      pt({ code: 'A45', measuredAt: NOW - 45 * MIN }), pt({ code: 'B45', measuredAt: NOW - 45 * MIN - 1 }),
      pt({ code: 'C180', measuredAt: NOW - 180 * MIN }), pt({ code: 'D180', measuredAt: NOW - 180 * MIN - 1 }),
    ]), NOW)
    const aging = Object.fromEntries(s.visible.map((p) => [p.code, p.aging]))
    expect(aging).toEqual({ A45: false, B45: true, C180: true })
    expect(s.tooOld).toBe(1)
  })

  it('เวลาวัดล้ำหน้าเล็กน้อย → อายุ 0 (ไม่ aging)', () => {
    const s = summarizeFlood(snap([pt({ measuredAt: NOW + 60_000 })]), NOW)
    expect(s.visible.map((p) => p.aging)).toEqual([false])
  })

  it('นับ flood/slight จากจุดที่แสดงเท่านั้น + ส่งต่อจำนวนอื่น', () => {
    const s = summarizeFlood(snap([
      pt({ code: 'F', level: 'flood' }), pt({ code: 'S', level: 'slight' }),
      pt({ code: 'OLD', level: 'flood', measuredAt: NOW - 200 * MIN }),
    ], { invalid: 2 }), NOW)
    expect([s.flood, s.slight, s.tooOld, s.offline, s.invalid, s.usable, s.assessable]).toEqual([1, 1, 1, 18, 2, 240, 222])
  })

  it('ความเก่าของทั้งชุดคิดเป็นนาที ณ เวลาแสดงผล', () => {
    const at45 = summarizeFlood(snap([], { sourceLatest: NOW - 45 * MIN }), NOW)
    expect(at45.sourceAgeMin).toBe(45)
    expect(at45.sourceOld).toBe(false)
    expect(summarizeFlood(snap([], { sourceLatest: NOW - 45 * MIN - 1 }), NOW).sourceOld).toBe(true)
    const unknown = summarizeFlood(snap([], { sourceLatest: null }), NOW)
    expect(unknown.sourceAgeMin).toBeNull()
    expect(unknown.sourceOld).toBe(true)
    expect(summarizeFlood(snap([], { sourceStale: true }), NOW).sourceOld).toBe(true)
    expect(summarizeFlood(snap([], { sourceLatest: NOW + 60_000 }), NOW).sourceAgeMin).toBe(0)
  })
})

describe('ป้ายและเวลา', () => {
  it('depthLabel', () => {
    expect(depthLabel({ depthCm: 15, depthAtLeast: false })).toBe('15')
    expect(depthLabel({ depthCm: 20, depthAtLeast: true })).toBe('≥20')
    expect(depthLabel({ depthCm: null, depthAtLeast: false })).toBe('?')
  })
  it('ageLabel', () => {
    expect(ageLabel(30_000)).toBe('เพิ่งวัด')
    expect(ageLabel(8 * MIN)).toBe('8 นาทีที่แล้ว')
    expect(ageLabel(60 * MIN)).toBe('1 ชม.ที่แล้ว')
    expect(ageLabel(80 * MIN)).toBe('1 ชม. 20 นาทีที่แล้ว')
  })
  it('formatThaiClock ใช้เวลาไทย', () => {
    expect(formatThaiClock(Date.parse('2026-10-05T07:05:00Z'))).toBe('14:05')
  })
  it('markerKey ไม่ขึ้นกับลำดับ แต่เปลี่ยนเมื่อสี/ป้ายเปลี่ยน', () => {
    const a: VisibleFloodPoint = { ...pt({ code: 'A' }), aging: false }
    const b: VisibleFloodPoint = { ...pt({ code: 'B', level: 'slight' }), aging: false }
    expect(markerKey([a, b])).toBe(markerKey([b, a]))
    expect(markerKey([a, b])).not.toBe(markerKey([{ ...a, aging: true }, b]))
    expect(markerKey([a, b])).not.toBe(markerKey([{ ...a, depthAtLeast: true, depthCm: 20 }, b]))
  })
})

describe('parseRoadEventsResponse', () => {
  it('รูปถูก → snapshot', () => {
    const s = snap([pt()])
    expect(parseRoadEventsResponse({ ok: true, snapshot: s })).toEqual(s)
  })
  it.each([[{ ok: false }], [null], ['x'], [{ ok: true, snapshot: { ...snap([]), points: undefined } }],
           [{ ok: true, snapshot: snap([{ ...pt(), lat: '13' as unknown as number }]) }]])
    ('รูปผิด → null (%#)', (json) => expect(parseRoadEventsResponse(json)).toBeNull())
})

describe('floodStatusText', () => {
  const base = { lastFailed: false, now: NOW }
  const ready = (s: RoadFloodSnapshot) => ({ ...base, phase: 'ready' as const, snapshot: s, summary: summarizeFlood(s, NOW) })

  it('loading', () => {
    const r = floodStatusText({ ...base, phase: 'loading', snapshot: null, summary: null })
    expect(r.tone).toBe('info')
    expect(r.text).toContain('กำลังโหลดข้อมูลน้ำท่วมถนน')
  })
  it('error ไม่มีชุดเก่า → ไม่แสดง "ท่วม 0"', () => {
    const r = floodStatusText({ ...base, phase: 'error', snapshot: null, summary: null })
    expect(r.tone).toBe('warn')
    expect(r.text).toContain('โหลดข้อมูลน้ำท่วมไม่ได้')
    expect(r.text).not.toContain('ท่วม 0')
  })
  it('จุดวัดขัดข้องทั้งหมด → ยังประเมินไม่ได้ ไม่แสดง "ท่วม 0"', () => {
    const r = floodStatusText(ready(snap([], { usable: 18, offline: 18, assessable: 0 })))
    expect(r.tone).toBe('warn')
    expect(r.text).toContain('ยังประเมินสถานการณ์ไม่ได้')
    expect(r.text).not.toContain('ท่วม 0')
  })
  it('ปกติ', () => {
    const s = snap([pt({ code: 'A' }), pt({ code: 'B' }), pt({ code: 'C', level: 'slight' })])
    const r = floodStatusText(ready(s))
    expect(r.tone).toBe('info')
    for (const t of ['ท่วม 2', 'เล็กน้อย 1', 'ขัดข้อง 18', 'จุดวัดที่ประเมินได้', 'ข้อมูล 14:10', 'ดึงเมื่อ 14:13']) expect(r.text).toContain(t)
    expect(r.text).not.toContain('เก่าเกิน')
    expect(r.text).not.toContain('ข้อมูลใช้ไม่ได้')
  })
  it('มีจุดเก่าเกิน 3 ชม. / ข้อมูลใช้ไม่ได้ → แสดงจำนวน', () => {
    const old = [1, 2, 3].map((i) => pt({ code: `O${i}`, measuredAt: NOW - 200 * MIN }))
    const r = floodStatusText(ready(snap(old, { invalid: 2 })))
    expect(r.text).toContain('เก่าเกิน 3 ชม. 3')
    expect(r.text).toContain('ข้อมูลใช้ไม่ได้ 2')
  })
  it('รอบล่าสุดล้ม → ⚠ อัปเดตไม่ได้', () => {
    const r = floodStatusText({ ...ready(snap([pt()])), lastFailed: true })
    expect(r.tone).toBe('warn')
    expect(r.text.startsWith('⚠ อัปเดตไม่ได้')).toBe(true)
  })
  it('ไม่ทราบเวลาต้นทาง → เตือน', () => {
    const r = floodStatusText(ready(snap([pt()], { sourceLatest: null })))
    expect(r.tone).toBe('warn')
    expect(r.text).toContain('ไม่ทราบเวลาข้อมูลต้นทาง')
  })
  it('ข้อมูลตัวอย่าง → tone sample ชนะ warn', () => {
    const r = floodStatusText({ ...ready(snap([pt()], { sample: true, sourceLatest: null })), lastFailed: true })
    expect(r.tone).toBe('sample')
    expect(r.text).toContain('ข้อมูลตัวอย่าง — ไม่ใช่สถานการณ์จริง')
  })
})
