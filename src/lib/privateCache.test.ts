import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPrivateApiCache } from './privateCache'

afterEach(() => vi.unstubAllGlobals())

describe('clearPrivateApiCache (ตอนออกจากระบบ)', () => {
  it('ลบแคช "apis" และ "cross-origin" ที่ SW รุ่นเก่าเก็บคำตอบส่วนตัวไว้', async () => {
    const del = vi.fn(async () => true)
    vi.stubGlobal('caches', { delete: del })
    await clearPrivateApiCache()
    expect(del).toHaveBeenCalledWith('apis')
    expect(del).toHaveBeenCalledWith('cross-origin')
  })
  it('ไม่มี Cache Storage หรือลบไม่ได้ → ไม่ throw (ออกจากระบบต่อได้)', async () => {
    await expect(clearPrivateApiCache()).resolves.toBeUndefined()
    vi.stubGlobal('caches', { delete: async () => { throw new Error('denied') } })
    await expect(clearPrivateApiCache()).resolves.toBeUndefined()
  })
})
