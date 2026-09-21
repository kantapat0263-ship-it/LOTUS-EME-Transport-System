/**
 * "บันทึกการส่งใบขอรถ" — ไล่ดูว่าแต่ละวันใครส่งใบเข้ามาเวลาไหนบ้าง
 *
 * ใช้ตรวจย้อนหลังเวลามีคนบอกว่า "ส่งแล้วแต่ใบไม่อยู่" และดูว่ามีช่วงไหนที่คนส่งชนกันถี่
 * เป็น logic ล้วน (ไม่มี React/Firebase) เพื่อ unit test ได้
 */

import { toMillis } from "./requestTiming"

const TH_OFFSET_MS = 7 * 60 * 60 * 1000

/**
 * รับเฉพาะ yyyy-MM-dd ที่เป็นวันจริง — ช่อง <input type="date"> ยิงค่าระหว่างพิมพ์ด้วย
 * เช่น "0002-09-21" ซึ่ง Date.UTC จะตีความเป็นปี 1902 แล้วไปดึงข้อมูลผิดศตวรรษเงียบ ๆ
 */
export function isValidDayStr(dayStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) return false
  const [y, m, d] = dayStr.split("-").map(Number)
  if (y < 2000 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** ช่วงเวลาจริงของ "วันตามปฏิทินไทย" หนึ่งวัน — ใช้เป็นขอบเขต query `createdAt` */
export function thaiDayBounds(dayStr: string): { startMs: number; endMs: number } {
  const [y, m, d] = dayStr.split("-").map(Number)
  const startMs = Date.UTC(y, m - 1, d) - TH_OFFSET_MS
  return { startMs, endMs: startMs + 86_400_000 }
}

/** "08:14:32" ตามเวลาไทย */
export function thaiClockLabel(ms: number): string {
  const d = new Date(ms + TH_OFFSET_MS)
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":")
}

/** หน้าตาของ vehicleRequests เท่าที่บันทึกการส่งต้องใช้ */
export interface SubmissionDocLike {
  id?: string
  requestId?: string
  createdAt?: unknown
  requestDate?: string | null
  requestedBy?: string | null
  userEmail?: string | null
  createdByEmail?: string | null
  status?: string | null
  destinations?: unknown[] | null
  rescheduledFromDate?: string | null
}

export interface SubmissionRow {
  requestId: string
  submittedAtMs: number
  /** "08:14:32" เวลาไทย */
  timeLabel: string
  /** ผู้ขอใช้รถ (คนที่งานเป็นของเขา) */
  requestedBy: string
  /** บัญชีที่กดส่งจริง — ต่างจากผู้ขอได้ เช่น ใบที่คนจัดรถสร้างตอนเลื่อนงาน */
  submittedByEmail: string
  requestDate: string
  status: string
  destinationCount: number
  /**
   * ใบนี้เกิดจากการเลื่อนงาน ไม่ใช่คนกรอกฟอร์มส่งเอง
   * = เคสที่ผู้ขอกับบัญชีที่กดส่งเป็นคนละคนแน่ ๆ (คนจัดรถสร้างให้)
   */
  fromReschedule: boolean
  originLabel: string
  /**
   * มีใบอื่น "ของวันใช้รถเดียวกัน" ถูกส่งห่างจากใบนี้ไม่เกิน closeWindowMs
   * จุดที่เคยเสี่ยงรหัสชนคือตรงนี้ — ชนได้เฉพาะเมื่อ requestDate ตรงกันเท่านั้น
   */
  closeCall: boolean
}

export const DEFAULT_CLOSE_WINDOW_MS = 60_000

/**
 * แปลงเอกสารใบขอเป็นแถวของบันทึกการส่ง เรียงตามเวลาส่ง (เก่า→ใหม่)
 * ใบที่ยังไม่มีเวลาส่ง (createdAt ยังไม่ลงจากเซิร์ฟเวอร์) จะถูกข้าม — บอกเวลาไม่ได้ก็ไม่ควรเดา
 */
export function buildSubmissionLog(
  docs: SubmissionDocLike[],
  opts: { closeWindowMs?: number } = {}
): SubmissionRow[] {
  const closeWindowMs = opts.closeWindowMs ?? DEFAULT_CLOSE_WINDOW_MS

  const rows: SubmissionRow[] = []
  for (const doc of docs || []) {
    const ms = toMillis(doc.createdAt)
    if (ms == null) continue
    const fromReschedule = !!doc.rescheduledFromDate
    const requestedBy = (doc.requestedBy || "").trim()
    const submittedByEmail = (doc.createdByEmail || doc.userEmail || "").trim()
    rows.push({
      requestId: doc.requestId || doc.id || "",
      submittedAtMs: ms,
      timeLabel: thaiClockLabel(ms),
      requestedBy: requestedBy || "(ไม่ระบุ)",
      submittedByEmail: submittedByEmail || "(ไม่ระบุ)",
      requestDate: doc.requestDate || "",
      status: doc.status || "",
      destinationCount: doc.destinations?.length || 0,
      fromReschedule,
      originLabel: fromReschedule ? `เลื่อนจาก ${doc.rescheduledFromDate}` : "ส่งเอง",
      closeCall: false,
    })
  }

  rows.sort((a, b) => a.submittedAtMs - b.submittedAtMs)

  // ติดธง "ส่งใกล้กัน" เฉพาะใบที่ขอใช้รถ "วันเดียวกัน" (ใบที่ไม่ระบุวันใช้รถถูกข้าม)
  // นี่คือกลุ่มที่เคยเสี่ยงรหัสชนกัน เพราะรหัสตั้งจากวัน+เดือนของวันใช้รถ
  const byRequestDate = new Map<string, SubmissionRow[]>()
  for (const r of rows) {
    if (!r.requestDate) continue
    const list = byRequestDate.get(r.requestDate)
    if (list) list.push(r)
    else byRequestDate.set(r.requestDate, [r])
  }
  for (const list of byRequestDate.values()) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].submittedAtMs - list[i - 1].submittedAtMs <= closeWindowMs) {
        list[i].closeCall = true
        list[i - 1].closeCall = true
      }
    }
  }

  return rows
}

export interface SubmissionSummary {
  total: number
  /** จำนวนใบที่ส่งใกล้กันกับใบอื่นของวันใช้รถเดียวกัน */
  closeCalls: number
  /** ใบที่เกิดจากการเลื่อนงาน (คนจัดรถสร้างให้ ไม่ใช่ผู้ขอกดเอง) */
  fromReschedule: number
  /** จำนวนใบต่อผู้ขอ เรียงมาก→น้อย */
  perRequester: { name: string; count: number }[]
}

export function summarizeSubmissions(rows: SubmissionRow[]): SubmissionSummary {
  const per = new Map<string, number>()
  for (const r of rows) per.set(r.requestedBy, (per.get(r.requestedBy) || 0) + 1)
  return {
    total: rows.length,
    closeCalls: rows.filter((r) => r.closeCall).length,
    fromReschedule: rows.filter((r) => r.fromReschedule).length,
    perRequester: [...per.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}
