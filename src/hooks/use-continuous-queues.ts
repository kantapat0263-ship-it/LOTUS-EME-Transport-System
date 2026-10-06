'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@/firebase'
import { fetchContinuousQueues } from '@/lib/continuousQueueClient'
import type { QueueSnapshot } from '@/types/continuous-queue'

type Snapshot = { key: string; status: 'ready' | 'error'; data: QueueSnapshot | null }

export function useContinuousQueues(date: string) {
  const { user } = useUser()
  const key = `${user?.uid ?? ''}|${date}`
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    if (!user || !date) return
    const controller = new AbortController()
    let running = false
    const load = async () => {
      if (running || controller.signal.aborted) return
      running = true
      try {
        const data = await fetchContinuousQueues(user, date, controller.signal)
        if (!controller.signal.aborted) setSnapshot({ key, status: 'ready', data })
      } catch {
        if (!controller.signal.aborted) setSnapshot({ key, status: 'error', data: null })
      } finally { running = false }
    }
    void load()
    const onFocus = () => { if (!document.hidden) void load() }
    const timer = setInterval(onFocus, 60_000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      controller.abort()
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [user, date, key, revision])

  const current = snapshot?.key === key ? snapshot : null
  return { status: current?.status ?? 'loading' as 'loading' | 'ready' | 'error', notices: current?.data?.notices ?? [], bookings: current?.data?.bookings ?? [], refresh }
}
