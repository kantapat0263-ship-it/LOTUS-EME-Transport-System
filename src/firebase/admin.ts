import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { firebaseConfig } from './config'

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

/**
 * URL ของ identitytoolkit `accounts:lookup` — ตั้ง `emulatorHost` (เช่น "127.0.0.1:9099" จาก
 * env FIREBASE_AUTH_EMULATOR_HOST) แล้วจะชี้ไป Firebase Auth emulator แทน production
 * ใช้ทดสอบในเครื่องโดยไม่แตะ Auth จริง · ไม่ตั้ง = URL production เหมือนเดิม (**ห้ามตั้งบน Vercel**)
 */
export function identityToolkitLookupUrl(apiKey: string, emulatorHost?: string): string {
  const path = `identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`
  return emulatorHost ? `http://${emulatorHost}/${path}` : `https://${path}`
}

/**
 * ตรวจว่า request มาจาก staff (admin/dispatcher) ที่ login จริงและบัญชียัง active
 * รับ header `Authorization: Bearer <Firebase ID token>` → verify → เช็ค role ใน users/{uid}
 * คืน uid ถ้าเป็น staff, คืน null ถ้าไม่ผ่าน (ให้ route ตอบ 401/403 เอง)
 *
 * ใช้ Firebase REST (identitytoolkit accounts:lookup) แทน firebase-admin/auth
 * เพราะ firebase-admin/auth ดึง `jose` (ESM) ที่ require() ไม่ได้บน Vercel Node → 500
 */
export interface ActiveTokenUser { uid: string; name: string; role: 'admin' | 'dispatcher' | 'viewer' }

export async function verifyActiveUserToken(authHeader: string | null): Promise<ActiveTokenUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const idToken = authHeader.slice(7)
  try {
    const res = await fetch(
      identityToolkitLookupUrl(firebaseConfig.apiKey, process.env.FIREBASE_AUTH_EMULATOR_HOST),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    const uid: string | undefined = data?.users?.[0]?.localId
    if (!uid) return null
    const snap = await getAdminDb().collection('users').doc(uid).get()
    const profile = snap.exists ? snap.data() : undefined
    const role = profile?.role as string | undefined
    // ต้องตรงกับ isStaff() ใน firestore.rules: role staff + บัญชียังเปิดใช้งาน (ถูกระงับ = ไม่ผ่าน)
    return (role === 'admin' || role === 'dispatcher' || role === 'viewer') && profile?.active === true
      ? { uid, role, name: typeof profile?.name === 'string' ? profile.name : uid } : null
  } catch {
    return null
  }
}

export async function verifyStaffToken(authHeader: string | null): Promise<string | null> {
  const user = await verifyActiveUserToken(authHeader)
  return user && user.role !== 'viewer' ? user.uid : null
}
