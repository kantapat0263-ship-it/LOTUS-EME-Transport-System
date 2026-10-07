import { afterEach, expect, it, vi } from 'vitest'
import { loadWeeklyStopReport, submitStopReview } from './weeklyStopClient'
import type { StopReviewCommand } from '@/server/weeklyStopValidation'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
it('sends a Firebase token and uses no cache for private weekly data', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ weekStart: '2026-10-05', weekEnd: '2026-10-11', days: [], drivers: [] })))
  vi.stubGlobal('fetch', request)
  await expect(loadWeeklyStopReport({ getIdToken: async () => 'local-token' }, '2026-10-05')).resolves.toMatchObject({ weekStart: '2026-10-05' })
  expect(request.mock.calls[0][0]).toBe('/api/reports/weekly-stops')
  expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ weekStart: '2026-10-05' }), cache: 'no-store', headers: { Authorization: 'Bearer local-token' } })
})
it('keeps a retry command unchanged and surfaces server conflicts without claiming success', async () => {
  const input = { operationId: 'bc098e32-a1d6-443a-a0d4-1f8e78d2fd6c', reason: 'ส่งเอกสาร' } as StopReviewCommand
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'GPS เปลี่ยนแล้ว' }), { status: 409 }))
  vi.stubGlobal('fetch', request)
  await expect(submitStopReview({ getIdToken: async () => 'local-token' }, input)).rejects.toThrow('GPS เปลี่ยนแล้ว')
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(input)
  expect(request.mock.calls[0][0]).toBe('/api/reports/weekly-stops/review')
  expect(input.operationId).toBe('bc098e32-a1d6-443a-a0d4-1f8e78d2fd6c')
})
it('bounds token acquisition as well as fetching, so a hung token cannot leave a dialog saving forever', async () => {
  vi.useFakeTimers()
  const outcome = loadWeeklyStopReport({ getIdToken: () => new Promise(() => {}) }, '2026-10-05').then(() => 'resolved', error => error.message)
  await vi.advanceTimersByTimeAsync(45_000)
  await expect(outcome).resolves.toContain('เวลา')
})
