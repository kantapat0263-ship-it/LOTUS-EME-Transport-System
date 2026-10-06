import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb, verifyActiveUserToken } from '@/firebase/admin'
import { executeQueueCommand, readQueueSnapshot, QueueServiceError } from '@/server/continuousQueueService'
import { parseQueueCommand } from '@/server/continuousQueueValidation'
import { expandQueueDates } from '@/lib/continuousQueue'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(request: NextRequest) {
  const user = await verifyActiveUserToken(request.headers.get('authorization'))
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน' }, 401)
  const date = request.nextUrl.searchParams.get('date') ?? ''
  try { expandQueueDates(date, date) } catch { return json({ error: 'วันที่ไม่ถูกต้อง' }, 400) }
  try {
    return json(await readQueueSnapshot(getAdminDb(), date, user.role !== 'viewer'))
  } catch {
    return json({ error: 'ตรวจคิวต่อเนื่องไม่ได้ กรุณาลองใหม่อีกครั้ง' }, 503)
  }
}

export async function POST(request: NextRequest) {
  const user = await verifyActiveUserToken(request.headers.get('authorization'))
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน' }, 401)
  if (user.role === 'viewer') return json({ error: 'เฉพาะคนจัดรถหรือผู้ดูแลเท่านั้นที่ปรับคิวได้' }, 403)
  let command
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > 250_000) return json({ error: 'ข้อมูลคิวใหญ่เกินไป กรุณาแบ่งการจัดคิว' }, 400)
    command = parseQueueCommand(JSON.parse(raw))
  } catch {
    return json({ error: 'ข้อมูลคำสั่งไม่ครบหรือวันที่ไม่ถูกต้อง กรุณาตรวจแล้วส่งใหม่' }, 400)
  }
  try {
    return json(await executeQueueCommand(getAdminDb(), command, { id: user.uid, name: user.name }))
  } catch (error) {
    if (error instanceof QueueServiceError) return json({ error: error.message }, error.status)
    return json({ error: 'ยังยืนยันการบันทึกคิวไม่ได้ กรุณาโหลดคิวใหม่เพื่อตรวจผลก่อนส่งซ้ำ' }, 503)
  }
}
