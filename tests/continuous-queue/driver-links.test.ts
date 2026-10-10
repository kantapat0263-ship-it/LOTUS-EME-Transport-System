import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth'
import { NextRequest } from 'next/server'
import { getAdminDb } from '@/firebase/admin'
import { thaiToday } from '@/lib/driverLeave'
import { POST as issueLinks } from '@/app/api/driver-links/route'
import { GET as openTicket } from '@/app/api/driver-ticket/[tripId]/route'

let app: FirebaseApp
let uid: string
let header: string
const run = randomUUID().slice(0, 8)
const id = (name: string) => `T-${run}-${name}`

const shiftDay = (days: number) => {
  const d = new Date(`${thaiToday()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  const projectId = 'demo-driver-links'
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

  const db = getAdminDb()
  const today = thaiToday()
  const stop = (siteName: string) => ({
    siteName, cargoDetails: `ของส่ง ${siteName}`, requestTime: '09:00', requestedBy: 'ผู้ขอ', requestedByPhone: '0811111111',
    lat: 13.7, lng: 100.5, sourceVRIds: ['VR-0000-0011'], requestId: 'VR-0000-0011', distanceFromPreviousKm: 5,
  })
  await db.doc(`drivers/drv-${run}`).set({ name: 'คนขับ ก', phoneNumber: '0899999999', employeeCode: 'EMP-1' })
  await db.doc(`trips/${id('A')}`).set({
    tripId: id('A'), tripDate: today, departureTime: '08:00', driverId: `drv-${run}`, driverName: 'คนขับ ก', vehicleId: 'veh-1', vehiclePlate: '1กข 1234',
    status: 'Planned', totalDistanceKm: 42, totalEstimatedTimeMinutes: 90, fuelCost: 999, dieselPriceUsed: 31, createdBy: 'staff@example.com',
    stopNotes: { stop_0: 'ระวังทางแคบ', evil: 'x' }, stopNoteAuthors: { stop_0: 'คนจัดรถ' },
    stops: [stop('ไซต์ <b>A</b>')],
  })
  await db.doc(`trips/${id('B')}`).set({ tripId: id('B'), tripDate: today, driverId: 'drv-other', driverName: 'คนขับ ข', status: 'Planned', stops: [stop('ไซต์ B')] })
  await db.doc(`trips/${id('C')}`).set({ tripId: id('C'), tripDate: today, driverId: 'drv-other', status: 'Cancelled', stops: [] })
  await db.doc(`trips/${id('OLD')}`).set({ tripId: id('OLD'), tripDate: shiftDay(-8), driverId: 'drv-other', status: 'Completed', stops: [] })
  await db.doc(`trips/${id('EDGE')}`).set({ tripId: id('EDGE'), tripDate: shiftDay(-7), driverId: 'drv-other', status: 'Completed', stops: [] })
})

afterAll(async () => { if (app) await deleteApp(app); vi.unstubAllEnvs() })

const setProfile = (profile: Record<string, unknown> | null) => profile
  ? getAdminDb().doc(`users/${uid}`).set(profile)
  : getAdminDb().doc(`users/${uid}`).delete()
const issue = (body: unknown, auth = header) => issueLinks(new NextRequest('http://localhost/api/driver-links', {
  method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))
const open = (tripId: string, token?: string) => openTicket(
  new NextRequest(`http://localhost/api/driver-ticket/${encodeURIComponent(tripId)}${token === undefined ? '' : `?t=${encodeURIComponent(token)}`}`),
  { params: Promise.resolve({ tripId }) },
)
async function tokensFor(tripIds: string[], rotate?: boolean) {
  const response = await issue(rotate ? { tripIds, rotate } : { tripIds })
  expect(response.status).toBe(200)
  return (await response.json()).links as Record<string, string>
}

it('ออกลิงก์ได้เฉพาะคนจัดรถ/แอดมินที่ active — ผู้ขอทั่วไป 403, บัญชีรออนุมัติ/ไม่มีโปรไฟล์/ไม่ล็อกอิน 401', async () => {
  for (const [profile, auth, status] of [
    [{ role: 'viewer', active: true }, header, 403],
    [{ role: 'dispatcher', active: false, pending: true }, header, 401],
    [null, header, 401],
    [{ role: 'admin', active: true }, '', 401],
    [{ role: 'admin', active: true }, 'Bearer forged-token', 401],
  ] as const) {
    await setProfile(profile)
    const response = await issue({ tripIds: [id('A')] }, auth)
    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  }
  expect((await getAdminDb().doc(`driverLinks/${id('A')}`).get()).exists).toBe(false)
})

it('คนจัดรถได้ลิงก์ของทริปที่ยังใช้งาน · ส่งซ้ำได้ token เดิม · ทริปยกเลิก/ไม่มีอยู่ไม่ได้ลิงก์', async () => {
  await setProfile({ role: 'dispatcher', active: true, name: 'คนจัดรถ' })
  const first = await tokensFor([id('A'), id('B'), id('C'), id('MISSING')])
  expect(Object.keys(first).sort()).toEqual([id('A'), id('B')].sort())
  expect(first[id('A')]).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(first[id('A')]).not.toBe(first[id('B')])
  const again = await tokensFor([id('A'), id('B')])
  expect(again).toEqual({ [id('A')]: first[id('A')], [id('B')]: first[id('B')] })
  // ฐานข้อมูลเก็บแค่รุ่นของลิงก์ ไม่เก็บ token
  const stored = (await getAdminDb().doc(`driverLinks/${id('A')}`).get()).data()!
  expect(stored.version).toBe(1)
  expect(JSON.stringify(stored)).not.toContain(first[id('A')])
  expect((await issue({ tripIds: [id('A'), id('B')], rotate: true })).status).toBe(400) // สร้างใหม่ได้ทีละทริป
})

it('token ถูกต้อง → ได้เฉพาะข้อมูลที่ใบงานใช้ (ไม่ส่งเอกสารทริปทั้งก้อน)', async () => {
  await setProfile({ role: 'dispatcher', active: true })
  const { [id('A')]: token } = await tokensFor([id('A')])
  const response = await open(id('A'), token)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  const ticket = await response.json()
  expect(ticket.trip).toEqual({
    id: id('A'), tripId: id('A'), tripDate: thaiToday(), departureTime: '08:00', driverName: 'คนขับ ก', vehiclePlate: '1กข 1234',
    totalDistanceKm: 42, totalEstimatedTimeMinutes: 90, stopNotes: { stop_0: 'ระวังทางแคบ' }, stopNoteAuthors: { stop_0: 'คนจัดรถ' },
    stops: [{ siteName: 'ไซต์ <b>A</b>', cargoDetails: 'ของส่ง ไซต์ <b>A</b>', requestTime: '09:00', requestedBy: 'ผู้ขอ', requestedByPhone: '0811111111', lat: 13.7, lng: 100.5 }],
  })
  expect(ticket.driverPhone).toBe('0899999999')
  expect(ticket.stats).toMatchObject({ rank: expect.any(Number), completedStops: expect.any(Number) })
  expect(Object.keys(ticket.stats).sort()).toEqual(['actualKm', 'completedStops', 'rank', 'workingDays'])
  const raw = JSON.stringify(ticket)
  for (const secret of ['fuelCost', 'dieselPriceUsed', 'vehicleId', 'driverId', 'sourceVRIds', 'VR-0000-0011', 'staff@example.com', 'EMP-1', 'คนขับ ข', 'drv-other']) {
    expect(raw).not.toContain(secret)
  }
})

it('ไม่มี token / token ผิดรูปแบบ / token สุ่ม / token ของทริปอื่น → 403 ไม่บอกว่ามีทริปอยู่หรือไม่', async () => {
  await setProfile({ role: 'dispatcher', active: true })
  const tokens = await tokensFor([id('A'), id('B')])
  const random = randomBytes(32).toString('base64url')
  for (const [tripId, token] of [
    [id('A'), undefined], [id('A'), ''], [id('A'), 'short'], [id('A'), `${tokens[id('A')]}x`],
    [id('A'), random], [id('B'), tokens[id('A')]], [id('MISSING'), tokens[id('A')]], ['..', tokens[id('A')]],
  ] as const) {
    const response = await open(tripId, token)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'invalid' })
  }
})

it('ลิงก์หมดอายุหลังวันทริป 7 วัน (วันที่ 7 ยังเปิดได้)', async () => {
  await setProfile({ role: 'dispatcher', active: true })
  const tokens = await tokensFor([id('OLD'), id('EDGE')])
  expect((await open(id('EDGE'), tokens[id('EDGE')])).status).toBe(200)
  const expired = await open(id('OLD'), tokens[id('OLD')])
  expect(expired.status).toBe(410)
  expect(await expired.json()).toMatchObject({ code: 'expired' })
})

it('"สร้างลิงก์ใหม่" ทำให้ลิงก์เดิมใช้ไม่ได้ทันที · ทริปถูกยกเลิก/ลบ → ลิงก์ใช้ไม่ได้อัตโนมัติ', async () => {
  await setProfile({ role: 'admin', active: true })
  const { [id('A')]: oldToken } = await tokensFor([id('A')])
  const { [id('A')]: newToken } = await tokensFor([id('A')], true)
  expect(newToken).not.toBe(oldToken)
  expect((await open(id('A'), oldToken)).status).toBe(403)
  expect((await open(id('A'), newToken)).status).toBe(200)
  expect(await tokensFor([id('A')])).toEqual({ [id('A')]: newToken }) // ส่งซ้ำหลังสร้างใหม่ = ลิงก์ใหม่เดิม

  const { [id('B')]: tokenB } = await tokensFor([id('B')])
  await getAdminDb().doc(`trips/${id('B')}`).update({ status: 'Cancelled' })
  expect((await open(id('B'), tokenB)).status).toBe(410)
  const tripA = (await getAdminDb().doc(`trips/${id('A')}`).get()).data()!
  await getAdminDb().doc(`trips/${id('A')}`).delete()
  expect((await open(id('A'), newToken)).status).toBe(403)

  // ลบแล้วออก Trip ID เดิมซ้ำ (เลขไล่จากจำนวนทริปของวัน) → ลิงก์ของทริปเก่าต้องเปิดทริปใหม่ไม่ได้
  await getAdminDb().doc(`trips/${id('A')}`).set({ ...tripA, driverName: 'คนขับคนใหม่' })
  expect((await open(id('A'), newToken)).status).toBe(403)
  const { [id('A')]: recreatedToken } = await tokensFor([id('A')])
  expect(recreatedToken).not.toBe(newToken)
  expect((await open(id('A'), recreatedToken)).status).toBe(200)
})
