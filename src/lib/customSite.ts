export interface CustomDestination {
  customName: string
  coordinates: string
  siteId: string
  siteName: string
  saveAsSite: boolean
  allowSeparateSite?: boolean
}

export interface SavedPlace {
  id: string
  name: string
  latitude?: number
  longitude?: number
  projectTypeTag?: string
}

export function matchCustomSite(name: string, coordinates: string, sites: SavedPlace[]) {
  const parts = coordinates.split(',').map(s => s.trim())
  const [latitude, longitude] = coordinates.split(',').map(Number)
  if (parts.length !== 2 || parts.some(s => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { kind: 'invalid', matches: [] as SavedPlace[] }
  }
  const key = name.trim().toLowerCase()
  const matches = sites.filter(s => s.name.trim().toLowerCase() === key ||
    (s.latitude === latitude && s.longitude === longitude))
  const exact = matches.filter(s => s.name.trim().toLowerCase() === key && s.latitude === latitude && s.longitude === longitude)
  if (exact.length === 1) return { kind: 'existing', matches: exact }
  return { kind: matches.length ? 'conflict' : 'new', matches }
}

export function editCustomDestination<T extends CustomDestination>(
  draft: T, changes: Partial<Pick<CustomDestination, 'customName' | 'coordinates'>>,
): T {
  // Editing an existing selection creates a new draft; manual opt-outs stay opted out.
  return {
    ...draft, ...changes, siteId: '', siteName: '',
    saveAsSite: draft.siteId ? true : draft.saveAsSite,
    allowSeparateSite: false,
  }
}

interface SiteDraft extends CustomDestination {
  category: string
  locationType: string
}

export class CustomSiteError extends Error {}

export function planCustomSites<T extends SiteDraft>(drafts: T[], sites: SavedPlace[], newId: () => string) {
  // No writes here: the caller commits these sites together with the request.
  // Include sites planned earlier in this request to avoid duplicate destinations.
  const known = [...sites]
  const newSites: SavedPlace[] = []
  const createdNames: string[] = []
  const reusedNames: string[] = []
  const unsavedNames: string[] = []
  const destinations = drafts.map(d => {
    if (d.category !== 'custom') return d
    if (d.siteId) {
      reusedNames.push(d.customName)
      return d
    }
    if (!d.saveAsSite || !d.coordinates.trim()) {
      unsavedNames.push(d.customName)
      return d
    }
    const match = matchCustomSite(d.customName, d.coordinates, known)
    if (match.kind === 'invalid') throw new CustomSiteError(`พิกัดของ “${d.customName}” ไม่ถูกต้อง กรุณาระบุ lat, lng ให้ครบ`)
    if (match.kind === 'conflict' && !d.allowSeparateSite) {
      throw new CustomSiteError(`“${d.customName}” มีชื่อหรือพิกัดตรงกับ ${match.matches.map(s => `“${s.name}” (${s.latitude ?? 'ไม่มีพิกัด'}, ${s.longitude ?? 'ไม่มีพิกัด'})`).join(', ')} กรุณาเลือกใช้สถานที่เดิมหรือยืนยันบันทึกแยก`)
    }
    if (match.kind === 'existing') {
      const site = match.matches[0]
      if (!newSites.some(s => s.id === site.id)) reusedNames.push(site.name)
      return { ...d, siteId: site.id }
    }
    const [latitude, longitude] = d.coordinates.split(',').map(Number)
    const site = { id: newId(), name: d.customName.trim(), latitude, longitude, projectTypeTag: d.locationType }
    known.push(site)
    newSites.push(site)
    createdNames.push(site.name)
    return { ...d, siteId: site.id, customName: site.name }
  })
  return { destinations, newSites, createdNames, reusedNames, unsavedNames }
}
