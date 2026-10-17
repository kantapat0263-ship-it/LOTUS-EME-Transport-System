import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb, verifyActiveUserToken } from '@/firebase/admin'
import { CustomSiteError } from '@/lib/customSite'
import { RequestIdExhaustedError } from '@/lib/requestId'
import { parseVehicleRequestCommand, VehicleRequestInputError } from '@/server/vehicleRequestValidation'
import { createVehicleRequest, VehicleRequestError } from '@/server/vehicleRequestService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

/** ส่งใบขอรถ (ฟอร์มขอรถ) — บัญชีที่ admin อนุมัติแล้วเท่านั้น · บัญชีรออนุมัติ/ไม่มีโปรไฟล์ = 401 */
export async function POST(request: NextRequest) {
  const user = await verifyActiveUserToken(request.headers.get('authorization'))
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน' }, 401)
  let command
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > 200_000) return json({ error: 'ข้อมูลใบขอรถใหญ่เกินไป' }, 400)
    command = parseVehicleRequestCommand(JSON.parse(raw))
  } catch (error) {
    // ผิดช่องไหน บอกช่องนั้น (ผู้ขอแก้ได้เอง) — JSON เสีย = ข้อความโหลดหน้าใหม่ของตัวตรวจ
    if (error instanceof VehicleRequestInputError) return json({ error: error.message }, 400)
    return json({ error: 'ข้อมูลใบขอรถไม่ถูกต้อง — กรุณาโหลดหน้าใหม่ (F5) แล้วส่งอีกครั้ง' }, 400)
  }
  try { return json(await createVehicleRequest(getAdminDb(), user, command)) }
  catch (error) {
    if (error instanceof VehicleRequestError) return json({ error: error.message }, error.status)
    if (error instanceof CustomSiteError) return json({ error: error.message }, 400)
    if (error instanceof RequestIdExhaustedError) return json({ error: 'ออกรหัสใบขอของวันนี้ไม่ได้ (รหัสเต็ม) — แจ้งผู้ดูแลระบบ' }, 409)
    console.error('vehicle-requests: create failed', error)
    return json({ error: 'ยังยืนยันผลการบันทึกไม่ได้ ข้อมูลที่กรอกไว้ยังอยู่ — กดส่งอีกครั้งได้เลย ระบบจะไม่สร้างใบซ้ำ' }, 503)
  }
}
