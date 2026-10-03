'use client'

/**
 * ดึง/poll ใบลาของคนขับจากระบบใบลา แล้วตอบ "สถานะวันลาต่อคนขับต่อวัน" ให้หน้าจัดคิว
 *
 * หลักสูงสุด: ตรวจไม่ได้/ยังไม่รู้ = `unknown` ห้ามกลายเป็น `free`
 * ข้อมูลผูกกับ key (`from|to|รหัสที่เรียงแล้ว`) — key เปลี่ยน = ข้อมูลเดิมใช้ไม่ได้ทันที (ตั้งแต่ render แรกหลังเปลี่ยน)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUser } from '@/firebase'
import type { Driver } from '@/types/models'
import { leaveStatusOn, type DriverLeaveStatus, type LeaveApiResponse } from '@/lib/driverLeave'
import { fetchDriverLeaves, makeCheck, normalizeCodes, type CheckFn } from '@/lib/driverLeaveClient'
import { createLatestRequestGuard } from '@/lib/latestRequest'

const POLL_MS = 60_000

/** ผลล่าสุดที่ผูกกับ key หนึ่ง — `res` ว่างได้เมื่อ key นี้ยังไม่เคยสำเร็จ */
type Snapshot = { key: string; res: LeaveApiResponse | null; failed: boolean; lastOkAt: Date | null }

export function useDriverLeaves(
  drivers: Driver[] | undefined,
  from: string,
  to: string,
): {
  status: 'loading' | 'ready' | 'error'
  lastOkAt: Date | null
  forDriver(driverId: string, date: string): DriverLeaveStatus
  check: CheckFn
} {
  const { user } = useUser()
  const guardRef = useRef<ReturnType<typeof createLatestRequestGuard> | null>(null)
  if (!guardRef.current) guardRef.current = createLatestRequestGuard()
  const [snap, setSnap] = useState<Snapshot | null>(null)

  // key ใช้สตริงรหัสที่ normalize แล้ว — ไม่ผูกกับ identity ของ array `drivers` (กัน refetch วนทุก render)
  const codesKey = normalizeCodes(drivers?.map((d) => d.employeeCode) ?? []).join(',')
  const key = `${from}|${to}|${codesKey}`
  const codes = useMemo(() => (codesKey ? codesKey.split(',') : []), [codesKey])

  const noRange = from === '' || to === ''
  const enabled = !noRange && !!user && drivers !== undefined

  useEffect(() => {
    if (!enabled || !user) {
      setSnap(null) // ยังไม่พร้อม/ไม่มีช่วงวัน → ไม่เก็บข้อมูลค้างข้ามช่วงที่ปิดอยู่
      return
    }
    const guard = guardRef.current!

    // key เปลี่ยน → ล้างข้อมูลของ key อื่นทิ้ง (กันกลับมา key เดิมแล้วเจอข้อมูลค้าง) · key เดิม (เช่น user เปลี่ยน) คงไว้
    setSnap((prev) => (prev && prev.key !== key ? null : prev))

    const ctrl = new AbortController()
    let inflight: Promise<void> | null = null

    // คำขอที่ยังค้างอยู่ใช้ promise เดิม — focus / visibility / interval ชนกันไม่ยิงซ้ำ
    const load = (): Promise<void> => {
      if (inflight) return inflight
      const isLatest = guard() // beginRequest — ทุก state write ต้องผ่าน isLatest()
      const p: Promise<void> = fetchDriverLeaves({
        codes,
        from,
        to,
        getToken: () => user.getIdToken(),
        signal: ctrl.signal,
      })
        .then(
          (res) => {
            if (!isLatest()) return
            setSnap({ key, res, failed: false, lastOkAt: new Date() })
          },
          () => {
            if (!isLatest()) return
            // เคยสำเร็จใน key นี้ → คงข้อมูล+เวลาเดิม แค่ติดธงพัง · ไม่เคย → ไม่มีข้อมูล
            setSnap((prev) =>
              prev && prev.key === key
                ? { ...prev, failed: true }
                : { key, res: null, failed: true, lastOkAt: null },
            )
          },
        )
        .finally(() => {
          if (inflight === p) inflight = null
        })
      inflight = p
      return p
    }

    let timer: ReturnType<typeof setInterval> | null = null
    const startTimer = () => {
      if (timer === null) timer = setInterval(() => void load(), POLL_MS)
    }
    const stopTimer = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        startTimer()
        void load()
      } else {
        stopTimer()
      }
    }
    const onFocus = () => void load()

    if (document.visibilityState === 'visible') startTimer()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    void load()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      stopTimer()
      ctrl.abort()
      guard() // ทำให้ response ที่ยังค้าง (รวมที่ abort) กลายเป็น "ไม่ใช่ล่าสุด" — ห้ามเขียน state
    }
  }, [enabled, user, key, codes, from, to])

  // ผูกกับ key ปัจจุบันเท่านั้น — ระหว่าง render แรกหลัง key เปลี่ยน (effect ยังไม่ทำงาน) ต้องไม่เห็นข้อมูลของ key เก่า
  const bound = enabled && snap !== null && snap.key === key ? snap : null
  const res = bound?.res ?? null
  const status: 'loading' | 'ready' | 'error' = noRange
    ? 'ready'
    : !bound
      ? 'loading'
      : bound.failed
        ? 'error'
        : 'ready'

  const forDriver = useCallback(
    (driverId: string, date: string): DriverLeaveStatus => {
      // ลำดับตามสเปก 5.3: ยังโหลดรายชื่อไม่เสร็จ = unknown · หาคนขับไม่เจอในรายชื่อที่มีอยู่ = driver_missing
      if (!drivers) return { kind: 'unknown' }
      const driver = drivers.find((d) => d.id === driverId)
      if (!driver) return { kind: 'driver_missing' }
      // ไม่มีผลที่ผูกกับ key นี้ → ส่ง null เข้า leaveStatusOn: ไม่มีรหัส = unmapped (ไม่ต้องพึ่งเครือข่าย) · นอกนั้น unknown
      return leaveStatusOn(driver.employeeCode, date, res, res ? { from, to } : null)
    },
    [drivers, res, from, to],
  )

  const check = useMemo<CheckFn>(
    () => (user ? makeCheck(() => user.getIdToken()) : async () => ({ ok: false })),
    [user],
  )

  return { status, lastOkAt: bound?.lastOkAt ?? null, forDriver, check }
}
