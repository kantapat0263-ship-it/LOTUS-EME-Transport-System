import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/firebase/admin'
import { extractB7Price, extractB7PriceFromHtml } from '@/lib/diesel-price'

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
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
  }

  const sourceUrl =
    process.env.DIESEL_PRICE_SOURCE_URL || 'https://gas.itorbenz.com'
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)

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

  // 2) อ่านราคาเดิม (ไว้ fallback + เทียบว่าต้องอัปเดตไหม)
  const settingsRef = db.collection('companySettings').doc('default')
  let current: number | undefined
  try {
    const snap = await settingsRef.get()
    current = snap.exists ? (snap.data()?.dieselPrice as number | undefined) : undefined
  } catch (e: any) {
    console.error('[diesel-cron] read settings failed:', e?.message)
  }

  const status = fetchedPrice != null ? 'updated' : 'skipped'
  const changed = fetchedPrice != null && current !== fetchedPrice

  // 3) บันทึกประวัติทุกครั้ง (audit)
  try {
    await db.collection('dieselPriceHistory').doc(today).set(
      {
        date: today,
        price: fetchedPrice ?? current ?? null, // ราคาที่ "มีผล" หลังรอบนี้
        fetchedPrice: fetchedPrice ?? null,
        previousPrice: current ?? null,
        changed,
        status,
        note,
        source: sourceUrl,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  } catch (e: any) {
    console.error('[diesel-cron] write history failed:', e?.message)
  }

  // 4) แกะไม่ได้ → คงราคาเดิม ไม่เขียนทับ
  if (fetchedPrice == null) {
    return NextResponse.json({
      ok: false,
      status: 'skipped',
      note,
      keptPrice: current ?? null,
    })
  }

  // 5) อัปเดตเฉพาะเมื่อราคาเปลี่ยนจริง
  if (changed) {
    try {
      await settingsRef.set(
        {
          dieselPrice: fetchedPrice,
          fuelSettingsUpdatedAt: FieldValue.serverTimestamp(),
          fuelSettingsUpdatedBy: 'auto:diesel-cron',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    } catch (e: any) {
      console.error('[diesel-cron] write settings failed:', e?.message)
      return NextResponse.json({ ok: false, error: 'write-failed', detail: e?.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    status,
    price: fetchedPrice,
    previous: current ?? null,
    changed,
  })
}
