/**
 * ชั้น "น้ำท่วมถนน กทม." บนแผนที่หน้าติดตามรถ — ตรรกะล้วน (ไม่มี I/O, ไม่มี DOM) ใช้ได้ทั้ง server และ client
 * ต้นทาง: จุดวัดน้ำบนถนนของสำนักการระบายน้ำ กทม. ผ่าน POPNIX Flood (spec: docs/superpowers/specs/2026-10-05-road-flood-layer-design.md)
 *
 * หลักสูงสุด: ข้อมูลเสีย/เก่า/ไม่มีค่า ห้ามแสดงเหมือน "ไม่มีน้ำท่วม" · null ห้ามกลายเป็น 0
 */

export const FLOOD_FRESH_MAX_MIN = 45 // POPNIX ถือว่าเกิน 45 นาที = เก่า
export const FLOOD_SHOW_MAX_MIN = 180 // เกิน 3 ชม. ไม่ปักหมุด
export const FUTURE_TOLERANCE_MIN = 5 // เวลาวัดล้ำหน้าได้ไม่เกินนี้ (นาฬิกาเพี้ยนเล็กน้อย)

export const POPNIX_URL = 'https://flood.pop.in.th'
export const POPNIX_ROADS_URL = `${POPNIX_URL}/api_roads.php`
export const CREDIT_TEXT = 'ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)'
export const NOT_OFFICIAL_TEXT = 'ไม่ใช่ประกาศเตือนภัยทางการ'

const MIN_MS = 60_000
const TEXT_MAX = 120
// กรอบประเทศไทยคร่าว ๆ — กันพิกัด 0,0 และสลับแกน lat/lng
const TH_BOUNDS = { latMin: 5.5, latMax: 20.5, lngMin: 97.3, lngMax: 105.7 }

export interface FloodPoint {
  code: string
  name: string // ต้นทางว่าง → "จุดวัด {code}"
  road: string | null
  district: string | null
  dir: string | null
  isTunnel: boolean
  lat: number
  lng: number
  level: 'flood' | 'slight'
  depthCm: number | null // null = ต้นทางไม่ส่งค่า (ห้ามเป็น 0)
  depthAtLeast: boolean // grp 2 วัดได้สูงสุด 20 → ค่า 20 = "อย่างน้อย 20 ซม."
  measuredAt: number
  floodingSince: number | null
}

export interface RoadFloodSnapshot {
  fetchedAt: number // เวลาที่ server เราดึง
  sourceLatest: number | null // เวลาวัดล่าสุดของต้นทาง (ไม่ทราบ = null)
  sourceStale: boolean // ต้นทางบอกเองว่าเก่า/ดึงไม่สำเร็จ ณ ตอนดึง
  points: FloodPoint[] // จุดที่มีน้ำ (ยังไม่ตัดตามอายุ)
  usable: number // จุดวัดที่ข้อมูลรูปถูก (wet/dry/off หลังตัดซ้ำ)
  offline: number
  assessable: number // usable - offline
  invalid: number
  sample?: true
}

export class RoadFloodDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoadFloodDataError'
  }
}

const THAI_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

/**
 * "YYYY-MM-DD HH:MM:SS" เวลาไทย (ไม่มีเขตเวลา) → epoch ms
 * ตรวจปฏิทินจริงเอง เพราะ Date.parse ยอมรับ 02-30 (เลื่อนเป็น 2 มี.ค.) และ 24:00 (เลื่อนวัน)
 */
export function parseThaiTime(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = THAI_TIME_RE.exec(s)
  if (!m) return null
  const [y, mo, d, h, mi, sec] = m.slice(1).map(Number)
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || sec > 59) return null
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (d > daysInMonth) return null
  return Date.UTC(y, mo - 1, d, h, mi, sec) - 7 * 3600_000
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, TEXT_MAX) : null
}

function inThailand(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= TH_BOUNDS.latMin && lat <= TH_BOUNDS.latMax &&
    lng >= TH_BOUNDS.lngMin && lng <= TH_BOUNDS.lngMax
  )
}

type RawRoad = Record<string, unknown>
const LEVELS = new Set(['flood', 'slight', 'dry', 'off'])

/**
 * JSON ของ POPNIX api_roads.php → snapshot ที่ตรวจแล้ว (spec ข้อ 5 ขั้น 1–5)
 * throw RoadFloodDataError เมื่อไม่มีค่าที่ใช้ได้เลย = ล้ม ไม่ใช่ "ไม่มีน้ำท่วม"
 */
export function normalizeRoads(raw: unknown, fetchedAt: number): RoadFloodSnapshot {
  const roads = (raw as { roads?: unknown } | null)?.roads
  if (!Array.isArray(roads) || roads.length === 0) throw new RoadFloodDataError('roads missing or empty')

  const futureLimit = fetchedAt + FUTURE_TOLERANCE_MIN * MIN_MS
  let invalid = 0

  // ขั้น 1: ด่าน code + เวลา (ทุกสถานะ) · ขั้น 2: ตัดซ้ำ — ใหม่สุดต่อ code, เวลาเท่ากันตัวแรกชนะ
  const latest = new Map<string, { rec: RawRoad; at: number }>()
  for (const item of roads) {
    const rec = (item && typeof item === 'object' ? item : {}) as RawRoad
    const code = typeof rec.code === 'string' ? rec.code.trim() : ''
    const at = parseThaiTime(rec.measured_at)
    if (!code || at == null || at > futureLimit) {
      invalid++
      continue
    }
    const prev = latest.get(code)
    if (!prev || at > prev.at) latest.set(code, { rec, at })
  }

  // ขั้น 3: ตรวจตัวที่เลือก (เสีย = invalid ทั้ง code ไม่ย้อนใช้ตัวเก่า) · ขั้น 4: นับ
  const points: FloodPoint[] = []
  let usable = 0
  let offline = 0
  for (const [code, { rec, at }] of latest) {
    const level = rec.level
    if (typeof level !== 'string' || !LEVELS.has(level)) {
      invalid++
      continue
    }
    if (level === 'flood' || level === 'slight') {
      if (!inThailand(rec.lat, rec.lng)) {
        invalid++
        continue
      }
      const depth = typeof rec.depth === 'number' && Number.isFinite(rec.depth) ? rec.depth : null
      points.push({
        code,
        name: cleanText(rec.name) ?? `จุดวัด ${code}`,
        road: cleanText(rec.road),
        district: cleanText(rec.district),
        dir: cleanText(rec.dir),
        isTunnel: rec.kind === 2,
        lat: rec.lat as number,
        lng: rec.lng as number,
        level,
        depthCm: depth,
        depthAtLeast: rec.grp === 2 && depth != null && depth >= 20,
        measuredAt: at,
        floodingSince: parseThaiTime(rec.since),
      })
    } else if (level === 'off') {
      offline++
    }
    usable++
  }
  if (usable === 0) throw new RoadFloodDataError('no usable records')

  // ขั้น 5: เวลาของทั้งชุด — อนาคตเกินเกณฑ์ = ไม่ทราบเวลา
  const summary = ((raw as { summary?: unknown }).summary ?? {}) as Record<string, unknown>
  const latestAt = parseThaiTime(summary.latest)
  return {
    fetchedAt,
    sourceLatest: latestAt != null && latestAt <= futureLimit ? latestAt : null,
    sourceStale: summary.stale === true || summary.scrape_failing === true,
    points,
    usable,
    offline,
    assessable: usable - offline,
    invalid,
  }
}

// ---------- สรุปผล ณ เวลาแสดงผล ----------

export type VisibleFloodPoint = FloodPoint & { aging: boolean }

export interface FloodSummary {
  visible: VisibleFloodPoint[]
  flood: number
  slight: number
  offline: number
  tooOld: number
  invalid: number
  usable: number
  assessable: number
  sourceAgeMin: number | null
  sourceOld: boolean
}

/** คิดอายุทุกครั้งที่แสดงผล (ไม่ใช่ตอนดึง) — ชุดที่ค้างอยู่ฝั่งผู้ใช้จะเก่าลงเองตามเวลา */
export function summarizeFlood(s: RoadFloodSnapshot, now: number): FloodSummary {
  const visible: VisibleFloodPoint[] = []
  let tooOld = 0
  for (const p of s.points) {
    const age = Math.max(0, now - p.measuredAt)
    if (age > FLOOD_SHOW_MAX_MIN * MIN_MS) {
      tooOld++
      continue
    }
    visible.push({ ...p, aging: age > FLOOD_FRESH_MAX_MIN * MIN_MS })
  }
  const sourceAgeMin = s.sourceLatest == null ? null : Math.max(0, now - s.sourceLatest) / MIN_MS
  return {
    visible,
    flood: visible.filter((p) => p.level === 'flood').length,
    slight: visible.filter((p) => p.level === 'slight').length,
    offline: s.offline,
    tooOld,
    invalid: s.invalid,
    usable: s.usable,
    assessable: s.assessable,
    sourceAgeMin,
    sourceOld: s.sourceStale || sourceAgeMin == null || sourceAgeMin > FLOOD_FRESH_MAX_MIN,
  }
}

export function depthLabel(p: Pick<FloodPoint, 'depthCm' | 'depthAtLeast'>): string {
  if (p.depthCm == null) return '?'
  return p.depthAtLeast ? `≥${p.depthCm}` : String(p.depthCm)
}

export function ageLabel(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / MIN_MS)
  if (totalMin < 1) return 'เพิ่งวัด'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} นาทีที่แล้ว`
  return m === 0 ? `${h} ชม.ที่แล้ว` : `${h} ชม. ${m} นาทีที่แล้ว`
}

const CLOCK_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false })

/** "14:05" ตามเวลาไทยเสมอ ไม่ขึ้นกับ timezone ของเครื่อง */
export function formatThaiClock(ms: number): string {
  return CLOCK_FMT.format(ms)
}

/** key ของชุดหมุด — เปลี่ยนเมื่อจุด/สี/ป้ายเปลี่ยนเท่านั้น (ไม่เปลี่ยนทุก tick ของเวลา) */
export function markerKey(visible: VisibleFloodPoint[]): string {
  return [...visible]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((p) => `${p.code}|${p.lat}|${p.lng}|${p.level}|${depthLabel(p)}|${p.aging ? 1 : 0}`)
    .join(';')
}

// ---------- ตรวจรูปคำตอบของ /api/road-events (ฝั่ง client) ----------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function isFloodPoint(v: unknown): v is FloodPoint {
  const p = v as FloodPoint
  return (
    !!p && typeof p === 'object' &&
    typeof p.code === 'string' && typeof p.name === 'string' &&
    isNum(p.lat) && isNum(p.lng) && isNum(p.measuredAt) &&
    (p.level === 'flood' || p.level === 'slight') &&
    (p.depthCm === null || isNum(p.depthCm)) && typeof p.depthAtLeast === 'boolean'
  )
}

export function parseRoadEventsResponse(json: unknown): RoadFloodSnapshot | null {
  const body = json as { ok?: unknown; snapshot?: RoadFloodSnapshot } | null
  if (!body || typeof body !== 'object' || body.ok !== true) return null
  const s = body.snapshot
  if (!s || typeof s !== 'object') return null
  if (!isNum(s.fetchedAt) || !(s.sourceLatest === null || isNum(s.sourceLatest)) || typeof s.sourceStale !== 'boolean') return null
  if (![s.usable, s.offline, s.assessable, s.invalid].every(isNum)) return null
  if (!Array.isArray(s.points) || !s.points.every(isFloodPoint)) return null
  return s
}

// ---------- ข้อความแถบสถานะ ----------

export type FloodPhase = 'idle' | 'loading' | 'ready' | 'error'

export const FLOOD_FOOTNOTE = 'ไม่มีหมุด ≠ ถนนปลอดภัย · มีเฉพาะจุดที่ กทม. ติดตั้งเครื่องวัด · ไม่ใช่ประกาศเตือนภัยทางการ'

/**
 * บรรทัดแรกของแถบสถานะ — ตัดสินตาม phase ก่อนเสมอ เพื่อไม่ให้ "โหลดไม่ได้/ประเมินไม่ได้" ไปแสดงเป็น "ท่วม 0"
 * ลำดับ: [ตัวอย่าง] [⚠ อัปเดตไม่ได้] [⚠ ต้นทางเก่า/ไม่ทราบเวลา] ข้อความหลัก
 */
export function floodStatusText(i: {
  phase: FloodPhase
  lastFailed: boolean
  snapshot: RoadFloodSnapshot | null
  summary: FloodSummary | null
  now: number
}): { tone: 'info' | 'warn' | 'sample'; text: string } {
  const { snapshot: s, summary: sum, now } = i
  if (i.phase === 'error' && !s) return { tone: 'warn', text: '🌊 โหลดข้อมูลน้ำท่วมไม่ได้ — ยังไม่มีข้อมูลให้แสดง' }
  if (!s || !sum) return { tone: 'info', text: '🌊 กำลังโหลดข้อมูลน้ำท่วมถนน…' }

  const parts: string[] = []
  let warn = false
  if (s.sample) parts.push('ข้อมูลตัวอย่าง — ไม่ใช่สถานการณ์จริง')
  if (i.lastFailed) {
    warn = true
    parts.push(`⚠ อัปเดตไม่ได้ — แสดงข้อมูลที่ดึงเมื่อ ${formatThaiClock(s.fetchedAt)} (${ageLabel(now - s.fetchedAt)})`)
  }
  if (s.sourceLatest == null) {
    warn = true
    parts.push('⚠ ไม่ทราบเวลาข้อมูลต้นทาง')
  } else if (sum.sourceOld) {
    warn = true
    parts.push(`⚠ ข้อมูลต้นทางเก่า วัดล่าสุด ${formatThaiClock(s.sourceLatest)} (${ageLabel(now - s.sourceLatest)})`)
  }

  const fetched = `ดึงเมื่อ ${formatThaiClock(s.fetchedAt)}`
  if (sum.assessable === 0) {
    warn = true
    parts.push(`🌊 ยังประเมินสถานการณ์ไม่ได้ — จุดวัดขัดข้องทั้งหมด (${sum.offline} จุด) · ${fetched}`)
  } else {
    const seg = [`ท่วม ${sum.flood}`, `เล็กน้อย ${sum.slight}`, `ขัดข้อง ${sum.offline}`]
    if (sum.tooOld > 0) seg.push(`เก่าเกิน 3 ชม. ${sum.tooOld}`)
    if (sum.invalid > 0) seg.push(`ข้อมูลใช้ไม่ได้ ${sum.invalid}`)
    seg.push(`จุดวัดที่ประเมินได้ ${sum.assessable}`)
    if (s.sourceLatest != null) seg.push(`ข้อมูล ${formatThaiClock(s.sourceLatest)} (${ageLabel(now - s.sourceLatest)})`)
    seg.push(fetched)
    parts.push(`🌊 น้ำท่วมถนน กทม.: ${seg.join(' · ')}`)
  }
  return { tone: s.sample ? 'sample' : warn ? 'warn' : 'info', text: parts.join(' · ') }
}
