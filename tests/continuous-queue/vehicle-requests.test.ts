import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth'
import { NextRequest } from 'next/server'
import { getAdminDb } from '@/firebase/admin'
import { thaiToday } from '@/lib/driverLeave'
import { POST as createRequest } from '@/app/api/vehicle-requests/route'

let app: FirebaseApp
let uid: string
let header: string

beforeAll(async () => {
  const projectId = 'demo-vehicle-requests'
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

/** วันทำการถัดไปที่ห่างจากวันนี้ (เวลาไทย) อย่างน้อย `ahead` วัน และไม่ใช่วันอาทิตย์ */
function workday(ahead: number) {
  const d = new Date(`${thaiToday()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + ahead)
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const siteDest = (overrides: Record<string, unknown> = {}) => ({
  category: 'site', siteId: 'site-a', siteName: 'ไซต์ A', customName: '', coordinates: '13.7, 100.5',
  jobDescription: 'ส่งท่อ 10 เส้น', saveAsSite: false, locationType: 'ไซต์งาน', requestTime: '08:30', ...overrides,
})
const body = (requestDate: string, destinations: unknown[] = [siteDest()], extra: Record<string, unknown> = {}) =>
  ({ requestDate, requestTime: '08:30', requestedBy: 'ผู้ขอทดสอบ', note: '', destinations, ...extra })

const post = (payload: unknown, auth = header) => createRequest(new NextRequest('http://localhost/api/vehicle-requests', {
  method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
}))
const setProfile = (profile: Record<string, unknown> | null) => profile
  ? getAdminDb().doc(`users/${uid}`).set(profile)
  : getAdminDb().doc(`users/${uid}`).delete()

it('ไม่มี token / token ปลอม / บัญชีรออนุมัติ / ไม่มีโปรไฟล์ → 401 และไม่มีใบถูกสร้าง', async () => {
  const day = workday(3)
  for (const [auth, profile] of [
    ['', { role: 'viewer', active: true }],
    ['Bearer forged-token', { role: 'viewer', active: true }],
    [header, { role: 'viewer', active: false, pending: true }],
    [header, null],
  ] as const) {
    await setProfile(profile)
    const response = await post(body(day), auth)
    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  }
  expect((await getAdminDb().collection('vehicleRequests').where('requestDate', '==', day).get()).size).toBe(0)
})

it('ผู้ขอทั่วไป: ใบเป็น pending ของตัวเอง เลข VR รูปแบบเดิม เบอร์มาจากโปรไฟล์ (ไม่เชื่อ status จาก client)', async () => {
  await setProfile({ name: 'สมชาย', phone: '0812345678', role: 'viewer', active: true })
  const day = workday(4)
  const response = await post(body(day))
  expect(response.status).toBe(200)
  const { requestId } = await response.json()
  const [, mm, dd] = day.split('-')
  expect(requestId).toMatch(new RegExp(`^VR-${dd}${mm}-\\d{4}$`))
  const saved = (await getAdminDb().doc(`vehicleRequests/${requestId}`).get()).data()!
  expect(saved).toMatchObject({ id: requestId, requestId, userId: uid, status: 'pending', requestedBy: 'ผู้ขอทดสอบ', requestedByPhone: '0812345678', requestDate: day })
  expect(saved.acknowledgedBy).toBeUndefined()
  expect(saved.destinations[0]).toMatchObject({ type: 'site', siteId: 'site-a', siteName: 'ไซต์ A', lat: 13.7, lng: 100.5 })
  // ส่ง status/userId ปลอมมาด้วย = ข้อมูลไม่ถูกต้อง (schema strict)
  expect((await post(body(day, [siteDest()], { status: 'in_progress', userId: 'someone-else' }))).status).toBe(400)
})

it('คนจัดรถ: ใบเข้ากองจัดคิวทันที (in_progress + รับเรื่องแล้ว) และเลือก "วันนี้" ได้', async () => {
  await setProfile({ name: 'คนจัดรถ', role: 'dispatcher', active: true })
  const today = thaiToday()
  if (new Date(`${today}T00:00:00Z`).getUTCDay() === 0) return // วันอาทิตย์ปิดรับ — ข้ามกรณีนี้
  const response = await post(body(today))
  expect(response.status).toBe(200)
  const saved = (await getAdminDb().doc(`vehicleRequests/${(await response.json()).requestId}`).get()).data()!
  expect(saved).toMatchObject({ status: 'in_progress', acknowledgedBy: 'คนจัดรถ' })
})

it('ส่งพร้อมกัน 8 ใบในวันเดียว → ได้เลขไม่ซ้ำ และบันทึกครบทุกใบ', async () => {
  await setProfile({ name: 'สมชาย', role: 'viewer', active: true })
  const day = workday(5)
  const responses = await Promise.all(Array.from({ length: 8 }, () => post(body(day))))
  expect(responses.map(r => r.status)).toEqual(Array(8).fill(200))
  const ids = await Promise.all(responses.map(async r => (await r.json()).requestId as string))
  expect(new Set(ids).size).toBe(8)
  expect((await getAdminDb().collection('vehicleRequests').where('requestDate', '==', day).get()).size).toBe(8)
})

it('ปฏิเสธวันอาทิตย์ / วันย้อนหลัง / ข้อมูลยาวเกิน / ไม่มีจุดหมาย', async () => {
  await setProfile({ name: 'สมชาย', role: 'viewer', active: true })
  const sunday = (() => { const d = new Date(`${workday(2)}T00:00:00Z`); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
  expect((await post(body(sunday))).status).toBe(400)
  expect((await post(body(thaiToday()))).status).toBe(400) // ผู้ขอทั่วไปต้องล่วงหน้าอย่างน้อย 1 วัน
  expect((await post(body(workday(3), [siteDest({ siteName: 'x'.repeat(201) })]))).status).toBe(400)
  expect((await post(body(workday(3), []))).status).toBe(400)
  expect((await post(body(workday(3), [siteDest({ siteId: '' })]))).status).toBe(400)
})

it('สถานที่ใหม่ (markup ในชื่อ) ถูกบันทึกพร้อมใบเป็นข้อความล้วน · ชื่อ/พิกัดชนสถานที่เดิมต้องยืนยันก่อน', async () => {
  await setProfile({ name: 'สมชาย', role: 'viewer', active: true })
  const name = `<img src=x onerror="alert(1)"> ร้าน ${randomUUID().slice(0, 8)}`
  const custom = { category: 'custom', siteId: '', siteName: '', customName: name, coordinates: '13.811, 100.611', jobDescription: '', saveAsSite: true, locationType: 'ร้านค้า / ซัพพลายเออร์', requestTime: '09:00' }
  const response = await post(body(workday(3), [custom]))
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.createdNames).toEqual([name])
  const saved = (await getAdminDb().doc(`vehicleRequests/${result.requestId}`).get()).data()!
  const site = (await getAdminDb().doc(`sites/${saved.destinations[0].siteId}`).get()).data()!
  expect(site).toMatchObject({ name, latitude: 13.811, longitude: 100.611, projectTypeTag: 'ร้านค้า / ซัพพลายเออร์', isUserAdded: true, status: 'Active', address: '' })

  const conflict = await post(body(workday(3), [{ ...custom, customName: 'ชื่ออื่น' }]))
  expect(conflict.status).toBe(400)
  expect((await conflict.json()).error).toContain('ตรงกับ')
  const bad = await post(body(workday(3), [{ ...custom, customName: 'พิกัดผิด', coordinates: '13.8' }]))
  expect(bad.status).toBe(400)
})
