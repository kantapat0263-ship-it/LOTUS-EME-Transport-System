/**
 * คำขอส่งใบขอรถหลังเวลาปิดรับ (urgentRequests) — ฝั่งคนจัดรถ (การ์ดในหน้าจัดการคำขอ)
 * ผู้ใช้กำหนด 2026-11-14: เลิกให้ผู้ขอขออนุมัติพิเศษแล้ว (ฟอร์มไม่สร้างคำขอใหม่ · server ไม่รับใบพรุ่งนี้หลังเวลาปิดรับแม้อนุมัติแล้ว)
 * ที่เหลือไว้ใช้จัดการคำขอเก่าที่ค้างอยู่
 */
import { isIsoDate } from "@/lib/vehicle-compliance"

/** ค่าจากเอกสาร (ผู้ใช้เขียนเองได้) ที่จะแสดงบนหน้าจอ — รับเฉพาะข้อความ ไม่งั้น React render ไม่ได้ทั้งแท็บ */
export const displayText = (value: unknown): string => (typeof value === "string" ? value : "")

/** "YYYY-MM-DD" → "DD/MM/YYYY" · รูปแบบผิด/วันที่ไม่มีจริง = คืนข้อความเดิม (ห้าม throw — การ์ดทั้งแท็บจะล้ม) */
export function formatIsoDateTh(value: unknown): string {
  const text = displayText(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return text
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text ? `${m[3]}/${m[2]}/${m[1]}` : text
}

/** คนจัดรถกดอนุมัติ/ปฏิเสธ แต่คำขอไม่ได้รออนุมัติแล้ว (ผู้ขอเพิ่งยกเลิก / คนจัดรถอีกคนตอบไปก่อน) */
export function urgentNotPendingMessage(status: unknown): string {
  if (status === "cancelled") return "ผู้ขอยกเลิกคำขอนี้ไปแล้ว"
  if (status === "approved") return "คำขอนี้ได้รับอนุมัติไปแล้ว"
  if (status === "rejected") return "คำขอนี้ถูกปฏิเสธไปแล้ว"
  if (status === "closed") return "คำขอนี้ถูกปิดไปแล้ว"
  return "คำขอนี้ไม่ได้รออนุมัติแล้ว"
}

/**
 * คำขอที่ถึงวันขอรถแล้ว (วันนี้หรือเลยมาแล้ว) — ผู้ขอส่งใบเองไม่ได้แล้ว (ผู้ขอทั่วไปจองได้เร็วสุดพรุ่งนี้)
 * อนุมัติไปก็ไม่มีผล → การ์ดคนจัดรถเปลี่ยนเป็น แทรกงานด่วน / กรอกใบขอรถแทน / ปิดคำขอ (ผู้ใช้อนุมัติ 2026-11-07)
 * วันที่อ่านไม่ได้ = การ์ดแบบเดิม (ไม่เดาว่าเลยวัน)
 */
export function isUrgentPastDue(requestedDate: unknown, today: string): boolean {
  return isIsoDate(requestedDate) && requestedDate <= today
}

interface VrLike {
  userId?: unknown
  requestDate?: unknown
  status?: unknown
  createdAt?: { toDate?: () => Date } | null
}
interface UrgentLike {
  userId?: unknown
  requestedDate?: unknown
  createdAt?: { toMillis?: () => number } | null
}

const vrMs = (r: VrLike) => {
  const ms = typeof r.createdAt?.toDate === "function" ? r.createdAt.toDate().getTime() : NaN
  return Number.isFinite(ms) ? ms : null
}

/**
 * ใบขอรถที่ผู้ขอส่งเองวันเดียวกัน "หลัง" ส่งคำขออนุมัติ (เช่น ขออนุมัติก่อนเวลาเปิดรับ แล้วส่งใบได้ตอนเปิดรับ) — ป้ายเตือนคนจัดรถไม่ให้จัดซ้ำ
 * ใบที่มีอยู่ก่อนคำขอ = งานอื่นที่ขอเพิ่ม (ไม่นับ) · ใบเลื่อนวัน/ถูกแทน/ยกเลิก ไม่นับ · ไม่มีเวลาสร้าง = ไม่เดา
 * คนจัดรถยังต้องดูเองว่าเป็นงานเดียวกันไหม (ป้ายโชว์ปลายทางของใบ)
 */
export function requesterVrAfterUrgent<T extends VrLike>(requests: readonly T[] | null | undefined, urgent: UrgentLike): T | null {
  const urgentMs = typeof urgent.createdAt?.toMillis === "function" ? urgent.createdAt.toMillis() : NaN
  if (typeof urgent.userId !== "string" || !urgent.userId || !Number.isFinite(urgentMs)) return null
  for (const r of requests ?? []) {
    if (r.userId !== urgent.userId || r.requestDate !== urgent.requestedDate) continue
    if (r.status === "cancelled" || r.status === "rescheduled" || r.status === "superseded") continue
    const ms = vrMs(r)
    if (ms !== null && ms > urgentMs) return r
  }
  return null
}

export const URGENT_CLOSE_NOTE_LIMIT = 500

/** ช่องที่เขียนตอนคนจัดรถปิดคำขอที่ถึงวันขอแล้ว (closedAt ใส่ serverTimestamp ที่จุดเรียก) — ห้ามมีค่า undefined */
export function urgentCloseChanges(outcome: "handled" | "not_handled", note: string, closedBy: string) {
  return {
    status: "closed",
    closeOutcome: outcome,
    closeNote: note.trim().slice(0, URGENT_CLOSE_NOTE_LIMIT),
    closedBy: closedBy || "Dispatcher",
  }
}
