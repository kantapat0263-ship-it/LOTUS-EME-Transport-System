import { describe, it, expect } from 'vitest'
import { normalizeRequestTime } from './requestTime'

describe('normalizeRequestTime: เวลาในใบขอรถ → HH:MM', () => {
  it('ทวิภาค / จุด / มีหรือไม่มีเลขศูนย์นำหน้า / มี "น." ท้าย / ช่องว่าง', () => {
    expect(normalizeRequestTime('06:30')).toBe('06:30')
    expect(normalizeRequestTime('06.30')).toBe('06:30') // เคสจริง 2026-10-17 ส่งใบไม่ผ่าน
    expect(normalizeRequestTime('6.30')).toBe('06:30')
    expect(normalizeRequestTime('6:30')).toBe('06:30')
    expect(normalizeRequestTime(' 13.05 น. ')).toBe('13:05')
    expect(normalizeRequestTime('8.00น')).toBe('08:00')
    expect(normalizeRequestTime('00:00')).toBe('00:00')
    expect(normalizeRequestTime('23:59')).toBe('23:59')
  })

  it('ว่าง = ว่าง (server ยอมให้ไม่ระบุเวลา)', () => {
    expect(normalizeRequestTime('')).toBe('')
    expect(normalizeRequestTime('   ')).toBe('')
  })

  it('ไม่ใช่เวลาจริง / รูปแบบอื่น = null', () => {
    for (const bad of ['น.', 'น', ' น. ', '25:00', '24:00', '6.75', '6.3', '630', '0630', 'abc', '6:30:00', '6 โมง', '-1:00', '06,30']) {
      expect(normalizeRequestTime(bad)).toBeNull()
    }
  })
})
