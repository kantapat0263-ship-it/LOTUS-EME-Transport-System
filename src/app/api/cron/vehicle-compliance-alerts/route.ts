import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/firebase/admin'
import type { Vehicle, VehicleCompliance } from '@/types/models'
import { alertKey, alertStage, buildAlertMessages, collectDueAlerts, complianceStatus, splitForLine, todayBangkok, type DueAlert } from '@/lib/vehicle-compliance'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * แจ้งเตือน พ.ร.บ. / ภาษีรถ เข้า LINE (รันวันละครั้ง)
 *
 * ปลอดภัยไว้ก่อน:
 *  - ต้องมี CRON_SECRET เสมอ (route นี้ส่งข้อความได้ ห้ามเปิด public)
 *  - โหมดทดลอง (dry-run) เป็นค่าเริ่มต้น: คืนข้อความที่ "จะส่ง" แต่ไม่ส่ง ไม่เขียนอะไร
 *    ส่งจริงเฉพาะเมื่อตั้ง COMPLIANCE_LINE_ENABLED=true + COMPLIANCE_LINE_TO (+ LINE_CHANNEL_ACCESS_TOKEN)
 *  - กันส่งซ้ำ: จอง complianceAlertLog/{คัน_ประเภท_วันหมดอายุ_รอบ} ใน transaction ก่อนส่ง
 *    ส่งพลาด → ลบที่จองไว้ ให้รอบหน้าลองใหม่
 *  - ก่อนจอง อ่านสถานะล่าสุดของคันนั้นอีกครั้ง → ต่ออายุไปแล้ว/แก้วัน = ไม่ส่ง
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  const to = process.env.COMPLIANCE_LINE_TO
  const live =
    process.env.COMPLIANCE_LINE_ENABLED === 'true' && !!to && !!token && req.nextUrl.searchParams.get('dryRun') !== '1'

  let db
  try {
    db = getAdminDb()
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'admin-init', detail: e?.message }, { status: 500 })
  }

  const today = todayBangkok()
  const [vehSnap, compSnap] = await Promise.all([db.collection('vehicles').get(), db.collection('vehicleCompliance').get()])
  const vehicles = vehSnap.docs.map((d) => ({ id: d.id, licensePlate: (d.data() as Vehicle).licensePlate }))
  const complianceById: Record<string, VehicleCompliance> = {}
  compSnap.docs.forEach((d) => (complianceById[d.id] = { ...(d.data() as VehicleCompliance), id: d.id }))

  const due = collectDueAlerts(vehicles, complianceById, today)
  const logCol = db.collection('complianceAlertLog')
  const logSnaps = due.length ? await db.getAll(...due.map((a) => logCol.doc(a.key))) : []
  const pending = due.filter((_, i) => !logSnaps[i].exists)

  if (!live) {
    return NextResponse.json({
      ok: true,
      mode: 'dry-run',
      today,
      due: due.length,
      alreadySent: due.length - pending.length,
      wouldSend: pending.map((a) => a.key),
      messages: buildAlertMessages(pending, today).flatMap((m) => splitForLine(m)),
    })
  }

  // จองทีละรายการ + ตรวจข้อมูลล่าสุดอีกรอบ
  const claimed: DueAlert[] = []
  for (const a of pending) {
    const ok = await db.runTransaction(async (tx) => {
      const logRef = logCol.doc(a.key)
      const [logDoc, compDoc] = await Promise.all([tx.get(logRef), tx.get(db.collection('vehicleCompliance').doc(a.vehicleId))])
      if (logDoc.exists) return false
      const st = complianceStatus((compDoc.data() as VehicleCompliance | undefined)?.[a.kind], today)
      if (st.state === 'no-data' || st.state === 'unconfirmed') return false
      const stage = alertStage(st.daysLeft as number)
      if (!stage || alertKey(a.vehicleId, a.kind, st.expiry as string, stage) !== a.key) return false
      tx.create(logRef, { ...a, status: 'sending', claimedAt: new Date().toISOString() })
      return true
    })
    if (ok) claimed.push(a)
  }
  if (claimed.length === 0) return NextResponse.json({ ok: true, mode: 'live', today, sent: 0 })

  const messages = buildAlertMessages(claimed, today).flatMap((m) => splitForLine(m))
  const apiUrl = process.env.COMPLIANCE_LINE_API_URL || 'https://api.line.me/v2/bot/message/push' // override ได้เฉพาะทดสอบในเครื่อง
  try {
    // 1 push ใส่ได้ ≤5 ข้อความ — โควตานับตามจำนวนผู้รับต่อ push
    for (let i = 0; i < messages.length; i += 5) {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, messages: messages.slice(i, i + 5).map((text) => ({ type: 'text', text })) }),
      })
      if (!res.ok) throw new Error(`LINE ${res.status}: ${await res.text()}`)
    }
  } catch (e: any) {
    console.error('[compliance-alerts] send failed:', e?.message)
    const batch = db.batch()
    claimed.forEach((a) => batch.delete(logCol.doc(a.key)))
    await batch.commit()
    return NextResponse.json({ ok: false, error: 'line-send-failed', detail: e?.message }, { status: 502 })
  }

  const sentAt = new Date().toISOString()
  const batch = db.batch()
  claimed.forEach((a) => batch.update(logCol.doc(a.key), { status: 'sent', sentAt }))
  await batch.commit()
  return NextResponse.json({ ok: true, mode: 'live', today, sent: claimed.length, pushes: Math.ceil(messages.length / 5) })
}
