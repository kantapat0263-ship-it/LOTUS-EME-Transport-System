import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb, verifyActiveUserToken } from '@/firebase/admin'
import { parseCoordinateSyncCommand } from '@/server/tripCoordinateSyncValidation'
import { CoordinateSyncError, syncTripCoordinates } from '@/server/tripCoordinateSyncService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function POST(request: NextRequest) {
  const user = await verifyActiveUserToken(request.headers.get('authorization'))
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน' }, 401)
  if (user.role === 'viewer') return json({ error: 'เฉพาะคนจัดรถหรือผู้ดูแลเท่านั้นที่ซิงก์พิกัดได้' }, 403)
  let command
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > 250_000) return json({ error: 'ข้อมูลใหญ่เกินไป กรุณาแบ่งเลือกจุด' }, 400)
    command = parseCoordinateSyncCommand(JSON.parse(raw))
  } catch { return json({ error: 'ข้อมูลจุดหรือพิกัดไม่ถูกต้อง กรุณาโหลดรายการใหม่' }, 400) }
  try { return json(await syncTripCoordinates(getAdminDb(), command, user.uid)) }
  catch (error) {
    if (error instanceof CoordinateSyncError) return json({ error: error.message }, error.status)
    return json({ error: 'ยังยืนยันผลบันทึกไม่ได้ ลองส่งรายการเดิมอีกครั้งหรือโหลดใบคิวเพื่อตรวจผล' }, 503)
  }
}
