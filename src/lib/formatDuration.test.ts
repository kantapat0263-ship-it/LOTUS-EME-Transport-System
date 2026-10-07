import { describe, expect, it } from 'vitest'
import { formatDurationMinutes } from './formatDuration'

describe('display durations rounded to whole minutes', () => {
  it.each([
    [0, '0 นาที'],
    [12.4, '12 นาที'],
    [12.6, '13 นาที'],
    [59.49, '59 นาที'],
    [59.5, '1 ชม.'],
    [60, '1 ชม.'],
    [60.6, '1 ชม. 1 นาที'],
    [119.6, '2 ชม.'],
    [229.36666666666667, '3 ชม. 49 นาที'],
  ])('formats %s minutes as %s', (minutes, text) => {
    expect(formatDurationMinutes(minutes as number)).toBe(text)
  })

  it('rounds the precise total once rather than adding separately rounded stops', () => {
    expect(formatDurationMinutes(24.4 + 24.4)).toBe('49 นาที')
  })

  it.each([
    [12.4, '12′'],
    [59.5, '1ชม.'],
    [229.36666666666667, '3ชม.49′'],
  ])('keeps %s-minute map labels compact', (minutes, text) => {
    expect(formatDurationMinutes(minutes as number, 'compact')).toBe(text)
  })
})
