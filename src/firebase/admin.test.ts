import { describe, expect, it } from 'vitest'
import { identityToolkitLookupUrl } from './admin'

describe('identityToolkitLookupUrl', () => {
  it('ไม่ตั้ง emulator → URL production ของ identitytoolkit', () => {
    expect(identityToolkitLookupUrl('k')).toBe(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=k'
    )
  })

  it('emulator host ว่าง/ไม่ได้ส่ง → ยังเป็น URL production', () => {
    expect(identityToolkitLookupUrl('k', undefined)).toBe(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=k'
    )
    expect(identityToolkitLookupUrl('k', '')).toBe(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=k'
    )
  })

  it('ตั้ง emulator host → ชี้ไป Auth emulator (http)', () => {
    expect(identityToolkitLookupUrl('k', '127.0.0.1:9099')).toBe(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:lookup?key=k'
    )
  })
})
