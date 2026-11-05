/**
 * คำขอส่งใบขอรถหลังเวลาปิดรับ (urgentRequests) — ผู้ขอแนบรายละเอียดสั้น ๆ ให้คนจัดรถตัดสินใจและติดต่อกลับได้
 * ยังไม่ใช่ใบขอรถ: อนุมัติแล้วผู้ขอค่อยกรอกใบเต็ม (ผู้ใช้เลือก 2026-10-14 — ไม่ให้กรอกใบเต็มก่อนเพราะถ้าไม่อนุมัติจะเสียแรงเปล่า)
 * ความยาวสูงสุดต้องตรงกับ firestore.rules (urgentRequests)
 */
export const URGENT_DETAIL_LIMITS = { destination: 200, jobSummary: 500, contactPhone: 30 } as const

export interface UrgentDetails {
  destination: string
  jobSummary: string
  contactPhone: string
}

interface DraftDestination {
  category?: string
  siteName?: string
  customName?: string
  jobDescription?: string
}

/** เติมช่องจากสิ่งที่ผู้ขอกรอกในฟอร์มไว้แล้ว (ปลายทาง/รายละเอียดงาน) + เบอร์ในโปรไฟล์ */
export function urgentPrefill(destinations: DraftDestination[], profilePhone: unknown): UrgentDetails {
  const names = destinations
    .map(d => (d.category === "custom" ? d.customName : d.siteName)?.trim())
    .filter((name): name is string => !!name)
  const job = destinations.map(d => d.jobDescription?.trim()).find(Boolean) ?? ""
  return {
    destination: [...new Set(names)].join(", ").slice(0, URGENT_DETAIL_LIMITS.destination),
    jobSummary: job.slice(0, URGENT_DETAIL_LIMITS.jobSummary),
    contactPhone: typeof profilePhone === "string" ? profilePhone.trim().slice(0, URGENT_DETAIL_LIMITS.contactPhone) : "",
  }
}

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

/** ช่องของเอกสาร urgentRequests ที่ฟอร์มขอรถใช้ตัดสิน */
export interface UrgentRequestDoc {
  status?: unknown
  createdAt?: { toMillis?: () => number } | null
  rejectReason?: unknown
}

/** createdAt ยังว่าง = ใบที่เพิ่งเขียนในเครื่อง server ยังไม่ประทับเวลา → นับเป็นใบใหม่สุด (ใบที่บันทึกแล้วมี createdAt ทุกใบ) */
const createdMs = (r: UrgentRequestDoc) => (typeof r.createdAt?.toMillis === "function" ? r.createdAt.toMillis() : Number.POSITIVE_INFINITY)

/**
 * คำขออนุมัติใบล่าสุดของผู้ขอในวันนั้น — เรียงตาม createdAt แบบเดียวกับ server (vehicleRequestService assertViewerBookingWindow)
 * ผู้ขอยกเลิกแล้วขอใหม่ได้ (2026-11-06) วันเดียวจึงมีหลายใบ ต้องดูใบล่าสุดเสมอ ห้ามหยิบใบแรกในรายการ (ลำดับไม่แน่นอน)
 */
export function latestUrgentRequest<T extends UrgentRequestDoc>(requests: readonly T[] | null | undefined): T | null {
  let latest: T | null = null
  for (const r of requests ?? []) if (!latest || createdMs(r) > createdMs(latest)) latest = r
  return latest
}

/** สถานะที่ฟอร์มขอรถใช้ (null = ยังไม่มีคำขอ ขออนุมัติได้) · ใบล่าสุดถูกผู้ขอยกเลิก = เหมือนยังไม่มีคำขอ */
export function urgentFormStatus(requests: readonly UrgentRequestDoc[] | null | undefined): string | null {
  const status = latestUrgentRequest(requests)?.status
  return typeof status === "string" && status && status !== "cancelled" ? status : null
}

/** เหตุผลที่คนจัดรถปฏิเสธ — จากใบล่าสุดเท่านั้น และเฉพาะเมื่อใบล่าสุดถูกปฏิเสธ */
export function urgentRejectReason(requests: readonly UrgentRequestDoc[] | null | undefined): string {
  const latest = latestUrgentRequest(requests)
  return latest?.status === "rejected" ? displayText(latest.rejectReason) : ""
}

/** คนจัดรถกดอนุมัติ/ปฏิเสธ แต่คำขอไม่ได้รออนุมัติแล้ว (ผู้ขอเพิ่งยกเลิก / คนจัดรถอีกคนตอบไปก่อน) */
export function urgentNotPendingMessage(status: unknown): string {
  if (status === "cancelled") return "ผู้ขอยกเลิกคำขอนี้ไปแล้ว"
  if (status === "approved") return "คำขอนี้ได้รับอนุมัติไปแล้ว"
  if (status === "rejected") return "คำขอนี้ถูกปฏิเสธไปแล้ว"
  return "คำขอนี้ไม่ได้รออนุมัติแล้ว"
}

/** ข้อความผิดพลาดของช่องที่ยังไม่ผ่าน (ไม่มี = ส่งได้) */
export function urgentDetailsError(details: UrgentDetails): string | null {
  if (!details.destination.trim()) return "กรุณาระบุว่าจะไปที่ไหน"
  if (!details.jobSummary.trim()) return "กรุณาระบุงานหรือของที่จะขน"
  if (!details.contactPhone.trim()) return "กรุณาระบุเบอร์ติดต่อ"
  if (!/^[0-9+\-\s()]+$/.test(details.contactPhone.trim()) || !/\d/.test(details.contactPhone)) return "เบอร์ติดต่อใช้ได้เฉพาะตัวเลข เว้นวรรค + - ( )"
  for (const key of Object.keys(URGENT_DETAIL_LIMITS) as (keyof UrgentDetails)[]) {
    if (details[key].trim().length > URGENT_DETAIL_LIMITS[key]) return "ข้อความยาวเกินไป กรุณาย่อให้สั้นลง"
  }
  return null
}
