import { describe, expect, it } from 'vitest'
import { editCustomDestination, matchCustomSite, planCustomSites } from './customSite'

describe('editing a custom destination', () => {
  it('keeps manually entered coordinates when correcting its name', () => {
    const draft = { customName: 'คลังเดิม', coordinates: '13.7, 100.5', siteId: '', siteName: '', saveAsSite: true }
    expect(editCustomDestination(draft, { customName: 'คลังใหม่' })).toMatchObject({
      customName: 'คลังใหม่', coordinates: '13.7, 100.5', saveAsSite: true,
    })
  })
  it('offers saving again when an existing site is changed into a new destination', () => {
    const draft = { customName: 'คลังเดิม', coordinates: '13.7, 100.5', siteId: 'old', siteName: 'คลังเดิม', saveAsSite: false }
    expect(editCustomDestination(draft, { customName: 'คลังใหม่' })).toMatchObject({
      siteId: '', siteName: '', saveAsSite: true, coordinates: '13.7, 100.5',
    })
  })
  it('preserves an explicit opt-out while editing a manually entered name', () => {
    expect(editCustomDestination({ customName: 'คลัง', coordinates: '13,100', siteId: '', siteName: '', saveAsSite: false }, { customName: 'คลังใหม่' }).saveAsSite).toBe(false)
  })
  it('detaches a selected site when its coordinates are changed and resets conflict consent', () => {
    expect(editCustomDestination({ customName: 'คลัง', coordinates: '13,100', siteId: 'old', siteName: 'คลัง', saveAsSite: false, allowSeparateSite: true }, { coordinates: '14,101' }))
      .toMatchObject({ coordinates: '14,101', siteId: '', saveAsSite: true, allowSeparateSite: false })
  })
})

describe('planning reusable sites for a request', () => {
  const draft = { category: 'custom', customName: 'คลังใหม่', coordinates: '13,100', siteId: '', siteName: '', saveAsSite: true, locationType: 'ไซต์งาน' }
  it('assigns a saved site id to both repeated destinations without creating two sites', () => {
    const plan = planCustomSites([draft, { ...draft }], [], () => 'new-id')
    expect(plan.newSites).toHaveLength(1)
    expect(plan.destinations.map(d => d.siteId)).toEqual(['new-id', 'new-id'])
    expect(plan.createdNames).toEqual(['คลังใหม่'])
  })
  it('does not silently skip or merge conflicting names before the user decides', () => {
    const sites = [{ id: 'old', name: draft.customName, latitude: 14, longitude: 101 }]
    expect(() => planCustomSites([draft], sites, () => 'new-id')).toThrow('ชื่อหรือพิกัดตรงกับ')
    expect(planCustomSites([{ ...draft, allowSeparateSite: true }], sites, () => 'new-id').newSites).toHaveLength(1)
  })
  it('never saves malformed coordinates as a reusable site', () => {
    expect(() => planCustomSites([{ ...draft, coordinates: '13,' }], [], () => 'new-id')).toThrow('พิกัด')
  })
  it('reports an explicitly chosen existing site as reused', () => {
    const plan = planCustomSites([{ ...draft, siteId: 'old', saveAsSite: false }], [], () => 'unused')
    expect(plan.reusedNames).toEqual(['คลังใหม่'])
    expect(plan.newSites).toEqual([])
  })
  it('keeps optional missing coordinates and opted-out places only in the request', () => {
    const plan = planCustomSites([{ ...draft, coordinates: '' }, { ...draft, saveAsSite: false }], [], () => { throw Error('must not allocate') })
    expect(plan.newSites).toEqual([])
    expect(plan.unsavedNames).toEqual(['คลังใหม่', 'คลังใหม่'])
    expect(plan.destinations.every(d => !d.siteId)).toBe(true)
  })
  it('links an exact match without creating or overwriting a saved site', () => {
    const sites = [{ id: 'old', name: draft.customName, latitude: 13, longitude: 100 }]
    const plan = planCustomSites([draft], sites, () => { throw Error('must not allocate') })
    expect(plan.newSites).toEqual([])
    expect(plan.reusedNames).toEqual(['คลังใหม่'])
    expect(plan.destinations[0].siteId).toBe('old')
    expect(sites).toEqual([{ id: 'old', name: draft.customName, latitude: 13, longitude: 100 }])
  })
})

describe('matching saved places', () => {
  it('reuses only a unique match with both name and coordinates equal', () => {
    expect(matchCustomSite(' คลัง ', '13, 100', [{ id: 'old', name: 'คลัง', latitude: 13, longitude: 100 }]))
      .toMatchObject({ kind: 'existing', matches: [{ id: 'old' }] })
  })
  it('requires a decision for a same-name place at a different location', () => {
    const result = matchCustomSite('คลัง', '13,100', [{ id: 'old', name: 'คลัง', latitude: 14, longitude: 101 }])
    expect(result).toMatchObject({ kind: 'conflict', matches: [{ id: 'old' }] })
  })
  it.each(['', '13,', ',100', '13junk,100', '91,100', '13,181', '13,100,2'])('rejects unusable coordinates: %s', coordinates => {
    expect(matchCustomSite('คลัง', coordinates, []).kind).toBe('invalid')
  })
  it('does not equate different names merely because the coordinates match', () => {
    expect(matchCustomSite('ใหม่', '13,100', [{ id: 'old', name: 'เดิม', latitude: 13, longitude: 100 }]).kind).toBe('conflict')
  })
  it('does not arbitrarily choose one of several exact duplicates', () => {
    expect(matchCustomSite('คลัง', '13,100', [
      { id: 'a', name: 'คลัง', latitude: 13, longitude: 100 },
      { id: 'b', name: 'คลัง', latitude: 13, longitude: 100 },
    ]).kind).toBe('conflict')
  })
  it('accepts zero and coordinate boundaries', () => {
    expect(matchCustomSite('คลัง', '0,0', []).kind).toBe('new')
    expect(matchCustomSite('คลัง', '-90,180', []).kind).toBe('new')
  })
})
