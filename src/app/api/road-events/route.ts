import { NextRequest, NextResponse } from 'next/server'
import { normalizeRoads, POPNIX_ROADS_URL } from '@/lib/roadFlood'
import { buildSampleRoadsPayload } from '@/lib/roadFloodSample'

export const dynamic = 'force-dynamic'

const UPSTREAM_TIMEOUT_MS = 8000
const NO_STORE = { 'Cache-Control': 'no-store' }
// CDN ของ Vercel เก็บ 5 นาที (คืนชุดเก่าระหว่าง revalidate ได้อีก 10 นาที) · browser ต้อง revalidate ทุกครั้ง
const CDN_CACHE = {
  'Vercel-CDN-Cache-Control': 'max-age=300, stale-while-revalidate=600',
  'Cache-Control': 'public, max-age=0, must-revalidate',
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE })
}

/**
 * จุดวัดน้ำบนถนน กทม. (POPNIX) ที่จัดรูป/ตรวจแล้ว — ข้อมูลสาธารณะ ไม่ต้องล็อกอิน (cache ร่วมต้องไม่แยกตามผู้ใช้)
 * ต้นทางล้ม/ข้อมูลใช้ไม่ได้ = 502 no-store (ไม่ cache ความล้มเหลว) ให้ client ถือเป็น "อัปเดตไม่ได้" ไม่ใช่ "ไม่มีน้ำท่วม"
 * query: ไม่มีเลย = ปกติ · `sample=1` = ข้อมูลตัวอย่าง (dev เท่านั้น) · อย่างอื่น = 400 ก่อนเรียกต้นทาง (กันสร้าง cache key ใหม่เลี่ยง CDN)
 */
export async function GET(req: NextRequest) {
  const params = [...req.nextUrl.searchParams.entries()]
  if (params.length > 0) {
    const isSample = params.length === 1 && params[0][0] === 'sample' && params[0][1] === '1'
    if (!isSample || process.env.NODE_ENV === 'production') return fail(400, 'bad_request')
    const now = Date.now()
    const snapshot = { ...normalizeRoads(buildSampleRoadsPayload(now), now), sample: true as const }
    return NextResponse.json({ ok: true, snapshot }, { headers: NO_STORE })
  }

  let raw: unknown
  try {
    const res = await fetch(POPNIX_ROADS_URL, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      console.error(`[road-events] upstream_failed: http ${res.status}`)
      return fail(502, 'upstream')
    }
    raw = await res.json()
  } catch (e) {
    console.error(`[road-events] upstream_failed: ${e instanceof Error ? e.name : typeof e}`)
    return fail(502, 'upstream')
  }

  try {
    const snapshot = normalizeRoads(raw, Date.now())
    return NextResponse.json({ ok: true, snapshot }, { headers: CDN_CACHE })
  } catch (e) {
    console.error(`[road-events] upstream_failed: ${e instanceof Error ? e.message : 'bad data'}`)
    return fail(502, 'upstream')
  }
}
