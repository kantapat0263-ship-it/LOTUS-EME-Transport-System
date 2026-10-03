import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/firebase/admin', () => ({ verifyStaffToken: vi.fn() }))

import { verifyStaffToken } from '@/firebase/admin'
import { POST, dynamic } from './route'

const WORKER_URL = 'https://leave.example.workers.dev'
const WORKER_KEY = 'worker-secret-key'
// เว้นวรรค/ขึ้นบรรทัดแปลก ๆ ไว้ตั้งใจ — พิสูจน์ว่าส่งต่อ "ข้อความดิบ" ไม่ parse/stringify ใหม่
const RAW_BODY = '{ "codes": ["12345"],\n  "from": "2026-10-05", "to": "2026-10-05" }'
const WORKER_BODY = '{"employees":{"12345":{"name":"นายสมศักดิ์ ใจดี","active":true}},"leaves":[]}'

const verifyMock = vi.mocked(verifyStaffToken)
const fetchMock = vi.fn()
// route ต้อง log ฝั่ง server ทุกทางที่พัง — spy ไว้ตรวจ + กันไม่ให้รก output ของเทสต์
let errorSpy: ReturnType<typeof vi.spyOn>
/** ทุกอย่างที่ถูก console.error รวมเป็นข้อความเดียว (ไว้ตรวจว่าไม่มี key/body หลุด) */
const logged = () => errorSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n')

function call(init: { authorization?: string | null; body?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.authorization !== null) headers.authorization = init.authorization ?? 'Bearer firebase-id-token'
  return POST(
    new NextRequest('http://localhost/api/driver-leaves', {
      method: 'POST',
      headers,
      body: init.body ?? RAW_BODY,
    })
  )
}

function workerReplies(status: number, body = WORKER_BODY) {
  fetchMock.mockResolvedValue(new Response(body, { status }))
}

beforeEach(() => {
  verifyMock.mockReset()
  verifyMock.mockResolvedValue('staff-uid')
  fetchMock.mockReset()
  workerReplies(200)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('LEAVE_API_URL', WORKER_URL)
  vi.stubEnv('LEAVE_API_KEY', WORKER_KEY)
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('POST /api/driver-leaves', () => {
  it('ประกาศ dynamic = force-dynamic (ไม่ให้ Next แคชผล)', () => {
    expect(dynamic).toBe('force-dynamic')
  })

  describe('ไม่ผ่าน staff → 401', () => {
    it('verifyStaffToken คืน null → 401 unauthorized และไม่ยิง worker', async () => {
      verifyMock.mockResolvedValue(null)

      const res = await call()

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('ส่งค่า header authorization ของผู้เรียกให้ verifyStaffToken ตรง ๆ', async () => {
      await call({ authorization: 'Bearer abc.def.ghi' })
      expect(verifyMock).toHaveBeenCalledWith('Bearer abc.def.ghi')
    })

    it('ไม่มี header authorization → ส่ง null ให้ verifyStaffToken แล้ว 401', async () => {
      verifyMock.mockResolvedValue(null)

      const res = await call({ authorization: null })

      expect(verifyMock).toHaveBeenCalledWith(null)
      expect(res.status).toBe(401)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('env ไม่ครบ → 503 not_configured', () => {
    it.each([
      ['ไม่มี LEAVE_API_URL', { LEAVE_API_URL: undefined, LEAVE_API_KEY: WORKER_KEY }],
      ['ไม่มี LEAVE_API_KEY', { LEAVE_API_URL: WORKER_URL, LEAVE_API_KEY: undefined }],
      ['ไม่มีทั้งคู่', { LEAVE_API_URL: undefined, LEAVE_API_KEY: undefined }],
      ['ค่าว่าง', { LEAVE_API_URL: '', LEAVE_API_KEY: '' }],
      ['มีแต่ช่องว่าง/ขึ้นบรรทัด', { LEAVE_API_URL: '  ', LEAVE_API_KEY: ' \n' }],
    ])('%s', async (_name, env) => {
      vi.stubEnv('LEAVE_API_URL', env.LEAVE_API_URL)
      vi.stubEnv('LEAVE_API_KEY', env.LEAVE_API_KEY)

      const res = await call()

      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'not_configured' })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(logged()).toContain('not_configured')
    })

    it('คนที่ไม่ใช่ staff ได้ 401 ก่อน (ไม่รั่วว่าตั้งค่าไว้หรือไม่)', async () => {
      verifyMock.mockResolvedValue(null)
      vi.stubEnv('LEAVE_API_URL', undefined)

      expect((await call()).status).toBe(401)
    })
  })

  describe('ส่งต่อไป worker', () => {
    it('ยิง POST ไป `${LEAVE_API_URL}/api/integration/driver-leaves` ด้วย Bearer LEAVE_API_KEY + body ดิบ', async () => {
      await call({ authorization: 'Bearer firebase-id-token' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${WORKER_URL}/api/integration/driver-leaves`)
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WORKER_KEY}`,
      })
      expect(init.body).toBe(RAW_BODY)
      expect(init.cache).toBe('no-store')
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('ไม่ส่ง Firebase ID token ของผู้ใช้ต่อให้ worker', async () => {
      await call({ authorization: 'Bearer firebase-id-token' })

      const [, init] = fetchMock.mock.calls[0]
      expect(JSON.stringify(init.headers)).not.toContain('firebase-id-token')
    })

    it('ตัดช่องว่าง/ขึ้นบรรทัดรอบ LEAVE_API_KEY และ LEAVE_API_URL ก่อนใช้ (env ที่วางมาติด newline ทำให้ undici throw ทุกคำขอ)', async () => {
      vi.stubEnv('LEAVE_API_KEY', `  ${WORKER_KEY}\r\n`)
      vi.stubEnv('LEAVE_API_URL', `\t${WORKER_URL}/ \n`)

      const res = await call()

      expect(res.status).toBe(200)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${WORKER_URL}/api/integration/driver-leaves`)
      expect(init.headers.Authorization).toBe(`Bearer ${WORKER_KEY}`)
    })

    it('worker ตอบ 200 → ไม่ log อะไร', async () => {
      await call()
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('ตัด "/" ท้าย LEAVE_API_URL ก่อนต่อ path', async () => {
      vi.stubEnv('LEAVE_API_URL', `${WORKER_URL}///`)

      await call()

      expect(fetchMock.mock.calls[0][0]).toBe(`${WORKER_URL}/api/integration/driver-leaves`)
    })

    it('ตั้ง timeout 5 วินาทีด้วย AbortSignal.timeout(5000)', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')

      await call()

      expect(timeoutSpy).toHaveBeenCalledWith(5000)
      expect(fetchMock.mock.calls[0][1].signal).toBe(timeoutSpy.mock.results[0].value)
    })

    it('worker ตอบ 200 → คืน 200 พร้อม body เดิมทุกตัวอักษร', async () => {
      const res = await call()

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(await res.text()).toBe(WORKER_BODY)
    })
  })

  describe('worker ไม่ปกติ → 502', () => {
    it.each([201, 400, 401, 500, 503])('worker ตอบ %i (ไม่ใช่ 200) → 502 upstream', async (status) => {
      workerReplies(status, '{"error":"whatever"}')

      const res = await call()

      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'upstream' })
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(logged()).toContain(String(status))
    })

    it('fetch throw (ต่อไม่ติด) → 502 unreachable + log ชื่อ/ข้อความ error', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))

      const res = await call()

      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'unreachable' })
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(logged()).toContain('TypeError')
      expect(logged()).toContain('fetch failed')
    })

    it('timeout (TimeoutError) → 502 unreachable + log ชื่อ error', async () => {
      fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

      const res = await call()

      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'unreachable' })
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(logged()).toContain('TimeoutError')
    })

    it('ข้อความ error มี key ติดมา (undici ฟ้อง header ผิดรูป) → log ไม่มี key และไม่มี body', async () => {
      fetchMock.mockRejectedValue(
        new TypeError(`Headers.append: "Bearer ${WORKER_KEY}" is an invalid header value.`),
      )

      const res = await call()

      expect(res.status).toBe(502)
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(logged()).toContain('TypeError')
      expect(logged()).not.toContain(WORKER_KEY)
      expect(logged()).not.toContain(RAW_BODY)
    })

    it('อ่าน body ของ worker พังกลางทาง → 502 unreachable', async () => {
      const broken = new Response(WORKER_BODY, { status: 200 })
      vi.spyOn(broken, 'text').mockRejectedValue(new TypeError('terminated'))
      fetchMock.mockResolvedValue(broken)

      const res = await call()

      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'unreachable' })
    })
  })

  describe('ทุกคำตอบมี cache-control: no-store', () => {
    const scenarios: [string, () => void, number][] = [
      ['401', () => verifyMock.mockResolvedValue(null), 401],
      ['503', () => vi.stubEnv('LEAVE_API_KEY', undefined), 503],
      ['200', () => workerReplies(200), 200],
      ['502 upstream', () => workerReplies(500), 502],
      ['502 unreachable', () => fetchMock.mockRejectedValue(new Error('down')), 502],
    ]

    it.each(scenarios)('%s', async (_name, arrange, expectedStatus) => {
      arrange()

      const res = await call()

      expect(res.status).toBe(expectedStatus)
      expect(res.headers.get('cache-control')).toBe('no-store')
      // ไม่ว่าทางไหน log ต้องไม่มี key ของ worker หรือ body ของคำขอ
      expect(logged()).not.toContain(WORKER_KEY)
      expect(logged()).not.toContain(RAW_BODY)
    })
  })
})
