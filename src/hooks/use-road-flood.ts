'use client'

/**
 * ดึงชั้น "น้ำท่วมถนน กทม." จาก /api/road-events ทุก 5 นาทีขณะเปิดชั้น (spec ข้อ 7)
 *
 * หลักสูงสุด: โหลดไม่ได้ ≠ ไม่มีน้ำท่วม — phase แยก loading / ready / error ชัด
 * ดึงล้มแต่เคยมีข้อมูล → คงชุดเดิม + lastFailed (ให้แถบสถานะบอกอายุ) · ไม่เคยมี → error
 */

import { useEffect, useRef, useState } from 'react'
import { parseRoadEventsResponse, type FloodPhase, type RoadFloodSnapshot } from '@/lib/roadFlood'
import { createLatestRequestGuard } from '@/lib/latestRequest'

const POLL_MS = 5 * 60_000
const TICK_MS = 60_000

/** ไม่ต่อ ?t= — ต้องการให้ CDN cache ทำงาน · ข้อมูลตัวอย่างเปิดได้เฉพาะ dev ด้วย ?floodSample=1 ที่หน้า */
function endpoint(): string {
  if (
    process.env.NODE_ENV !== 'production' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('floodSample') === '1'
  ) {
    return '/api/road-events?sample=1'
  }
  return '/api/road-events'
}

export function useRoadFlood(enabled: boolean): {
  snapshot: RoadFloodSnapshot | null
  phase: FloodPhase
  lastFailed: boolean
  now: number
} {
  const [snapshot, setSnapshot] = useState<RoadFloodSnapshot | null>(null)
  const [phase, setPhase] = useState<FloodPhase>('idle')
  const [lastFailed, setLastFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const guardRef = useRef(createLatestRequestGuard())
  const hasSnapshotRef = useRef(false)

  useEffect(() => {
    if (!enabled) return // ปิดชั้น/ออกจากโหมดวันนี้ → cleanup ของรอบก่อน abort + หยุด poll แล้ว · คง snapshot ไว้
    const guard = guardRef.current
    const ctrl = new AbortController()
    let inflight = false

    const load = async () => {
      if (inflight) return // interval ชนกับคำขอที่ยังค้าง → ไม่ยิงซ้อน
      inflight = true
      const isLatest = guard()
      if (!hasSnapshotRef.current) setPhase('loading')
      let next: RoadFloodSnapshot | null = null
      try {
        const res = await fetch(endpoint(), { signal: ctrl.signal })
        const json: unknown = await res.json().catch(() => null)
        next = res.ok ? parseRoadEventsResponse(json) : null
      } catch {
        next = null
      }
      inflight = false
      if (ctrl.signal.aborted || !isLatest()) return
      setNow(Date.now())
      if (next) {
        hasSnapshotRef.current = true
        setSnapshot(next)
        setLastFailed(false)
        setPhase('ready')
      } else if (hasSnapshotRef.current) {
        setLastFailed(true)
        setPhase('ready')
      } else {
        setPhase('error')
      }
    }

    setNow(Date.now())
    void load()
    const poll = setInterval(() => void load(), POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => {
      ctrl.abort()
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [enabled])

  return { snapshot, phase, lastFailed, now }
}
