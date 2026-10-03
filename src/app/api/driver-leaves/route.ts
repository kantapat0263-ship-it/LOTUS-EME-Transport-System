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
 */
export async function POST(req: NextRequest) {
  const uid = await verifyStaffToken(req.headers.get('authorization'))
  if (!uid) return json({ error: 'unauthorized' }, 401)

  const baseUrl = process.env.LEAVE_API_URL
  const apiKey = process.env.LEAVE_API_KEY
  if (!baseUrl || !apiKey) return json({ error: 'not_configured' }, 503)

  const body = await req.text()

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/integration/driver-leaves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    })
    if (res.status !== 200) return json({ error: 'upstream' }, 502)
    return new NextResponse(await res.text(), {
      status: 200,
      headers: { ...NO_STORE, 'content-type': 'application/json' },
    })
  } catch {
    return json({ error: 'unreachable' }, 502)
  }
}
