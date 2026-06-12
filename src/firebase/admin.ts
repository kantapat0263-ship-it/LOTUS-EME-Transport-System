import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

/**
 * Firebase Admin (server-only) — ใช้เขียน Firestore จาก API route / cron
 * โดยไม่ติด security rules (`firestore.rules` บังคับ isAuthenticated()).
 *
 * ตั้ง env `FIREBASE_SERVICE_ACCOUNT_BASE64` = base64 ของไฟล์ service account JSON
 * (สร้างจาก Firebase Console → Project settings → Service accounts → Generate new private key)
 *   เช่น:  base64 -w0 service-account.json   แล้วเอาค่าไปใส่ใน Vercel env
 *
 * เก็บเป็น base64 เพื่อกัน private_key (มี \n) เพี้ยนตอนใส่ใน env ของ Vercel
 */
let cachedDb: Firestore | null = null

export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is not set')
  }

  let json: { project_id: string; client_email: string; private_key: string }
  try {
    json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is not valid base64 JSON')
  }

  const app: App = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: json.project_id,
          clientEmail: json.client_email,
          // กรณีบาง env เก็บ \n เป็น literal — แปลงกลับให้เป็น newline จริง
          privateKey: json.private_key?.replace(/\\n/g, '\n'),
        }),
      })

  cachedDb = getFirestore(app)
  return cachedDb
}
