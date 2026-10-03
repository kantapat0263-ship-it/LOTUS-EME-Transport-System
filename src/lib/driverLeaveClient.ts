/**
 * ชั้นเรียก API ระบบใบลา (`POST /api/driver-leaves`) + ด่านยืนยันกลาง "เตือนก่อนมอบงานให้คนลา"
 *
 * ที่เดียวที่คุยกับ network · ไม่แตะ React/Firebase (token ส่งเข้ามาทาง `getToken`)
 * ตรรกะตัดสินสถานะ/ข้อความอยู่ใน `driverLeave.ts` (pure) — ไฟล์นี้แค่ต่อสาย
 *
 * หลักสูงสุดเดียวกัน: ตรวจไม่ได้ = "ไม่รู้" (ถามผู้ใช้) ห้ามกลายเป็น "ไม่ลา"
 */

import type { Driver } from '@/types/models'
import {
  leaveConfirmLines,
  leaveStatusOn,
  validateLeaveResponse,
  type Coverage,
  type LeaveApiResponse,
} from './driverLeave'

export type CheckResult = { ok: true; res: LeaveApiResponse; coverage: Coverage } | { ok: false }

export type CheckFn = (codes: string[], from: string, to: string) => Promise<CheckResult>

const ENDPOINT = '/api/driver-leaves'
const BATCH_SIZE = 50
const DEFAULT_TIMEOUT_MS = 8000
const ABORTED_MSG = 'driver-leaves request aborted or timed out'

/** trim, ตัดว่าง, ตัดซ้ำ, เรียง — ใช้เป็นทั้ง key ของแคชและลำดับ batch */
export function normalizeCodes(codes: (string | undefined)[]): string[] {
  const set = new Set<string>()
  for (const c of codes) {
    const t = c?.trim()
    if (t) set.add(t)
  }
  return [...set].sort()
}

/**
 * ดึงใบลาของรหัสพนักงานทั้งหมดในช่วง from–to (รวมหัวท้าย)
 * - แบ่งยิงทีละ 50 รหัส (ตามลำดับที่เรียงแล้ว) แล้วรวมผล · batch ใดพัง = throw ทั้งรอบ (ไม่คืนผลครึ่ง ๆ)
 * - timeout (`timeoutMs`, ปกติ 8 วิ) ครอบทั้งรอบ: ขอ token + ทุก batch · `opts.signal` ยกเลิกได้
 * - response ทุกก้อนผ่าน `validateLeaveResponse` — ไม่ใช่ JSON / ผิดสัญญา = throw
 * - ทุกรหัสใน batch ต้องเป็น own key ของ `employees` — ขาด = throw (response ไม่ครบ = ตรวจไม่ได้ ไม่ใช่ "ไม่ลา")
 */
export async function fetchDriverLeaves(opts: {
  codes: string[]
  from: string
  to: string
  getToken: () => Promise<string>
  fetchImpl?: typeof fetch
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<LeaveApiResponse> {
  const codes = normalizeCodes(opts.codes)
  if (codes.length === 0) return { employees: {}, leaves: [] }

  const { from, to, getToken, signal: outer } = opts
  const doFetch = opts.fetchImpl ?? fetch

  // ผู้เรียกยกเลิกไว้แล้ว → throw เลย (ก่อนตั้ง timer / ขอ token / แข่ง race) — abort ซ้ำไม่ยิง event ถ้าปล่อยเข้า race จะค้าง
  if (outer?.aborted) throw new Error(ABORTED_MSG)

  const ctrl = new AbortController()
  const abortNow = () => ctrl.abort()
  outer?.addEventListener('abort', abortNow, { once: true })
  const timer = setTimeout(abortNow, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  // getToken / fetchImpl อาจไม่สนใจ signal → แข่งกับสัญญาณ abort เพื่อให้ throw ตามเวลาแน่ ๆ
  const aborted = new Promise<never>((_, reject) => {
    ctrl.signal.addEventListener('abort', () => reject(new Error(ABORTED_MSG)), { once: true })
  })

  const run = async (): Promise<LeaveApiResponse> => {
    const token = await getToken()
    const merged: LeaveApiResponse = { employees: {}, leaves: [] }
    for (let i = 0; i < codes.length; i += BATCH_SIZE) {
      if (ctrl.signal.aborted) throw new Error(ABORTED_MSG)
      const batch = codes.slice(i, i + BATCH_SIZE)
      const res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ codes: batch, from, to }),
        cache: 'no-store',
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`driver-leaves request failed: HTTP ${res.status}`)
      const part = validateLeaveResponse(await res.json())
      // ทุกรหัสที่ถามต้องมี key ของตัวเองใน employees (null = ไม่พบรหัส ยังนับว่ามี) — ขาดแม้รหัสเดียว = ตรวจไม่ได้ทั้งรอบ
      // ปล่อยผ่านจะได้ unknown รายคน (ไม่มีป้าย) ขณะที่ hook เป็น ready (ไม่มีแถบเตือน) → หน้าดูเหมือนคนนั้นว่าง
      const missing = batch.filter((c) => !Object.prototype.hasOwnProperty.call(part.employees, c))
      if (missing.length > 0) throw new Error(`driver-leaves response missing ${missing.length} requested code(s)`)
      Object.assign(merged.employees, part.employees)
      merged.leaves.push(...part.leaves)
    }
    return merged
  }

  try {
    return await Promise.race([run(), aborted])
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', abortNow)
  }
}

/** ตัวตรวจสำหรับด่านยืนยัน — คืนผลของคำขอนั้นเอง (ไม่แตะแคช) · พังทุกแบบ = `{ ok:false }` ไม่ reject */
export function makeCheck(getToken: () => Promise<string>, fetchImpl?: typeof fetch): CheckFn {
  return async (codes, from, to) => {
    try {
      const res = await fetchDriverLeaves({ codes, from, to, getToken, fetchImpl })
      return { ok: true, res, coverage: { from, to } }
    } catch {
      return { ok: false }
    }
  }
}

const UNKNOWN_PROMPT = '⚠️ ตรวจวันลาไม่ได้ตอนนี้ — ยืนยันทำต่อ?'
const CONFIRM_TAIL = 'ยืนยันทำต่อ?'

/**
 * ด่านกลาง: ก่อนมอบงานให้คนขับ/ส่งใบสรุปออก — ตรวจสดแล้วถามเฉพาะเมื่อมีคนลา/พ้นสภาพ หรือตรวจไม่ได้ (ทั้งรอบ หรือเฉพาะบางคน = unknown)
 * คืน true = ทำต่อได้ · false = ผู้ใช้ยกเลิก
 *
 * สถานะคิดจาก `CheckResult` ที่เพิ่งได้ในครั้งนี้เท่านั้น · unmapped / not_found / driver_missing / free ไม่ถาม
 * (มีป้ายอยู่แล้ว กันเตือนจนชิน)
 *
 * `drivers` เป็น null/undefined = รายชื่อคนขับยังไม่โหลด → ถามแบบตรวจไม่ได้ทันที (ไม่เรียก check)
 * ส่งค่าจาก useCollection มาตรง ๆ ห้าม `?? []` — รายชื่อว่างทำให้ทุกคนเป็น driver_missing แล้วด่านผ่านเงียบ ๆ
 */
export async function confirmLeaveBeforeAssign(
  check: CheckFn,
  targets: { driverId: string; date: string }[],
  drivers: Driver[] | null | undefined,
  confirmFn: (msg: string) => boolean = (m) => window.confirm(m),
): Promise<boolean> {
  if (targets.length === 0) return true
  if (!drivers) return confirmFn(UNKNOWN_PROMPT)

  const byId = new Map(drivers.map((d) => [d.id, d]))
  const codes = normalizeCodes(targets.map((t) => byId.get(t.driverId)?.employeeCode))
  const dates = targets.map((t) => t.date)
  const from = dates.reduce((a, b) => (b < a ? b : a))
  const to = dates.reduce((a, b) => (b > a ? b : a))

  const result = await check(codes, from, to)
  if (!result.ok) return confirmFn(UNKNOWN_PROMPT)

  const seen = new Set<string>()
  const blocks: string[] = []
  for (const { driverId, date } of targets) {
    const key = `${driverId}|${date}`
    if (seen.has(key)) continue
    seen.add(key)

    const driver = byId.get(driverId)
    if (!driver) continue // driver_missing — มีป้ายอยู่แล้ว ไม่ถาม
    const status = leaveStatusOn(driver.employeeCode, date, result.res, result.coverage)
    // unknown (ผูกรหัสแล้วแต่ response ไม่มีรหัสนี้) = ไม่ได้ตรวจ — ห้ามถือเป็น "ไม่ลา" จึงต้องถาม
    const lines =
      status.kind === 'unknown'
        ? [`⚠️ ตรวจวันลาของ ${driver.name} ไม่ได้ตอนนี้`]
        : leaveConfirmLines(driver.name, date, status)
    const block = lines.join('\n')
    // บล็อก unknown ไม่มีวันที่ — คนเดิมหลายวันได้ข้อความเดียวกัน ตัดซ้ำ
    if (lines.length > 0 && !blocks.includes(block)) blocks.push(block)
  }

  if (blocks.length === 0) return true
  return confirmFn(`${blocks.join('\n\n')}\n\n${CONFIRM_TAIL}`)
}
