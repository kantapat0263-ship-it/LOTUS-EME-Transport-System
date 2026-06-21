import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getAuth, type Auth } from 'firebase-admin/auth'

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
let cachedApp: App | null = null
let cachedDb: Firestore | null = null

/** init (หรือใช้ซ้ำ) firebase-admin app จาก service account ใน env */
function getAdminApp(): App {
  if (cachedApp) return cachedApp

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

  cachedApp = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: json.project_id,
          clientEmail: json.client_email,
          // กรณีบาง env เก็บ \n เป็น literal — แปลงกลับให้เป็น newline จริง
          privateKey: json.private_key?.replace(/\\n/g, '\n'),
        }),
      })

  return cachedApp
}

export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb
  cachedDb = getFirestore(getAdminApp())
  return cachedDb
}

/** firebase-admin Auth — ใช้ verify Firebase ID token ที่ client แนบมา (กันคนนอกยิง API) */
export function getAdminAuth(): Auth {
  return getAuth(getAdminApp())
}

/**
 * verify ID token จาก header `Authorization: Bearer <token>` แล้วคืน uid+role
 * - ไม่มี/พัง/ไม่ใช่ staff → โยน error (route จับไปตอบ 401/403)
 * - role อ่านจาก `users/{uid}` ให้ตรงกับ isStaff() ใน firestore.rules
 */
export async function requireStaff(
  authHeader: string | null
): Promise<{ uid: string; role: string }> {
  const m = authHeader?.match(/^Bearer (.+)$/)
  if (!m) {
    throw new Error('UNAUTHENTICATED')
  }

  const decoded = await getAdminAuth().verifyIdToken(m[1])
  const snap = await getAdminDb().collection('users').doc(decoded.uid).get()
  const role = snap.exists ? (snap.data()?.role as string) : undefined

  if (role !== 'admin' && role !== 'dispatcher') {
    throw new Error('FORBIDDEN')
  }

  return { uid: decoded.uid, role }
}
