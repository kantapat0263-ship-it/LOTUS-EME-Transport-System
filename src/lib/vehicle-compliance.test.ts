import { describe, it, expect } from 'vitest'
import {
  todayBangkok,
  daysBetween,
  complianceStatus,
  alertStage,
  collectDueAlerts,
  buildAlertMessages,
  suggestTaxExpiryCandidates,
  suggestRenewedExpiry,
  formatThaiDate,
  splitForLine,
  NO_RESPONSIBLE,
} from './vehicle-compliance'

const TODAY = '2026-09-26'

describe('todayBangkok', () => {
  it('uses Thai calendar day (UTC 18:00 = next day in Bangkok)', () => {
    expect(todayBangkok(new Date('2026-09-25T18:00:00Z'))).toBe('2026-09-26')
    expect(todayBangkok(new Date('2026-09-25T16:59:00Z'))).toBe('2026-09-25')
  })
})

describe('complianceStatus', () => {
  it('no expiry = no-data (never "ok")', () => {
    expect(complianceStatus(undefined, TODAY).state).toBe('no-data')
    expect(complianceStatus({ expiry: null, confirmed: true }, TODAY).state).toBe('no-data')
    expect(complianceStatus({ expiry: '2026-13-01', confirmed: true }, TODAY).state).toBe('no-data')
  })
  it('expiry not confirmed = unconfirmed', () => {
    expect(complianceStatus({ expiry: '2026-10-01' }, TODAY)).toMatchObject({ state: 'unconfirmed', daysLeft: 5 })
  })
  it('confirmed states by days left', () => {
    const s = (expiry: string) => complianceStatus({ expiry, confirmed: true }, TODAY)
    expect(s('2026-12-31').state).toBe('ok')
    expect(s('2026-10-26')).toMatchObject({ state: 'due-soon', daysLeft: 30 })
    expect(s('2026-09-26').state).toBe('due-today')
    expect(s('2026-09-20')).toMatchObject({ state: 'overdue', daysLeft: -6 })
  })
  it('acknowledged / in-progress does not change status', () => {
    expect(complianceStatus({ expiry: '2026-09-20', confirmed: true, workStatus: 'in_progress' }, TODAY).state).toBe('overdue')
  })
})

describe('alertStage', () => {
  it('30/15/7/1/0 windows', () => {
    expect(alertStage(31)).toBeNull()
    expect(alertStage(30)).toBe('d30')
    expect(alertStage(16)).toBe('d30')
    expect(alertStage(15)).toBe('d15')
    expect(alertStage(8)).toBe('d15')
    expect(alertStage(7)).toBe('d7')
    expect(alertStage(2)).toBe('d7')
    expect(alertStage(1)).toBe('d1')
    expect(alertStage(0)).toBe('d0')
  })
  it('overdue: first day, then weekly', () => {
    expect(alertStage(-1)).toBe('o1')
    expect(alertStage(-7)).toBe('o1')
    expect(alertStage(-8)).toBe('o8')
    expect(alertStage(-15)).toBe('o15')
  })
})

describe('collectDueAlerts', () => {
  const vehicles = [
    { id: 'a', licensePlate: '1ฒษ-4407' },
    { id: 'b', licensePlate: '40-1953' },
    { id: 'c', licensePlate: 'ฮอ-5716' },
  ]
  it('only confirmed items inside a stage window', () => {
    const alerts = collectDueAlerts(
      vehicles,
      {
        a: { id: 'a', tax: { expiry: '2026-10-03', confirmed: true }, act: { expiry: '2026-10-03' }, responsibleName: 'เอ' },
        b: { id: 'b', tax: { expiry: '2027-05-01', confirmed: true } },
        // c ไม่มีข้อมูลเลย → ไม่เตือน
      },
      TODAY
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ vehicleId: 'a', kind: 'tax', stage: 'd7', daysLeft: 7, responsibleName: 'เอ' })
    expect(alerts[0].key).toBe('a_tax_2026-10-03_d7')
  })
  it('renewed (new expiry) → different key, old round no longer produced', () => {
    const before = collectDueAlerts(vehicles, { a: { id: 'a', tax: { expiry: '2026-09-20', confirmed: true } } }, TODAY)
    const after = collectDueAlerts(vehicles, { a: { id: 'a', tax: { expiry: '2027-09-20', confirmed: true } } }, TODAY)
    expect(before.map((x) => x.key)).toEqual(['a_tax_2026-09-20_o1'])
    expect(after).toEqual([])
  })
})

describe('buildAlertMessages', () => {
  it('one message per responsible person, sections by round, unassigned last', () => {
    const alerts = collectDueAlerts(
      [
        { id: 'a', licensePlate: '1ฒษ-4407' },
        { id: 'b', licensePlate: '40-1953' },
        { id: 'c', licensePlate: 'ฮอ-5716' },
      ],
      {
        a: { id: 'a', tax: { expiry: '2026-09-20', confirmed: true }, responsibleName: 'เอ' },
        b: { id: 'b', act: { expiry: '2026-10-10', confirmed: true }, responsibleName: 'เอ' },
        c: { id: 'c', tax: { expiry: '2026-09-27', confirmed: true } },
      },
      TODAY
    )
    const msgs = buildAlertMessages(alerts, TODAY)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toContain('ผู้รับผิดชอบ: เอ')
    expect(msgs[0].indexOf('เกินกำหนดแล้ว')).toBeLessThan(msgs[0].indexOf('ภายใน 15 วัน'))
    expect(msgs[0]).toContain('• 1ฒษ-4407 — ภาษี หมดอายุ 20 ก.ย. 2569 (เกินมา 6 วัน)')
    expect(msgs[1]).toContain(NO_RESPONSIBLE)
    expect(msgs[1]).toContain('ครบกำหนดพรุ่งนี้')
  })
})

describe('suggestions (never auto-advance)', () => {
  it('tax candidates from registration day-month: this year and next — staff picks', () => {
    expect(suggestTaxExpiryCandidates('2016-08-23', TODAY)).toEqual(['2026-08-23', '2027-08-23'])
    expect(suggestTaxExpiryCandidates(undefined, TODAY)).toEqual([])
  })
  it('Feb 29 registration → Feb 28 in non-leap year', () => {
    expect(suggestTaxExpiryCandidates('2016-02-29', '2027-01-01')).toEqual(['2027-02-28', '2028-02-29'])
  })
  it('renewal = previous expiry + 1 year (not payment date)', () => {
    expect(suggestRenewedExpiry('2026-08-23')).toBe('2027-08-23')
    expect(suggestRenewedExpiry(null)).toBeNull()
  })
})

describe('formatting', () => {
  it('Buddhist-era display', () => {
    expect(formatThaiDate('2016-08-23')).toBe('23 ส.ค. 2559')
    expect(daysBetween('2026-09-26', '2026-10-26')).toBe(30)
  })
})

describe('splitForLine', () => {
  it('keeps short text, splits long text on line breaks under the limit', () => {
    expect(splitForLine('a\nb', 10)).toEqual(['a\nb'])
    const parts = splitForLine(['1111', '2222', '3333'].join('\n'), 10)
    expect(parts).toEqual(['1111\n2222', '3333'])
  })
})
