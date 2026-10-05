import { describe, it, expect } from 'vitest'
import { formatThaiTimestamp, buildSampleRoadsPayload } from './roadFloodSample'
import { normalizeRoads, parseThaiTime, summarizeFlood } from './roadFlood'

const NOW = Date.parse('2026-10-05T14:20:00+07:00')

describe('formatThaiTimestamp', () => {
  it('ผกผันกับ parseThaiTime (ระดับวินาที)', () => {
    const t = Date.parse('2026-12-31T23:59:58+07:00')
    expect(formatThaiTimestamp(t)).toBe('2026-12-31 23:59:58')
    expect(parseThaiTime(formatThaiTimestamp(t))).toBe(t)
  })
})

describe('buildSampleRoadsPayload', () => {
  const snap = normalizeRoads(buildSampleRoadsPayload(NOW), NOW)

  it('ผ่าน normalizeRoads: มีน้ำ 4 จุด ขัดข้อง 1', () => {
    expect(snap.points).toHaveLength(4)
    expect(snap.offline).toBe(1)
    expect(snap.invalid).toBe(0)
  })
  it('ทุกชื่อขึ้นต้น "[ตัวอย่าง]"', () => {
    for (const r of buildSampleRoadsPayload(NOW).roads as { name: string }[]) expect(r.name.startsWith('[ตัวอย่าง]')).toBe(true)
  })
  it('เวลาอิง now — มีจุดข้อมูลเก่า (aging) 1 จุด และไม่มีจุดเก่าเกิน 3 ชม.', () => {
    const s = summarizeFlood(snap, NOW)
    expect(s.visible.filter((p) => p.aging)).toHaveLength(1)
    expect(s.tooOld).toBe(0)
    expect(s.sourceOld).toBe(false)
  })
})
