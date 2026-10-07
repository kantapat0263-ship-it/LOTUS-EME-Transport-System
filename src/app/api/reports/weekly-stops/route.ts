import { NextResponse, type NextRequest } from 'next/server'
import { getAdminDb, verifyActiveUserToken } from '@/firebase/admin'
import { parseWeekStart } from '@/server/weeklyStopValidation'
import { readWeeklyStopReport, WeeklyStopError } from '@/server/weeklyStopService'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
const failure = (error: unknown) => error instanceof WeeklyStopError ? json({ error: error.message }, error.status) : json({ error: 'ยังยืนยันผลไม่ได้ กรุณาลองรายการเดิมอีกครั้งหรือโหลดรายงานเพื่อตรวจผล' }, 503)
export async function GET(_request: NextRequest) { return json({ error: 'ใช้ POST เพื่อดูรายงานส่วนตัว' }, 405) }
export async function POST(request: NextRequest) {
  const user = await verifyActiveUserToken(request.headers.get('authorization'))
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน' }, 401)
  if (user.role !== 'admin') return json({ error: 'เฉพาะผู้ดูแลเท่านั้นที่ดูรายงานส่วนตัวได้' }, 403)
  let weekStart: string
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > 1000) throw new Error('body too large')
    const body = JSON.parse(raw)
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || !('weekStart' in body)) throw new Error('week')
    weekStart = parseWeekStart(body.weekStart)
  } catch { return json({ error: 'เลือกวันจันทร์ของสัปดาห์ที่ต้องการดู' }, 400) }
  try { return json(await readWeeklyStopReport(getAdminDb(), weekStart, user.uid)) }
  catch (error) { return failure(error) }
}
