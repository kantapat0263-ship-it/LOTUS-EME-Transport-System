import { expect, it } from 'vitest'
import { parseStopReviewCommand, parseWeekStart, weekDates } from './weeklyStopValidation'
it('accepts only real Monday dates and yields exactly Monday through Sunday', () => {
  expect(parseWeekStart('2026-10-05')).toBe('2026-10-05')
  expect(weekDates('2026-10-05')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
  for (const date of ['2026-10-06', '2026-02-30', '../2026-10-05', '', '2026-10-05T00:00:00Z']) expect(() => parseWeekStart(date)).toThrow()
})
it('bounds an explanation command to its week and rejects additional fields or an empty reason', () => {
  const command = { operationId: 'bc098e32-a1d6-443a-a0d4-1f8e78d2fd6c', weekStart: '2026-10-05', dayKey: '2026-10-05__40-1000', eventId: '1791165600000-1791167400000', sourceFingerprint: 'a'.repeat(64), expectedVersion: 0, excluded: true, reason: ' ส่งเอกสาร ' }
  expect(parseStopReviewCommand(command).reason).toBe('ส่งเอกสาร')
  for (const patch of [{ weekStart: '2026-10-06' }, { dayKey: '2026-09-01__40-1000' }, { patch: { driverId: 'forged' } }, { reason: ' ' }, { expectedVersion: -1 }]) expect(() => parseStopReviewCommand({ ...command, ...patch })).toThrow()
})
