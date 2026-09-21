import { describe, it, expect } from "vitest"
import {
  requestIdPrefix,
  formatRequestId,
  findFreeRequestId,
  createRequestWithUniqueId,
  RequestIdExhaustedError,
  REQUEST_ID_MAX_ATTEMPTS,
  type RequestIdTx,
  type RunRequestTx,
} from "./requestId"

/**
 * ธุรกรรมปลอมที่จำลองพฤติกรรมจริงของ Firestore:
 *  - อ่าน doc (แม้ยังไม่มี) = จดไว้ใน read set
 *  - ตอน commit ถ้า doc ที่จดไว้ถูกคนอื่นเปลี่ยนไป → ทิ้งงานเขียนแล้วรันฟังก์ชันใหม่ทั้งก้อน
 */
function fakeStore(initial: string[] = []) {
  const docs = new Map<string, unknown>(initial.map((id) => [id, { seeded: true }]))
  /** ให้เทสต์แทรก "คนอื่นเขียนแซง" ตอนเราอ่าน id ใดก็ได้ */
  let interceptRead: ((id: string) => void) | null = null
  let attempts = 0

  const runTx: RunRequestTx = async (fn) => {
    for (let round = 0; round < 6; round++) {
      attempts++
      const readSet = new Map<string, boolean>()
      const pending: Array<[string, unknown]> = []
      const tx: RequestIdTx = {
        async exists(id) {
          const answer = docs.has(id)
          readSet.set(id, answer)
          interceptRead?.(id)
          return answer
        },
        create(id, data) {
          pending.push([id, data])
        },
      }
      const result = await fn(tx)
      // commit: ตรวจว่าสิ่งที่อ่านไว้ยังเหมือนเดิมไหม
      const stale = [...readSet].some(([id, seen]) => docs.has(id) !== seen)
      if (stale) continue // ชน → ทำใหม่ (งานเขียนที่ค้างอยู่ถูกทิ้ง)
      pending.forEach(([id, data]) => docs.set(id, data))
      return result
    }
    throw new Error("transaction ทำใหม่เกินจำนวนครั้งที่ยอม")
  }

  return {
    docs,
    runTx,
    getAttempts: () => attempts,
    onRead: (h: (id: string) => void) => { interceptRead = h },
  }
}

const roll = (n: number) => () => n

describe("requestIdPrefix", () => {
  it("เรียงวันก่อนเดือน", () => {
    expect(requestIdPrefix("2026-09-21")).toBe("VR-2109")
    expect(requestIdPrefix("2026-01-05")).toBe("VR-0501")
  })

  it("ไม่มีปีอยู่ในรหัส", () => {
    expect(requestIdPrefix("2026-09-21")).toBe(requestIdPrefix("2027-09-21"))
  })
})

describe("formatRequestId", () => {
  it("ลำดับ 3 หลัก + สุ่ม 1 หลัก ตามรูปแบบที่ผู้ใช้เห็น", () => {
    expect(formatRequestId("VR-2109", 4, 4)).toBe("VR-2109-0044")
    expect(formatRequestId("VR-2109", 1, 0)).toBe("VR-2109-0010")
    expect(formatRequestId("VR-2109", 12, 3)).toBe("VR-2109-0123")
    expect(formatRequestId("VR-2109", 123, 9)).toBe("VR-2109-1239")
  })
})

describe("findFreeRequestId", () => {
  const probe = (taken: string[] = []) => ({ exists: async (id: string) => taken.includes(id) })

  it("คืนรหัสแรกเมื่อยังว่าง", async () => {
    await expect(findFreeRequestId(probe(), "VR-2109", 1, roll(4))).resolves.toBe("VR-2109-0014")
  })

  it("เลื่อนลำดับขึ้นเมื่อรหัสถูกใช้ไปแล้ว", async () => {
    await expect(findFreeRequestId(probe(["VR-2109-0014", "VR-2109-0024"]), "VR-2109", 1, roll(4))).resolves.toBe("VR-2109-0034")
  })

  it("ลำดับต่ำกว่า 1 ถูกดันขึ้นเป็น 1", async () => {
    await expect(findFreeRequestId(probe(), "VR-2109", 0, roll(7))).resolves.toBe("VR-2109-0017")
  })

  it("หมดโควต้าแล้วโยน error — ห้ามคืนรหัสที่มีคนใช้อยู่", async () => {
    const taken = Array.from({ length: 5 }, (_, i) => formatRequestId("VR-2109", i + 1, 4))
    await expect(findFreeRequestId(probe(taken), "VR-2109", 1, roll(4), 5)).rejects.toBeInstanceOf(RequestIdExhaustedError)
  })

  it("โควต้าเริ่มต้นคือ 50", () => {
    expect(REQUEST_ID_MAX_ATTEMPTS).toBe(50)
  })
})

describe("createRequestWithUniqueId", () => {
  it("เขียนใบลงรหัสที่จัดสรรได้ และส่ง id เข้า payload", async () => {
    const { docs, runTx } = fakeStore()
    const id = await createRequestWithUniqueId(runTx, {
      prefix: "VR-2109",
      startSeq: 1,
      rollSafety: roll(2),
      buildData: (allocated) => ({ id: allocated, requestId: allocated, requestDate: "2026-09-21" }),
    })
    expect(id).toBe("VR-2109-0012")
    expect(docs.get("VR-2109-0012")).toEqual({ id, requestId: id, requestDate: "2026-09-21" })
  })

  it("สองใบติดกันไม่ทับกัน แม้เลขสุ่มออกเหมือนกัน (เคสส่งพร้อมกัน)", async () => {
    const { docs, runTx } = fakeStore()
    const build = (who: string) => (id: string) => ({ id, requestedBy: who })
    const first = await createRequestWithUniqueId(runTx, { prefix: "VR-2109", startSeq: 1, rollSafety: roll(4), buildData: build("สมชาย") })
    // คนที่สองอ่าน count ได้เท่าเดิม (startSeq เท่ากัน) และสุ่มได้เลขเดียวกัน
    const second = await createRequestWithUniqueId(runTx, { prefix: "VR-2109", startSeq: 1, rollSafety: roll(4), buildData: build("สมหญิง") })
    expect(first).not.toBe(second)
    expect(docs.size).toBe(2)
    expect((docs.get(first) as any).requestedBy).toBe("สมชาย")
    expect((docs.get(second) as any).requestedBy).toBe("สมหญิง")
  })

  it("มีคนแทรกเขียนรหัสเดียวกันก่อนเรา commit — ต้องทำใหม่แล้วเลี่ยงไปรหัสถัดไป", async () => {
    const { docs, runTx, onRead, getAttempts } = fakeStore()
    let hijacked = false
    onRead((id) => {
      if (!hijacked && id === "VR-2109-0015") {
        hijacked = true // คนอื่นคว้ารหัสนี้ไปหลังเราอ่านว่า "ว่าง"
        docs.set(id, { requestedBy: "คนอื่นแซง" })
      }
    })
    const id = await createRequestWithUniqueId(runTx, {
      prefix: "VR-2109",
      startSeq: 1,
      rollSafety: roll(5),
      buildData: (allocated) => ({ id: allocated, requestedBy: "เจ้าของจริง" }),
    })
    expect(getAttempts()).toBe(2) // รอบแรกชน → ทำใหม่
    expect(id).toBe("VR-2109-0025")
    expect((docs.get("VR-2109-0015") as any).requestedBy).toBe("คนอื่นแซง") // ของคนแซงไม่ถูกทับ
    expect((docs.get("VR-2109-0025") as any).requestedBy).toBe("เจ้าของจริง")
    expect(docs.size).toBe(2) // ไม่มีใบไหนหาย
  })

  it("จัดสรรไม่ได้ = ไม่เขียนอะไรเลย", async () => {
    const taken = Array.from({ length: 3 }, (_, i) => formatRequestId("VR-2109", i + 1, 1))
    const { docs, runTx } = fakeStore(taken)
    await expect(
      createRequestWithUniqueId(runTx, { prefix: "VR-2109", startSeq: 1, rollSafety: roll(1), maxAttempts: 3, buildData: (id) => ({ id }) })
    ).rejects.toBeInstanceOf(RequestIdExhaustedError)
    expect(docs.size).toBe(3)
  })
})
