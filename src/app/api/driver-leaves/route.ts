import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffToken } from '@/firebase/admin'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }
const WORKER_TIMEOUT_MS = 5000

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * ตัวกลางไประบบใบลา: เฉพาะ staff (admin/dispatcher) → ส่งต่อ `{ codes, from, to }` ไปที่ Worker แล้วคืนผลเดิม
 * Worker เป็นคน validate body เอง (route นี้ไม่ตรวจซ้ำ) · key ของ Worker อยู่ฝั่ง server เท่านั้น ไม่ลงไปที่เบราว์เซอร์
 * ตรวจไม่ได้ (Worker ไม่ตอบ 200 / ต่อไม่ติด / เกิน 5 วิ) = 502 ให้ client ถือเป็น "ไม่รู้" ไม่ใช่ "ไม่ลา"
 * ทุกทางที่พัง log 1 บรรทัดไว้ดูใน Vercel (ไม่ log key / body ของคำขอ)
 */
export async function POST(req: NextRequest) {
  const uid = await verifyStaffToken(req.headers.get('authorization'))
  if (!uid) return json({ error: 'unauthorized' }, 401)

  // trim: ค่า env ที่วางมาติด newline ทำให้ undici throw (header ผิดรูป) ทุกคำขอ
  const baseUrl = process.env.LEAVE_API_URL?.trim()
  const apiKey = process.env.LEAVE_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    console.error('[driver-leaves] not_configured: LEAVE_API_URL / LEAVE_API_KEY not set')
    return json({ error: 'not_configured' }, 503)
  }

  // อ่าน body ใน try ของตัวเอง: stream ของคำขอพัง/ถูกตัด = 400 ผ่าน json() (มี no-store) ไม่ใช่ throw หลุดออกจาก route
  // log แค่ชื่อ error — ไม่ใส่ข้อความ/body/header/key
  let body: string
  try {
    body = await req.text()
  } catch (e) {
    console.error(`[driver-leaves] bad_request: could not read request body (${e instanceof Error ? e.name : typeof e})`)
    return json({ error: 'bad_request' }, 400)
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/integration/driver-leaves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    })
    if (res.status !== 200) {
      console.error(`[driver-leaves] upstream: worker responded HTTP ${res.status}`)
      return json({ error: 'upstream' }, 502)
    }
    return new NextResponse(await res.text(), {
      status: 200,
      headers: { ...NO_STORE, 'content-type': 'application/json' },
    })
  } catch (e) {
    // ข้อความ error ของ undici อาจยกค่า header มาทั้งก้อน (เช่น header ผิดรูป) → ปิด key ก่อน log
    const err = e instanceof Error ? e : new Error(String(e))
    const message = err.message.split(apiKey).join('[redacted]')
    console.error(`[driver-leaves] unreachable: ${err.name}: ${message}`)
    return json({ error: 'unreachable' }, 502)
  }
}
