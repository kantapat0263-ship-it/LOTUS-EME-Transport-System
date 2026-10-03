import { describe, it, expect } from 'vitest'
import { createLatestRequestGuard } from './latestRequest'

/** promise ที่สั่ง resolve เองได้ — ใช้กำหนดลำดับการตอบกลับของ Firestore */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

/** จำลอง fetchTrips ของหน้า daily-summary — commit ผล/ปิด loading เฉพาะคำขอล่าสุด */
function makePage() {
  const beginRequest = createLatestRequestGuard()
  const page = { trips: '', isLoading: false }
  const fetchTrips = async (response: Promise<string>) => {
    const isLatest = beginRequest()
    page.isLoading = true
    try {
      const trips = await response
      if (!isLatest()) return
      page.trips = trips
    } finally {
      if (isLatest()) page.isLoading = false
    }
  }
  return { page, fetchTrips }
}

describe('latestRequest: createLatestRequestGuard', () => {
  it('เปลี่ยนวัน 5 → 6 ต.ค. แล้วผล 5 ต.ค. ตอบกลับทีหลัง → ไม่เขียนทับผล 6 ต.ค.', async () => {
    const { page, fetchTrips } = makePage()
    const oct5 = deferred<string>()
    const oct6 = deferred<string>()

    const p5 = fetchTrips(oct5.promise)
    const p6 = fetchTrips(oct6.promise)
    oct6.resolve('ทริป 6 ต.ค.')
    await p6
    oct5.resolve('ทริป 5 ต.ค.')
    await p5

    expect(page.trips).toBe('ทริป 6 ต.ค.')
    expect(page.isLoading).toBe(false)
  })

  it('ผล 5 ต.ค. ตอบกลับก่อน → ไม่ปิด loading และไม่โชว์วันเก่าระหว่างรอ 6 ต.ค.', async () => {
    const { page, fetchTrips } = makePage()
    const oct5 = deferred<string>()
    const oct6 = deferred<string>()

    const p5 = fetchTrips(oct5.promise)
    const p6 = fetchTrips(oct6.promise)
    oct5.resolve('ทริป 5 ต.ค.')
    await p5

    expect(page.trips).toBe('')
    expect(page.isLoading).toBe(true)

    oct6.resolve('ทริป 6 ต.ค.')
    await p6
    expect(page.trips).toBe('ทริป 6 ต.ค.')
    expect(page.isLoading).toBe(false)
  })

  it('คำขอเดียว (ไม่มีคำขอใหม่แทรก) → ยังเป็นคำขอล่าสุดตลอด', () => {
    const beginRequest = createLatestRequestGuard()
    const isLatest = beginRequest()
    expect(isLatest()).toBe(true)
    expect(isLatest()).toBe(true)
  })
})
