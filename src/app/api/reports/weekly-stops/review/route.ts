import { NextResponse, type NextRequest } from 'next/server'
import { getAdminDb, verifyActiveUserToken } from '@/firebase/admin'
import { parseStopReviewCommand } from '@/server/weeklyStopValidation'
import { saveStopReview, WeeklyStopError } from '@/server/weeklyStopService'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
export async function POST(request: NextRequest) {
  const user = await verifyActiveUserToken(request.headers.get('authorization'))
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน' }, 401)
  if (user.role !== 'admin') return json({ error: 'เฉพาะผู้ดูแลเท่านั้นที่บันทึกเหตุผลได้' }, 403)
  let command
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > 5000) return json({ error: 'ข้อมูลใหญ่เกินไป' }, 400)
    command = parseStopReviewCommand(JSON.parse(raw))
  } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสัปดาห์และกรอกเหตุผลไม่เกิน 500 ตัวอักษร' }, 400) }
  try { return json(await saveStopReview(getAdminDb(), command, user.uid)) }
  catch (error) {
    return error instanceof WeeklyStopError ? json({ error: error.message }, error.status) : json({ error: 'ยังยืนยันผลไม่ได้ กรุณาลองรายการเดิมอีกครั้งหรือโหลดรายงานเพื่อตรวจผล' }, 503)
  }
}
