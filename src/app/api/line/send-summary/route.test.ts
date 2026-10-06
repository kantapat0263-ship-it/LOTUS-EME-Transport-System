import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { profileGet } = vi.hoisted(() => ({ profileGet: vi.fn() }))
vi.mock('firebase-admin/app', () => ({
  getApps: () => [{ name: 'line-auth-test' }],
  initializeApp: vi.fn(),
  cert: vi.fn(),
}))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: profileGet }) }) }),
}))

import { POST } from './route'

const identityLookup = vi.fn()
const linePush = vi.fn()
const fakeBotToken = 'test-line-bot-token'
const fakeUserToken = 'test-firebase-user-token'
const body = JSON.stringify({ trips: [{ driverName: 'คนขับทดสอบ', driverUrl: 'https://transport.example/driver/T-TEST' }], selectedDate: '2026-10-06' })

function call(authorization: string | null = `Bearer ${fakeUserToken}`, rawBody = body) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (authorization !== null) headers.authorization = authorization
  const request = new NextRequest('http://localhost/api/line/send-summary', { method: 'POST', headers, body: rawBody })
  const readBody = vi.spyOn(request, 'json')
  return { request, readBody }
}

beforeEach(() => {
  profileGet.mockReset().mockResolvedValue({ exists: true, data: () => ({ role: 'dispatcher', active: true, name: 'คนจัดรถทดสอบ' }) })
  identityLookup.mockReset().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ users: [{ localId: 'staff-test-uid' }] }), { status: 200 })))
  linePush.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) return identityLookup(url, init)
    if (url === 'https://api.line.me/v2/bot/message/push') return linePush(url, init)
    throw new Error('Unexpected outbound request in test')
  }))
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '')
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_BASE64', Buffer.from(JSON.stringify({ project_id: 'demo-line-auth', client_email: 'test@demo-line-auth.iam.gserviceaccount.com', private_key: 'unused-mocked-key' })).toString('base64'))
  vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', fakeBotToken)
  vi.stubEnv('LINE_GROUP_ID', 'test-line-group')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LINE summary authorizes with the existing Firebase staff verifier', () => {
  it.each([null, 'Basic invalid', 'Bearer'])('rejects %s before reading the body or contacting LINE', async authorization => {
    const { request, readBody } = call(authorization, '{invalid-json')
    expect((await POST(request)).status).toBe(401)
    expect(readBody).not.toHaveBeenCalled()
    expect(identityLookup).not.toHaveBeenCalled()
    expect(linePush).not.toHaveBeenCalled()
  })

  it('rejects an invalid or expired Firebase token without sending', async () => {
    identityLookup.mockResolvedValue(new Response('{}', { status: 400 }))
    const { request, readBody } = call()
    expect((await POST(request)).status).toBe(401)
    expect(readBody).not.toHaveBeenCalled()
    expect(profileGet).not.toHaveBeenCalled()
    expect(linePush).not.toHaveBeenCalled()
  })

  it.each(['admin', 'dispatcher'])('allows an active %s and keeps the LINE message format', async role => {
    profileGet.mockResolvedValue({ exists: true, data: () => ({ role, active: true }) })
    const { request } = call()
    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(JSON.parse(identityLookup.mock.calls[0][1].body)).toEqual({ idToken: fakeUserToken })
    expect(profileGet).toHaveBeenCalledTimes(1)
    expect(linePush).toHaveBeenCalledTimes(1)
    const outgoing = linePush.mock.calls[0][1]
    expect(outgoing.headers.Authorization).toBe(`Bearer ${fakeBotToken}`)
    expect(JSON.stringify(outgoing)).not.toContain(fakeUserToken)
    expect(JSON.parse(outgoing.body)).toEqual({
      to: 'test-line-group',
      messages: [{ type: 'text', text: '📋 ใบคิวรถประจำวัน LOTUS GROUP\n📅 วันที่ปฏิบัติงาน: วันอังคารที่ 6 ตุลาคม 2569\n\n🔗 รายการลิงก์ใบงานดิจิทัลสำหรับคนขับ:\n\n🚛 คนขับทดสอบ\n🔗 https://transport.example/driver/T-TEST' }],
    })
  })

  it.each([
    ['viewer', true],
    ['admin', false],
    ['dispatcher', false],
    ['admin', undefined],
    ['dispatcher', undefined],
    ['unknown-role', true],
  ])('rejects role %s with active=%s before reading the body', async (role, active) => {
    profileGet.mockResolvedValue({ exists: true, data: () => ({ role, active }) })
    const { request, readBody } = call()
    expect((await POST(request)).status).toBe(401)
    expect(readBody).not.toHaveBeenCalled()
    expect(linePush).not.toHaveBeenCalled()
  })

  it('rejects a missing profile', async () => {
    profileGet.mockResolvedValue({ exists: false })
    expect((await POST(call().request)).status).toBe(401)
    expect(linePush).not.toHaveBeenCalled()
  })

  it.each(['identity', 'profile'])('fails closed when %s verification is unavailable', async failure => {
    if (failure === 'identity') identityLookup.mockRejectedValue(new Error('test unavailable'))
    else profileGet.mockRejectedValue(new Error('test unavailable'))
    expect((await POST(call().request)).status).toBe(401)
    expect(linePush).not.toHaveBeenCalled()
  })

  it('checks the latest staff profile on every request', async () => {
    expect((await POST(call().request)).status).toBe(200)
    profileGet.mockResolvedValue({ exists: true, data: () => ({ role: 'dispatcher', active: false }) })
    expect((await POST(call().request)).status).toBe(401)
    expect(profileGet).toHaveBeenCalledTimes(2)
    expect(linePush).toHaveBeenCalledTimes(1)
  })

  it('preserves missing LINE configuration behavior for authorized staff', async () => {
    vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', '')
    expect((await POST(call().request)).status).toBe(500)
    expect(profileGet).toHaveBeenCalledTimes(1)
    expect(linePush).not.toHaveBeenCalled()
  })

  it('preserves LINE upstream failure behavior for authorized staff', async () => {
    linePush.mockResolvedValue(new Response('{"message":"test quota"}', { status: 429 }))
    expect((await POST(call().request)).status).toBe(429)
    expect(linePush).toHaveBeenCalledTimes(1)
  })
})
