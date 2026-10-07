import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth'
import { getAdminDb, verifyActiveUserToken, verifyStaffToken } from '@/firebase/admin'
import { NextRequest } from 'next/server'
import { POST as syncCoordinates } from '@/app/api/trips/sync-coordinates/route'

let app: FirebaseApp
let uid: string
let header: string

beforeAll(async () => {
  const projectId = 'demo-continuous-queue-auth'
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080')
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099')
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_BASE64', Buffer.from(JSON.stringify({ project_id: projectId, client_email: `test@${projectId}.iam.gserviceaccount.com`, private_key: privateKey })).toString('base64'))
  app = initializeApp({ projectId, apiKey: 'fake-test-key' }, randomUUID())
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const result = await createUserWithEmailAndPassword(auth, `${randomUUID()}@test.local`, 'local-only-password')
  uid = result.user.uid
  header = `Bearer ${await result.user.getIdToken()}`
})

afterAll(async () => { if (app) await deleteApp(app); vi.unstubAllEnvs() })

it('ผู้ขอที่ active อ่าน notice ได้ แต่ไม่ผ่านสิทธิ์ staff', async () => {
  await getAdminDb().doc(`users/${uid}`).set({ name: 'ผู้ขอ', role: 'viewer', active: true })
  expect(await verifyActiveUserToken(header)).toEqual({ uid, name: 'ผู้ขอ', role: 'viewer' })
  expect(await verifyStaffToken(header)).toBeNull()
})

it('ตรวจสิทธิ์ล่าสุดจากโปรไฟล์ทุกครั้ง ไม่เชื่อ role ที่แปะมาจาก client', async () => {
  await getAdminDb().doc(`users/${uid}`).set({ name: 'คนจัดรถ', role: 'dispatcher', active: true })
  expect(await verifyStaffToken(header)).toBe(uid)
  await getAdminDb().doc(`users/${uid}`).update({ active: false })
  expect(await verifyActiveUserToken(header)).toBeNull()
  expect(await verifyStaffToken(header)).toBeNull()
  expect(await verifyActiveUserToken('Bearer forged-token')).toBeNull()
  expect(await verifyActiveUserToken(null)).toBeNull()
})

it('coordinate API rejects missing or forged tokens before accepting a command', async () => {
  for (const auth of ['', 'Bearer forged-token']) {
    const response = await syncCoordinates(new NextRequest('http://localhost/api/trips/sync-coordinates', { method: 'POST', headers: { Authorization: auth }, body: '{}' }))
    expect(response.status).toBe(401)
  }
})

it('coordinate API denies viewers and suspended dispatchers, and validates staff input', async () => {
  for (const profile of [{ role: 'viewer', active: true, status: 403 }, { role: 'dispatcher', active: false, status: 401 }, { role: 'dispatcher', active: true, status: 400 }]) {
    await getAdminDb().doc(`users/${uid}`).set({ name: 'ทดสอบ', role: profile.role, active: profile.active })
    const response = await syncCoordinates(new NextRequest('http://localhost/api/trips/sync-coordinates', { method: 'POST', headers: { Authorization: header }, body: '{}' }))
    expect(response.status).toBe(profile.status)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  }
})
