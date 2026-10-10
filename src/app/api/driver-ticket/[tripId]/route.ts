import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/firebase/admin'
import { monthRange } from '@/lib/calculations'
import { thaiToday } from '@/lib/driverLeave'
import { DRIVER_LINK_TOKEN_PATTERN, isDriverLinkExpired, isSafeTripId, isValidDriverLinkToken } from '@/server/driverLinkToken'
import { buildDriverTicket } from '@/server/driverTicket'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
const INVALID = { error: 'ลิงก์ใบงานนี้ไม่ถูกต้องหรือถูกยกเลิกแล้ว — ขอลิงก์ใหม่จากคนจัดรถ', code: 'invalid' }
const EXPIRED = { error: 'ลิงก์ใบงานนี้หมดอายุแล้ว — ขอลิงก์ใหม่จากคนจัดรถ', code: 'expired' }

/**
 * ใบงานคนขับจากลิงก์ LINE (ไม่ต้องล็อกอิน) — ตรวจ token ของทริปนี้ที่ server แล้วคืนเฉพาะข้อมูลที่ใบงานแสดง
 * token ผิด/ของทริปอื่น/ถูกยกเลิก = 403 · ทริปถูกยกเลิก/ลบ/เกิน 7 วันหลังวันทริป = 410
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  const token = request.nextUrl.searchParams.get('t') ?? ''
  if (!isSafeTripId(tripId) || !DRIVER_LINK_TOKEN_PATTERN.test(token)) return json(INVALID, 403)
  try {
    const db = getAdminDb()
    const version = (await db.doc(`driverLinks/${tripId}`).get()).data()?.version
    if (typeof version !== 'number' || !isValidDriverLinkToken(tripId, version, token)) return json(INVALID, 403)

    const snap = await db.doc(`trips/${tripId}`).get()
    const data = snap.data()
    if (!data || data.status === 'Cancelled') return json(EXPIRED, 410)
    const tripDate = data.tripDate || data.date
    if (isDriverLinkExpired(tripDate, thaiToday())) return json(EXPIRED, 410)
    const trip = { ...data, id: snap.id }

    // เบอร์คนขับ — คนขับจริง (ขับแทน) ถ้ามี ไม่งั้นคนขับประจำ
    const phoneDriverId = data.actualDriverId || data.driverId
    const driverPhone = typeof phoneDriverId === 'string' && isSafeTripId(phoneDriverId)
      ? String((await db.doc(`drivers/${phoneDriverId}`).get()).data()?.phoneNumber ?? '')
      : ''

    let monthTrips: (Record<string, unknown> & { id: string })[] = []
    if (typeof data.tripDate === 'string' && data.driverId) {
      try {
        const { start, end } = monthRange(data.tripDate)
        const month = await db.collection('trips').where('tripDate', '>=', start).where('tripDate', '<=', end).get()
        monthTrips = month.docs.map(d => ({ ...d.data(), id: d.id }))
      } catch (error) {
        console.error('driver-ticket: stats unavailable', error) // สถิติเป็นของแถม — ใบงานต้องเปิดได้
      }
    }
    return json(buildDriverTicket(trip, monthTrips, driverPhone))
  } catch (error) {
    console.error('driver-ticket: load failed', error)
    return json({ error: 'เกิดข้อผิดพลาดในการโหลดข้อมูล', code: 'error' }, 503)
  }
}
