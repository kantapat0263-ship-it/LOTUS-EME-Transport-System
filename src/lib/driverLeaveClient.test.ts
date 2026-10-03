import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  confirmLeaveBeforeAssign,
  fetchDriverLeaves,
  makeCheck,
  normalizeCodes,
  type CheckFn,
} from './driverLeaveClient'
import type { ApiLeave, Coverage, LeaveApiResponse } from './driverLeave'
import type { Driver } from '@/types/models'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------- helpers ----------

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const emptyRes: LeaveApiResponse = { employees: {}, leaves: [] }

const getToken = async () => 'tok-123'

const leave = (o: Partial<ApiLeave> = {}): ApiLeave => ({
  code: '10001',
  type: 'personal',
  typeLabel: 'ลากิจ',
  start: '2026-10-05',
  end: '2026-10-05',
  days: 1,
  status: 'approved',
  timing: null,
  edges: null,
  ...o,
})

// ---------- normalizeCodes ----------

describe('normalizeCodes', () => {
  it('trim, ตัดว่าง, ตัดซ้ำ, เรียง', () => {
    expect(normalizeCodes([' 2 ', '1', '', undefined, '1', '  '])).toEqual(['1', '2'])
  })
})

// ---------- fetchDriverLeaves ----------

describe('fetchDriverLeaves', () => {
  it('ไม่มีรหัส → ไม่ยิง fetch ไม่ขอ token คืนข้อมูลว่าง', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const tokenFn = vi.fn(getToken)
    const out = await fetchDriverLeaves({
      codes: ['', '  '],
      from: '2026-10-01',
      to: '2026-10-31',
      getToken: tokenFn,
      fetchImpl,
    })
    expect(out).toEqual({ employees: {}, leaves: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(tokenFn).not.toHaveBeenCalled()
  })

  it('ส่ง POST /api/driver-leaves พร้อม Bearer token (รหัสเรียงแล้ว) และคืนผล response', async () => {
    const body: LeaveApiResponse = {
      employees: { '10001': { name: 'สมศักดิ์', active: true }, '10002': null },
      leaves: [leave()],
    }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonRes(body))
    const out = await fetchDriverLeaves({
      codes: ['10002', ' 10001 ', '10001'],
      from: '2026-10-01',
      to: '2026-10-31',
      getToken,
      fetchImpl,
    })
    expect(out).toEqual(body)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('/api/driver-leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-123' },
      body: JSON.stringify({ codes: ['10001', '10002'], from: '2026-10-01', to: '2026-10-31' }),
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    })
  })

  it('51 รหัส → แบ่ง 2 คำขอ (50+1) ตามลำดับที่เรียงแล้ว แล้วรวมผล', async () => {
    const codes = Array.from({ length: 51 }, (_, i) => String(i + 1).padStart(3, '0')).reverse()
    const sorted = [...codes].reverse()
    const sent: string[][] = []
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const batch = (JSON.parse(String(init?.body)) as { codes: string[] }).codes
      sent.push(batch)
      return jsonRes({
        employees: Object.fromEntries(batch.map((c) => [c, { name: `n${c}`, active: true }])),
        leaves: [leave({ code: batch[0] })],
      })
    })
    const out = await fetchDriverLeaves({
      codes,
      from: '2026-10-01',
      to: '2026-10-31',
      getToken,
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sent[0]).toEqual(sorted.slice(0, 50))
    expect(sent[1]).toEqual(sorted.slice(50))
    expect(Object.keys(out.employees).sort()).toEqual(sorted)
    expect(out.leaves.map((l) => l.code)).toEqual([sorted[0], sorted[50]])
  })

  it('50 รหัสพอดี → คำขอเดียว', async () => {
    const codes = Array.from({ length: 50 }, (_, i) => String(i + 1).padStart(3, '0'))
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonRes(emptyRes))
    await fetchDriverLeaves({ codes, from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('batch ใดพัง → throw ทั้งรอบ (ไม่คืนผลครึ่ง ๆ)', async () => {
    const codes = Array.from({ length: 51 }, (_, i) => String(i + 1).padStart(3, '0'))
    let n = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => (++n === 2 ? jsonRes({ error: 'bad gateway' }, 502) : jsonRes(emptyRes)))
    await expect(
      fetchDriverLeaves({ codes, from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl }),
    ).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('ตอบ non-ok (401) → throw', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonRes(emptyRes, 401))
    await expect(
      fetchDriverLeaves({ codes: ['1'], from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl }),
    ).rejects.toThrow()
  })

  it('ได้ HTML (ไม่ใช่ JSON) → throw', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<!doctype html><html></html>', { status: 200 }))
    await expect(
      fetchDriverLeaves({ codes: ['1'], from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl }),
    ).rejects.toThrow()
  })

  it('JSON ผิด schema → throw', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonRes({ employees: [], leaves: 'x' }))
    await expect(
      fetchDriverLeaves({ codes: ['1'], from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl }),
    ).rejects.toThrow(/invalid/)
  })

  it('เกิน timeoutMs → throw แม้ fetchImpl ไม่ resolve ไม่สนใจ signal และ abort signal ที่ส่งให้ fetch', async () => {
    let seen: AbortSignal | null | undefined
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      seen = init?.signal
      return new Promise<Response>(() => {})
    })
    await expect(
      fetchDriverLeaves({ codes: ['1'], from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl, timeoutMs: 50 }),
    ).rejects.toThrow()
    expect(seen?.aborted).toBe(true)
  })

  it('timeout ครอบถึงขั้นขอ token ด้วย (getToken ค้าง → throw ไม่ยิง fetch)', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(
      fetchDriverLeaves({
        codes: ['1'],
        from: '2026-10-01',
        to: '2026-10-31',
        getToken: () => new Promise<string>(() => {}),
        fetchImpl,
        timeoutMs: 50,
      }),
    ).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('timeout นับรวมทุก batch (batch แรกช้าจนหมดเวลา → ไม่ยิง batch ถัดไป)', async () => {
    vi.useFakeTimers()
    const codes = Array.from({ length: 51 }, (_, i) => String(i + 1).padStart(3, '0'))
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonRes(emptyRes)), 60)
        }),
    )
    const p = fetchDriverLeaves({ codes, from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl, timeoutMs: 100 })
    const assertion = expect(p).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(200)
    await assertion
    // batch 1 ใช้ 60ms (ผ่าน) · batch 2 เริ่มที่ 60ms ต้องใช้อีก 60ms = 120ms > 100ms → หมดเวลา
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('opts.signal ถูก abort → throw', async () => {
    const ac = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}))
    const p = fetchDriverLeaves({
      codes: ['1'],
      from: '2026-10-01',
      to: '2026-10-31',
      getToken,
      fetchImpl,
      signal: ac.signal,
    })
    const assertion = expect(p).rejects.toThrow()
    await Promise.resolve()
    ac.abort()
    await assertion
  })

  it('opts.signal ที่ abort ไว้แล้ว → throw ไม่ยิง fetch', async () => {
    const ac = new AbortController()
    ac.abort()
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonRes(emptyRes))
    await expect(
      fetchDriverLeaves({ codes: ['1'], from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl, signal: ac.signal }),
    ).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('opts.signal ที่ abort ไว้แล้ว + getToken ค้าง → throw ทันที ไม่เรียก getToken ไม่ทิ้ง timer', async () => {
    vi.useFakeTimers()
    const ac = new AbortController()
    ac.abort()
    const tokenFn = vi.fn((): Promise<string> => new Promise<string>(() => {}))
    const fetchImpl = vi.fn<typeof fetch>()
    // ไม่เดินเวลาเลย — ต้อง reject เองจาก signal ที่ abort ไว้ ไม่ต้องรอ timeout
    await expect(
      fetchDriverLeaves({
        codes: ['1'],
        from: '2026-10-01',
        to: '2026-10-31',
        getToken: tokenFn,
        fetchImpl,
        signal: ac.signal,
        timeoutMs: 50,
      }),
    ).rejects.toThrow()
    expect(tokenFn).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('เคลียร์ timer ทุกกรณี (สำเร็จ / พัง) ไม่ค้าง', async () => {
    vi.useFakeTimers()
    const ok = vi.fn<typeof fetch>(async () => jsonRes(emptyRes))
    await fetchDriverLeaves({ codes: ['1'], from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl: ok })
    expect(vi.getTimerCount()).toBe(0)

    const bad = vi.fn<typeof fetch>(async () => jsonRes({}, 500))
    await expect(
      fetchDriverLeaves({ codes: ['1'], from: '2026-10-01', to: '2026-10-31', getToken, fetchImpl: bad }),
    ).rejects.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ---------- makeCheck ----------

describe('makeCheck', () => {
  it('สำเร็จ → { ok:true, res, coverage = from/to ที่ขอ }', async () => {
    const body: LeaveApiResponse = { employees: { '1': { name: 'ก', active: true } }, leaves: [] }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonRes(body))
    const r = await makeCheck(getToken, fetchImpl)(['1'], '2026-10-05', '2026-10-09')
    expect(r).toEqual({ ok: true, res: body, coverage: { from: '2026-10-05', to: '2026-10-09' } })
  })

  it('พังทุกแบบ → { ok:false } ไม่ reject (fetch พัง / token พัง / non-ok)', async () => {
    const boom = vi.fn<typeof fetch>(async () => {
      throw new TypeError('network down')
    })
    expect(await makeCheck(getToken, boom)(['1'], '2026-10-05', '2026-10-05')).toEqual({ ok: false })

    const noToken = vi.fn<typeof fetch>()
    const failToken = async (): Promise<string> => {
      throw new Error('no user')
    }
    expect(await makeCheck(failToken, noToken)(['1'], '2026-10-05', '2026-10-05')).toEqual({ ok: false })
    expect(noToken).not.toHaveBeenCalled()

    const http500 = vi.fn<typeof fetch>(async () => jsonRes({}, 500))
    expect(await makeCheck(getToken, http500)(['1'], '2026-10-05', '2026-10-05')).toEqual({ ok: false })
  })

  it('ไม่มีรหัส → ok:true ข้อมูลว่าง ไม่ยิง network', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const r = await makeCheck(getToken, fetchImpl)([], '2026-10-05', '2026-10-05')
    expect(r).toEqual({ ok: true, res: emptyRes, coverage: { from: '2026-10-05', to: '2026-10-05' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// ---------- confirmLeaveBeforeAssign ----------

const drivers: Driver[] = [
  { id: 'd1', name: 'สมศักดิ์', phoneNumber: '081', employeeCode: '10001' },
  { id: 'd2', name: 'สมหญิง', phoneNumber: '082', employeeCode: '10002' },
  { id: 'd3', name: 'ไม่ผูกรหัส', phoneNumber: '083' },
  { id: 'd4', name: 'รหัสไม่พบ', phoneNumber: '084', employeeCode: '99999' },
  { id: 'd5', name: 'คนพ้นสภาพ', phoneNumber: '085', employeeCode: '10005' },
]

const COV: Coverage = { from: '2026-10-01', to: '2026-10-31' }

const EMPLOYEES: LeaveApiResponse['employees'] = {
  '10001': { name: 'สมศักดิ์ ใจดี', active: true },
  '10002': { name: 'สมหญิง ใจงาม', active: true },
  '99999': null,
  '10005': { name: 'คนพ้นสภาพ ลาออก', active: false },
}

const checkWith = (leaves: ApiLeave[], employees = EMPLOYEES) =>
  vi.fn<CheckFn>(async () => ({ ok: true, res: { employees, leaves }, coverage: COV }))

/** confirmFn ปลอม — เก็บข้อความที่ถูกถาม แล้วตอบตามที่กำหนด */
const asker = (answer: boolean) => {
  const asked: string[] = []
  const fn = (m: string) => (asked.push(m), answer)
  return { asked, fn }
}

describe('confirmLeaveBeforeAssign', () => {
  it('ทุกคนว่าง → true ไม่ถาม', async () => {
    const a = asker(false)
    const check = checkWith([leave({ code: '10001', start: '2026-10-20', end: '2026-10-20' })])
    const r = await confirmLeaveBeforeAssign(check, [{ driverId: 'd1', date: '2026-10-05' }, { driverId: 'd2', date: '2026-10-05' }], drivers, a.fn)
    expect(r).toBe(true)
    expect(a.asked).toEqual([])
  })

  it('ok:true แต่คนขับที่ผูกรหัสไม่มีใน employees (unknown) → ถามด้วยบรรทัดตรวจไม่ได้ของคนนั้น', async () => {
    // d2 ผูกรหัส '10002' แต่ response ไม่มี key นี้ = ไม่ได้ตรวจ ห้ามถือเป็น "ไม่ลา"
    const { '10002': _omit, ...withoutD2 } = EMPLOYEES
    const check = checkWith([], withoutD2)
    const expected = ['⚠️ ตรวจวันลาของ สมหญิง ไม่ได้ตอนนี้', '', 'ยืนยันทำต่อ?'].join('\n')

    const no = asker(false)
    expect(await confirmLeaveBeforeAssign(check, [{ driverId: 'd2', date: '2026-10-05' }], drivers, no.fn)).toBe(false)
    expect(no.asked).toEqual([expected])

    const yes = asker(true)
    expect(await confirmLeaveBeforeAssign(check, [{ driverId: 'd2', date: '2026-10-05' }], drivers, yes.fn)).toBe(true)
    expect(yes.asked).toEqual([expected])
  })

  it('คนลา + คน unknown → ข้อความเดียวมีทั้งสองบล็อก เรียงตามลำดับ target', async () => {
    const { '10002': _omit, ...withoutD2 } = EMPLOYEES
    const check = checkWith([leave({ code: '10001' })], withoutD2)
    const leaveBlock = ['⚠️ สมศักดิ์ ลาวันที่ 5 ต.ค.', '• ลากิจ · อนุมัติแล้ว'].join('\n')
    const unknownBlock = '⚠️ ตรวจวันลาของ สมหญิง ไม่ได้ตอนนี้'

    const a = asker(true)
    await confirmLeaveBeforeAssign(
      check,
      [{ driverId: 'd1', date: '2026-10-05' }, { driverId: 'd2', date: '2026-10-05' }],
      drivers,
      a.fn,
    )
    expect(a.asked).toEqual([`${leaveBlock}\n\n${unknownBlock}\n\nยืนยันทำต่อ?`])

    const b = asker(true)
    await confirmLeaveBeforeAssign(
      check,
      [{ driverId: 'd2', date: '2026-10-05' }, { driverId: 'd1', date: '2026-10-05' }],
      drivers,
      b.fn,
    )
    expect(b.asked).toEqual([`${unknownBlock}\n\n${leaveBlock}\n\nยืนยันทำต่อ?`])
  })

  it('คน unknown คนเดียวกันหลายวัน → บรรทัดตรวจไม่ได้โผล่ครั้งเดียว', async () => {
    const { '10002': _omit, ...withoutD2 } = EMPLOYEES
    const a = asker(true)
    await confirmLeaveBeforeAssign(
      checkWith([], withoutD2),
      [{ driverId: 'd2', date: '2026-10-05' }, { driverId: 'd2', date: '2026-10-06' }],
      drivers,
      a.fn,
    )
    expect(a.asked).toEqual(['⚠️ ตรวจวันลาของ สมหญิง ไม่ได้ตอนนี้\n\nยืนยันทำต่อ?'])
  })

  it('ไม่มี target เลย → true ไม่ถาม ไม่เรียก check', async () => {
    const a = asker(false)
    const check = checkWith([])
    expect(await confirmLeaveBeforeAssign(check, [], drivers, a.fn)).toBe(true)
    expect(check).not.toHaveBeenCalled()
    expect(a.asked).toEqual([])
  })

  it('check fails → asks unknown prompt', async () => {
    const asked: string[] = []
    const r = await confirmLeaveBeforeAssign(
      async () => ({ ok: false }),
      [{ driverId: 'd1', date: '2026-10-05' }],
      drivers,
      (m) => (asked.push(m), false),
    )
    expect(r).toBe(false)
    expect(asked).toEqual(['⚠️ ตรวจวันลาไม่ได้ตอนนี้ — ยืนยันทำต่อ?'])
  })

  it('check fails + ผู้ใช้ตอบยืนยัน → true', async () => {
    const a = asker(true)
    const r = await confirmLeaveBeforeAssign(async () => ({ ok: false }), [{ driverId: 'd1', date: '2026-10-05' }], drivers, a.fn)
    expect(r).toBe(true)
    expect(a.asked).toHaveLength(1)
  })

  it('ลา → ข้อความแจกแจง + "ยืนยันทำต่อ?" · ตอบ true คืน true / ตอบ false คืน false', async () => {
    const check = checkWith([
      leave({ code: '10001', typeLabel: 'ลากิจ', timing: { mode: 'am', start: '08:00', end: '12:00' } }),
      leave({ code: '10001', type: 'vacation', typeLabel: 'ลาพักร้อน', status: 'pending', timing: { mode: 'pm', start: '13:00', end: '17:00' } }),
    ])
    const expected = [
      '⚠️ สมศักดิ์ ลาวันที่ 5 ต.ค.',
      '• ลากิจ ครึ่งวันเช้า · อนุมัติแล้ว',
      '• ลาพักร้อน ครึ่งวันบ่าย · รออนุมัติ',
      '',
      'ยืนยันทำต่อ?',
    ].join('\n')

    const yes = asker(true)
    expect(await confirmLeaveBeforeAssign(check, [{ driverId: 'd1', date: '2026-10-05' }], drivers, yes.fn)).toBe(true)
    expect(yes.asked).toEqual([expected])

    const no = asker(false)
    expect(await confirmLeaveBeforeAssign(check, [{ driverId: 'd1', date: '2026-10-05' }], drivers, no.fn)).toBe(false)
    expect(no.asked).toEqual([expected])
  })

  it('ลาหลายคน (ลา + พ้นสภาพ) → บล็อกของแต่ละคนคั่นด้วยบรรทัดว่าง แล้วต่อด้วย "ยืนยันทำต่อ?" · คนว่างไม่ขึ้น', async () => {
    const check = checkWith([leave({ code: '10001' })])
    const a = asker(true)
    await confirmLeaveBeforeAssign(
      check,
      [
        { driverId: 'd1', date: '2026-10-05' },
        { driverId: 'd2', date: '2026-10-05' },
        { driverId: 'd5', date: '2026-10-05' },
      ],
      drivers,
      a.fn,
    )
    expect(a.asked).toEqual([
      [
        '⚠️ สมศักดิ์ ลาวันที่ 5 ต.ค.',
        '• ลากิจ · อนุมัติแล้ว',
        '',
        '⛔ คนพ้นสภาพ พ้นสภาพในระบบใบลาแล้ว',
        '',
        'ยืนยันทำต่อ?',
      ].join('\n'),
    ])
  })

  it('คนเดียวกันหลาย target (วันเดียวกัน) → ชื่อไม่ซ้ำในข้อความ', async () => {
    const check = checkWith([leave({ code: '10001' })])
    const a = asker(true)
    await confirmLeaveBeforeAssign(
      check,
      [
        { driverId: 'd1', date: '2026-10-05' },
        { driverId: 'd1', date: '2026-10-05' },
        { driverId: 'd1', date: '2026-10-05' },
      ],
      drivers,
      a.fn,
    )
    expect(a.asked).toHaveLength(1)
    expect(a.asked[0].split('สมศักดิ์')).toHaveLength(2) // ชื่อโผล่ครั้งเดียว
    expect(a.asked[0]).toBe(['⚠️ สมศักดิ์ ลาวันที่ 5 ต.ค.', '• ลากิจ · อนุมัติแล้ว', '', 'ยืนยันทำต่อ?'].join('\n'))
  })

  it('คนเดียวกันลาคนละวัน → แยกบล็อกตามวัน (ตัดซ้ำตาม driverId+date)', async () => {
    const check = checkWith([leave({ code: '10001', start: '2026-10-05', end: '2026-10-06', days: 2 })])
    const a = asker(true)
    await confirmLeaveBeforeAssign(
      check,
      [
        { driverId: 'd1', date: '2026-10-05' },
        { driverId: 'd1', date: '2026-10-06' },
        { driverId: 'd1', date: '2026-10-05' },
      ],
      drivers,
      a.fn,
    )
    expect(a.asked).toHaveLength(1)
    expect(a.asked[0]).toContain('สมศักดิ์ ลาวันที่ 5 ต.ค.')
    expect(a.asked[0]).toContain('สมศักดิ์ ลาวันที่ 6 ต.ค.')
    expect(a.asked[0].split('สมศักดิ์ ลาวันที่ 5 ต.ค.')).toHaveLength(2)
  })

  it('unmapped / not_found / driver_missing → ไม่ถาม คืน true', async () => {
    const check = checkWith([])
    const a = asker(false)
    const r = await confirmLeaveBeforeAssign(
      check,
      [
        { driverId: 'd3', date: '2026-10-05' }, // ไม่มี employeeCode → unmapped
        { driverId: 'd4', date: '2026-10-05' }, // รหัสไม่พบในระบบใบลา → not_found
        { driverId: 'ghost', date: '2026-10-05' }, // ไม่มีในรายชื่อคนขับ → driver_missing
      ],
      drivers,
      a.fn,
    )
    expect(r).toBe(true)
    expect(a.asked).toEqual([])
    expect(check).toHaveBeenCalledWith(['99999'], '2026-10-05', '2026-10-05')
  })

  it('ไม่มีรหัสเลย → ยังเรียก check ด้วย [] (ไม่ข้ามด่าน) แล้วคืน true', async () => {
    const check = vi.fn<CheckFn>(async () => ({ ok: true, res: emptyRes, coverage: COV }))
    const a = asker(false)
    const r = await confirmLeaveBeforeAssign(
      check,
      [{ driverId: 'd3', date: '2026-10-05' }, { driverId: 'ghost', date: '2026-10-05' }],
      drivers,
      a.fn,
    )
    expect(r).toBe(true)
    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith([], '2026-10-05', '2026-10-05')
    expect(a.asked).toEqual([])
  })

  it('หลายวัน → check ถูกเรียกด้วย from=min to=max และรหัสที่ normalize แล้ว (ซ้ำ/ว่างตัดทิ้ง)', async () => {
    const check = checkWith([])
    await confirmLeaveBeforeAssign(
      check,
      [
        { driverId: 'd2', date: '2026-10-07' },
        { driverId: 'd1', date: '2026-10-05' },
        { driverId: 'd3', date: '2026-10-06' },
        { driverId: 'd1', date: '2026-10-09' },
        { driverId: 'ghost', date: '2026-10-08' },
      ],
      drivers,
      asker(true).fn,
    )
    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith(['10001', '10002'], '2026-10-05', '2026-10-09')
  })

  it('ตัดสินจากผลของ check รอบนั้นเอง ไม่จำผลรอบก่อน', async () => {
    let onLeave = true
    const check: CheckFn = async () => ({
      ok: true,
      res: { employees: EMPLOYEES, leaves: onLeave ? [leave({ code: '10001' })] : [] },
      coverage: COV,
    })
    const a = asker(true)
    const target = [{ driverId: 'd1', date: '2026-10-05' }]
    await confirmLeaveBeforeAssign(check, target, drivers, a.fn)
    expect(a.asked).toHaveLength(1)
    onLeave = false
    await confirmLeaveBeforeAssign(check, target, drivers, a.fn)
    expect(a.asked).toHaveLength(1) // รอบสองว่าง → ไม่ถามเพิ่ม
  })

  it('confirmFn ค่าเริ่มต้น = window.confirm (อ้าง window ตอนเรียก ไม่ใช่ตอน import)', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('window', { confirm })
    const r = await confirmLeaveBeforeAssign(async () => ({ ok: false }), [{ driverId: 'd1', date: '2026-10-05' }], drivers)
    expect(r).toBe(true)
    expect(confirm).toHaveBeenCalledWith('⚠️ ตรวจวันลาไม่ได้ตอนนี้ — ยืนยันทำต่อ?')
  })
})
