import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { z } from 'zod'
import { getAdminDb, verifyActiveUserToken } from '@/firebase/admin'
import { driverLinkToken, isSafeTripId } from '@/server/driverLinkToken'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

const command = z.object({
  tripIds: z.array(z.string().refine(isSafeTripId)).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  rotate: z.boolean().optional(),
}).strict().refine(c => !c.rotate || c.tripIds.length === 1)

/**
 * ออก token ลิงก์ใบงานคนขับ (คนจัดรถ/แอดมินเท่านั้น) → { links: { [tripId]: token } }
 * - ปกติ: ใช้รุ่นเดิมของทริป (ส่งซ้ำได้ลิงก์เดิม) — ยังไม่มีก็สร้างรุ่นแรก
 * - rotate: เลื่อนรุ่น = "สร้างลิงก์ใหม่ (ยกเลิกลิงก์เดิม)" ทีละทริป
 * ทริปที่ไม่มีอยู่/ยกเลิกแล้วจะไม่ได้ลิงก์ (ไม่อยู่ใน links)
 */
export async function POST(request: NextRequest) {
  const user = await verifyActiveUserToken(request.headers.get('authorization'))
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน' }, 401)
  if (user.role === 'viewer') return json({ error: 'เฉพาะคนจัดรถหรือผู้ดูแลเท่านั้นที่สร้างลิงก์ใบงานได้' }, 403)
  let input
  try { input = command.parse(await request.json()) }
  catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400) }
  const { tripIds, rotate = false } = input
  try {
    const db = getAdminDb()
    const links = await db.runTransaction(async t => {
      const tripRefs = tripIds.map(id => db.doc(`trips/${id}`))
      const linkRefs = tripIds.map(id => db.doc(`driverLinks/${id}`))
      const snaps = await t.getAll(...tripRefs, ...linkRefs)
      const out: Record<string, string> = {}
      tripIds.forEach((id, i) => {
        const trip = snaps[i]
        const link = snaps[tripIds.length + i]
        if (!trip.exists || trip.data()?.status === 'Cancelled') return
        const current = link.data()?.version
        let version = typeof current === 'number' ? current : 0
        if (rotate) {
          version += 1
          t.set(linkRefs[i], { tripId: id, version, rotatedAt: FieldValue.serverTimestamp(), rotatedBy: user.uid }, { merge: true })
        } else if (version === 0) {
          version = 1
          t.set(linkRefs[i], { tripId: id, version, createdAt: FieldValue.serverTimestamp(), createdBy: user.uid })
        }
        out[id] = driverLinkToken(id, version)
      })
      return out
    })
    return json({ links })
  } catch (error) {
    console.error('driver-links: issue failed', error)
    return json({ error: 'สร้างลิงก์ใบงานไม่สำเร็จ ลองใหม่อีกครั้ง' }, 503)
  }
}
