import { describe, it, expect } from 'vitest'
import {
  todayBangkok,
  daysBetween,
  complianceStatus,
  attentionLevel,
  suggestTaxExpiryCandidates,
  nextRegistrationAnniversary,
  suggestRenewedExpiry,
  formatThaiDate,
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
})

describe('attentionLevel (in-app notice)', () => {
  const conf = (expiry: string) => ({ expiry, confirmed: true })
  it('urgent when either item is overdue or due today', () => {
    expect(attentionLevel({ id: 'a', tax: conf('2026-09-20'), act: conf('2027-01-01') }, TODAY)).toBe('urgent')
    expect(attentionLevel({ id: 'a', act: conf('2026-09-26') }, TODAY)).toBe('urgent')
  })
  it('soon within 30 days', () => {
    expect(attentionLevel({ id: 'a', tax: conf('2026-10-26') }, TODAY)).toBe('soon')
  })
  it('no notice for ok / no-data / unconfirmed (never guess)', () => {
    expect(attentionLevel({ id: 'a', tax: conf('2026-12-31') }, TODAY)).toBeNull()
    expect(attentionLevel(undefined, TODAY)).toBeNull()
    expect(attentionLevel({ id: 'a', tax: { expiry: '2026-09-20' } }, TODAY)).toBeNull()
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
  it('next registration anniversary (today counts; passed → next year)', () => {
    expect(nextRegistrationAnniversary('2016-10-28', TODAY)).toBe('2026-10-28')
    expect(nextRegistrationAnniversary('2016-05-12', TODAY)).toBe('2027-05-12')
    expect(nextRegistrationAnniversary('2016-09-26', TODAY)).toBe('2026-09-26')
    expect(nextRegistrationAnniversary('2016-02-29', '2027-01-01')).toBe('2027-02-28')
    expect(nextRegistrationAnniversary(undefined, TODAY)).toBeNull()
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
