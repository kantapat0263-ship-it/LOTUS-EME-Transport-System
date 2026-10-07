import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/firebase/admin'
import { extractB7Price, extractB7PriceFromHtml } from '@/lib/diesel-price'
import { todayBangkok } from '@/lib/vehicle-compliance'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Cron รายวัน: ดึงราคาดีเซล B7 → อัปเดต companySettings/default.dieselPrice
 *
 * ทำงานบน Vercel Cron (ตั้งใน vercel.json) — Vercel จะแนบ header
 *   Authorization: Bearer <CRON_SECRET>  เมื่อมี env CRON_SECRET
 *
 * defensive ทุกชั้น:
 *  - ดึง/แกะราคาพลาด → "ไม่เขียนทับ" ราคาเดิม (กันค่าเพี้ยนไปทั้งระบบ)
 *  - บันทึก dieselPriceHistory/{date} ทุกครั้ง (สำเร็จ/พลาด) ไว้ตรวจย้อนหลัง
 *  - เขียน dieselPrice เฉพาะตอนราคาเปลี่ยนจริง (กัน write ฟุ่มเฟือย)
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'not-configured' }, { status: 503 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const sourceUrl =
    process.env.DIESEL_PRICE_SOURCE_URL || 'https://gas.itorbenz.com'
  const today = todayBangkok()

  let db
  try {
    db = getAdminDb()
  } catch (e: any) {
    console.error('[diesel-cron] admin init failed:', e?.message)
    return NextResponse.json({ ok: false, error: 'admin-init', detail: e?.message }, { status: 500 })
  }

  // 1) ดึง + แกะราคา (พลาดได้ ไม่ throw)
  let fetchedPrice: number | null = null
  let note = ''
  try {
    const res = await fetch(sourceUrl, {
      headers: { accept: 'text/html,application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`source HTTP ${res.status}`)
    const raw = await res.text()
    // แหล่งบางที่เป็น JSON API, บางที่เป็นหน้าเว็บ HTML (เช่น kapook)
    // → ลอง parse JSON ก่อน ถ้าไม่ใช่ JSON ค่อยแกะจาก HTML
    let data: unknown = null
    try {
      data = JSON.parse(raw)
    } catch {
      /* ไม่ใช่ JSON → ถือเป็น HTML */
    }
    fetchedPrice = data != null ? extractB7Price(data) : extractB7PriceFromHtml(raw)
    if (fetchedPrice == null) note = 'parse-miss'
  } catch (e: any) {
    note = `fetch-error: ${e?.message ?? 'unknown'}`
    console.error('[diesel-cron]', note)
  }

  // ราคาและประวัติต้องยืนยันสำเร็จพร้อมกัน และเทียบกับ settings ล่าสุดใน transaction
  const settingsRef = db.collection('companySettings').doc('default')
  const historyRef = db.collection('dieselPriceHistory').doc(today)
  const status = fetchedPrice != null ? 'updated' : 'skipped'
  let result: { current: number | null; changed: boolean }
  try {
    result = await db.runTransaction(async tx => {
      const snap = await tx.get(settingsRef)
      const value: unknown = snap.exists ? snap.data()?.dieselPrice : undefined
      const current = typeof value === 'number' && Number.isFinite(value) ? value : null
      const changed = fetchedPrice != null && current !== fetchedPrice

      if (changed) {
        tx.set(settingsRef, {
          dieselPrice: fetchedPrice,
          fuelSettingsUpdatedAt: FieldValue.serverTimestamp(),
          fuelSettingsUpdatedBy: 'auto:diesel-cron',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      tx.set(historyRef, {
        date: today,
        price: fetchedPrice ?? current,
        fetchedPrice,
        previousPrice: current,
        changed,
        status,
        note,
        source: sourceUrl,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return { current, changed }
    })
  } catch (e: any) {
    console.error('[diesel-cron] price/history transaction failed:', e?.message)
    return NextResponse.json({ ok: false, error: 'write-failed', detail: e?.message }, { status: 500 })
  }

  // แกะไม่ได้ → บันทึก skipped โดยคงราคาเดิม
  if (fetchedPrice == null) {
    return NextResponse.json({
      ok: false,
      status: 'skipped',
      note,
      keptPrice: result.current,
    })
  }

  return NextResponse.json({
    ok: true,
    status,
    price: fetchedPrice,
    previous: result.current,
    changed: result.changed,
  })
}
