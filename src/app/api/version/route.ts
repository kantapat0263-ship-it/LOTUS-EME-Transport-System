import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * รหัสเวอร์ชันของ build ที่กำลังให้บริการอยู่
 * หน้าเว็บที่เปิดค้างไว้จะถามเป็นระยะ แล้วเทียบกับรหัสที่ฝังมาตอนโหลดหน้า
 * ไม่ตรง = มีการ deploy ใหม่ → ขึ้นแถบชวนให้รีเฟรช
 *
 * ห้ามให้ถูก cache เด็ดขาด (แอปนี้เป็น PWA มี service worker) ไม่งั้นจะได้รหัสเก่าตลอด
 */
export async function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID || '' },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}
