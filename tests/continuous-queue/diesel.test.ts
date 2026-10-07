import { Firestore } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { todayBangkok } from '@/lib/vehicle-compliance'
import { GET } from '@/app/api/cron/update-diesel-price/route'

const admin = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/firebase/admin', () => ({ getAdminDb: admin.getDb }))
let db: Firestore
const projectId = 'demo-diesel-cron'
const invoke = () => GET(new NextRequest('http://localhost/api/cron/update-diesel-price', { headers: { Authorization: 'Bearer emulator-only' } }))
const history = async () => (await db.doc(`dieselPriceHistory/${todayBangkok()}`).get()).data()
const settings = async () => (await db.doc('companySettings/default').get()).data()!

beforeAll(() => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Local emulator only')
  db = new Firestore({ projectId, credentials: { client_email: 'test@demo.invalid', private_key: 'local-only' } })
})
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc('companySettings/default').set({ dieselPrice: 31, companyName: 'ข้อมูลจำลอง', updatedAt: 'original' })
  vi.stubEnv('CRON_SECRET', 'emulator-only')
  vi.stubEnv('DIESEL_PRICE_SOURCE_URL', 'https://provider.test/fuel')
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('<li>ดีเซล B7 32.94</li><li>ดีเซล พรีเมียม 49.94</li>')))
  admin.getDb.mockReturnValue(db)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(async () => { await db?.terminate() })

it('commits the price and matching Thai-day history together while preserving other settings', async () => {
  const response = await invoke()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ ok: true, price: 32.94, previous: 31, changed: true })
  expect(await settings()).toMatchObject({ dieselPrice: 32.94, companyName: 'ข้อมูลจำลอง', fuelSettingsUpdatedBy: 'auto:diesel-cron' })
  expect(await history()).toMatchObject({ date: todayBangkok(), price: 32.94, previousPrice: 31, changed: true, status: 'updated' })
  expect((await history())?.createdAt.toDate()).toBeInstanceOf(Date)
})

it('does not rewrite settings when the fetched price has not changed', async () => {
  await db.doc('companySettings/default').update({ dieselPrice: 32.94 })
  const before = await settings()
  expect(await (await invoke()).json()).toMatchObject({ ok: true, changed: false })
  expect(await settings()).toEqual(before)
  expect(await history()).toMatchObject({ previousPrice: 32.94, price: 32.94, changed: false })
})

it('keeps the price and records a skipped run when the provider row is ambiguous', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<li>ดีเซล B7 32.94 เบนซิน 40.00</li>'))
  const before = await settings()
  expect(await (await invoke()).json()).toMatchObject({ ok: false, status: 'skipped', keptPrice: 31 })
  expect(await settings()).toEqual(before)
  expect(await history()).toMatchObject({ status: 'skipped', note: 'parse-miss', price: 31, fetchedPrice: null })
})

it('aborts both staged writes if the real Firestore transaction fails before commit', async () => {
  const before = await settings()
  admin.getDb.mockReturnValue({
    collection: db.collection.bind(db),
    runTransaction: (callback: Parameters<Firestore['runTransaction']>[0]) => db.runTransaction(async tx => {
      await callback(tx)
      throw new Error('Injected pre-commit failure')
    }, { maxAttempts: 1 }),
  })
  expect((await invoke()).status).toBe(500)
  expect(await settings()).toEqual(before)
  expect(await history()).toBeUndefined()
})

it('uses fresh settings when concurrent invocations contend on the same price', async () => {
  const results = await Promise.all([invoke(), invoke()])
  const bodies = await Promise.all(results.map(result => result.json()))
  expect(bodies.map(body => body.previous).sort((a, b) => a - b)).toEqual([31, 32.94])
  expect(bodies.filter(body => body.changed)).toHaveLength(1)
  expect(await settings()).toMatchObject({ dieselPrice: 32.94 })
  expect(await history()).toMatchObject({ price: 32.94, previousPrice: 32.94, changed: false })
})
