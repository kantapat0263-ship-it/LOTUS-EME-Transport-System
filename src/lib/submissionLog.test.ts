import { describe, it, expect } from "vitest"
import {
  thaiDayBounds,
  isValidDayStr,
  thaiClockLabel,
  buildSubmissionLog,
  summarizeSubmissions,
  DEFAULT_CLOSE_WINDOW_MS,
  type SubmissionDocLike,
} from "./submissionLog"

/** 2026-09-21 08:14:32 เวลาไทย → unix ms */
const th = (h: number, m: number, s = 0, day = 21) =>
  Date.UTC(2026, 8, day, h - 7, m, s)

const doc = (over: Partial<SubmissionDocLike> = {}): SubmissionDocLike => ({
  requestId: "VR-2209-0014",
  createdAt: th(8, 0),
  requestDate: "2026-09-22",
  requestedBy: "สมชาย",
  userEmail: "somchai@example.com",
  status: "pending",
  destinations: [{}, {}],
  ...over,
})

describe("thaiDayBounds", () => {
  it("ครอบคลุมหนึ่งวันไทยเต็ม (เริ่ม 17:00 UTC ของวันก่อนหน้า)", () => {
    const { startMs, endMs } = thaiDayBounds("2026-09-21")
    expect(new Date(startMs).toISOString()).toBe("2026-09-20T17:00:00.000Z")
    expect(endMs - startMs).toBe(86_400_000)
  })

  it("ข้ามสิ้นเดือน/สิ้นปีได้", () => {
    expect(new Date(thaiDayBounds("2026-01-01").startMs).toISOString()).toBe("2025-12-31T17:00:00.000Z")
    expect(new Date(thaiDayBounds("2026-03-01").startMs).toISOString()).toBe("2026-02-28T17:00:00.000Z")
  })

  it("เวลาไทยตี 1 ตกอยู่ในวันไทยวันนั้น ไม่ใช่วันก่อนหน้า", () => {
    const { startMs, endMs } = thaiDayBounds("2026-09-21")
    const oneAm = th(1, 0)
    expect(oneAm).toBeGreaterThanOrEqual(startMs)
    expect(oneAm).toBeLessThan(endMs)
  })
})

describe("isValidDayStr", () => {
  it("รับเฉพาะ yyyy-MM-dd ที่เป็นวันจริง", () => {
    expect(isValidDayStr("2026-09-21")).toBe(true)
    expect(isValidDayStr("2026-02-29")).toBe(false) // 2026 ไม่ใช่ปีอธิกสุรทิน
    expect(isValidDayStr("2024-02-29")).toBe(true)
  })

  it("ปฏิเสธค่าระหว่างพิมพ์จากช่อง date ที่จะไปดึงข้อมูลผิดศตวรรษ", () => {
    // Date.UTC ตีความปี 2 หลักเป็น 1900+y — ถ้าปล่อยผ่านจะ query ปี 1902 เงียบ ๆ
    expect(isValidDayStr("0002-09-21")).toBe(false)
    expect(isValidDayStr("0202-09-21")).toBe(false)
  })

  it("ปฏิเสธรูปแบบที่ผิด", () => {
    expect(isValidDayStr("")).toBe(false)
    expect(isValidDayStr("2026-9-21")).toBe(false)
    expect(isValidDayStr("2026-13-01")).toBe(false)
    expect(isValidDayStr("2026-09-31")).toBe(false)
  })
})

describe("thaiClockLabel", () => {
  it("แสดงเวลาไทยพร้อมวินาที", () => {
    expect(thaiClockLabel(th(8, 14, 32))).toBe("08:14:32")
    expect(thaiClockLabel(th(0, 5, 9))).toBe("00:05:09")
  })
})

describe("buildSubmissionLog", () => {
  it("เรียงตามเวลาส่งจากเก่าไปใหม่", () => {
    const rows = buildSubmissionLog([
      doc({ requestId: "B", createdAt: th(9, 0) }),
      doc({ requestId: "A", createdAt: th(8, 0) }),
    ])
    expect(rows.map((r) => r.requestId)).toEqual(["A", "B"])
  })

  it("ข้ามใบที่ยังไม่มีเวลาส่ง — บอกเวลาไม่ได้ก็ไม่เดา", () => {
    const rows = buildSubmissionLog([doc({ createdAt: null }), doc({ requestId: "OK" })])
    expect(rows.map((r) => r.requestId)).toEqual(["OK"])
  })

  it("รองรับ createdAt หลายรูปแบบ (Firestore Timestamp / ISO)", () => {
    const rows = buildSubmissionLog([
      doc({ requestId: "TS", createdAt: { toMillis: () => th(7, 0) } }),
      doc({ requestId: "ISO", createdAt: new Date(th(7, 30)).toISOString() }),
    ])
    expect(rows.map((r) => r.requestId)).toEqual(["TS", "ISO"])
  })

  it("ใบที่เกิดจากการเลื่อนงาน = คนอื่นส่งแทน และบอกที่มาได้", () => {
    const [row] = buildSubmissionLog([
      doc({ rescheduledFromDate: "2026-09-20", createdByEmail: "dispatcher@example.com", status: "rescheduled" }),
    ])
    expect(row.fromReschedule).toBe(true)
    expect(row.fromReschedule).toBe(true)
    expect(row.originLabel).toBe("เลื่อนจาก 2026-09-20")
    // ต้องโชว์บัญชีที่กดส่งจริง ไม่ใช่กลบด้วยชื่อผู้ขอ
    expect(row.submittedByEmail).toBe("dispatcher@example.com")
    expect(row.requestedBy).toBe("สมชาย")
  })

  it("ใบที่ส่งเองปกติ: ไม่ติดธงเลื่อนงาน และโชว์บัญชีผู้ส่งจาก userEmail", () => {
    const [row] = buildSubmissionLog([doc()])
    expect(row.fromReschedule).toBe(false)
    expect(row.originLabel).toBe("ส่งเอง")
    // เส้นทางปกติไม่มี createdByEmail — ต้องตกมาใช้ userEmail ไม่ใช่ "(ไม่ระบุ)"
    expect(row.submittedByEmail).toBe("somchai@example.com")
  })

  it("ไม่มีอีเมลเลย → บอกว่าไม่ระบุ ไม่ใช่ช่องว่าง", () => {
    const [row] = buildSubmissionLog([doc({ userEmail: "", createdByEmail: null })])
    expect(row.submittedByEmail).toBe("(ไม่ระบุ)")
  })

  describe("ธง 'ส่งใกล้กัน'", () => {
    it("ติดธงทั้งคู่เมื่อส่งห่างกันไม่เกิน 1 นาที ในวันใช้รถเดียวกัน", () => {
      const rows = buildSubmissionLog([
        doc({ requestId: "A", createdAt: th(8, 0, 0) }),
        doc({ requestId: "B", createdAt: th(8, 0, 30) }),
      ])
      expect(rows.every((r) => r.closeCall)).toBe(true)
    })

    it("ไม่ติดธงเมื่อห่างเกิน 1 นาที", () => {
      const rows = buildSubmissionLog([
        doc({ requestId: "A", createdAt: th(8, 0, 0) }),
        doc({ requestId: "B", createdAt: th(8, 2, 0) }),
      ])
      expect(rows.every((r) => !r.closeCall)).toBe(true)
    })

    it("คนละวันใช้รถไม่ติดธง แม้ส่งพร้อมกัน — รหัสชนกันไม่ได้อยู่แล้ว", () => {
      const rows = buildSubmissionLog([
        doc({ requestId: "A", createdAt: th(8, 0, 0), requestDate: "2026-09-22" }),
        doc({ requestId: "B", createdAt: th(8, 0, 5), requestDate: "2026-09-23" }),
      ])
      expect(rows.every((r) => !r.closeCall)).toBe(true)
    })

    it("สามใบติดกันในหน้าต่างเดียวกัน ติดธงทั้งสาม", () => {
      const rows = buildSubmissionLog([
        doc({ requestId: "A", createdAt: th(8, 0, 0) }),
        doc({ requestId: "B", createdAt: th(8, 0, 40) }),
        doc({ requestId: "C", createdAt: th(8, 1, 20) }),
      ])
      expect(rows.every((r) => r.closeCall)).toBe(true)
    })

    it("ใบกลางห่างจากทั้งสองข้างเกินหน้าต่าง = ไม่ติดธงสักใบ", () => {
      const rows = buildSubmissionLog([
        doc({ requestId: "A", createdAt: th(8, 0, 0) }),
        doc({ requestId: "B", createdAt: th(8, 5, 0) }),
        doc({ requestId: "C", createdAt: th(8, 10, 0) }),
      ])
      expect(rows.every((r) => !r.closeCall)).toBe(true)
    })

    it("ใบที่ไม่มีวันใช้รถ ไม่ถูกจับกลุ่มกับใคร", () => {
      const rows = buildSubmissionLog([
        doc({ requestId: "A", createdAt: th(8, 0, 0), requestDate: "" }),
        doc({ requestId: "B", createdAt: th(8, 0, 5), requestDate: "" }),
      ])
      expect(rows.every((r) => !r.closeCall)).toBe(true)
    })

    it("ปรับหน้าต่างเวลาได้", () => {
      const docs = [
        doc({ requestId: "A", createdAt: th(8, 0, 0) }),
        doc({ requestId: "B", createdAt: th(8, 2, 0) }),
      ]
      expect(buildSubmissionLog(docs, { closeWindowMs: 5 * 60_000 }).every((r) => r.closeCall)).toBe(true)
    })

    it("ค่าเริ่มต้นคือ 1 นาที", () => {
      expect(DEFAULT_CLOSE_WINDOW_MS).toBe(60_000)
    })
  })
})

describe("summarizeSubmissions", () => {
  it("นับรวม ใบที่ส่งใกล้กัน ใบที่เกิดจากการเลื่อนงาน และจำนวนใบต่อผู้ขอ", () => {
    const rows = buildSubmissionLog([
      doc({ requestId: "A", createdAt: th(8, 0, 0), requestedBy: "สมชาย" }),
      doc({ requestId: "B", createdAt: th(8, 0, 20), requestedBy: "สมหญิง" }),
      doc({ requestId: "C", createdAt: th(10, 0, 0), requestedBy: "สมชาย", rescheduledFromDate: "2026-09-20" }),
    ])
    const s = summarizeSubmissions(rows)
    expect(s.total).toBe(3)
    expect(s.closeCalls).toBe(2)
    expect(s.fromReschedule).toBe(1)
    expect(s.perRequester).toEqual([
      { name: "สมชาย", count: 2 },
      { name: "สมหญิง", count: 1 },
    ])
  })

  it("ใบที่ไม่ระบุชื่อผู้ขอ ถูกจัดกลุ่มรวมกันโดยไม่พัง", () => {
    const rows = buildSubmissionLog([
      doc({ requestId: "A", createdAt: th(8, 0), requestedBy: "" }),
      doc({ requestId: "B", createdAt: th(9, 0), requestedBy: null }),
    ])
    expect(rows.every((r) => r.requestedBy === "(ไม่ระบุ)")).toBe(true)
    expect(summarizeSubmissions(rows).perRequester).toEqual([{ name: "(ไม่ระบุ)", count: 2 }])
  })

  it("ไม่มีใบเลยก็ไม่พัง", () => {
    expect(summarizeSubmissions([])).toEqual({ total: 0, closeCalls: 0, fromReschedule: 0, perRequester: [] })
  })
})
