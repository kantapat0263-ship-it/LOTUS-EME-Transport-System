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
  /** งานรับของไปส่งต่อ (RequestForm โหมด 📦) */
  transferRole?: string
  /** งานไปหลายจุดตามลำดับ (RequestForm โหมด 🔁) */
  inSequence?: boolean
}

const placeName = (d: DraftDestination) => (d.category === "custom" ? d.customName : d.siteName)?.trim() || ""
const jobText = (d: DraftDestination) => d.jobDescription?.trim() || ""

/** ปลายทาง + งาน ตามรูปใบ — คนจัดรถต้องเห็นเส้นทางจริง (เดิมตัดชื่อซ้ำ + เอางานแค่จุดแรก ใบไป-กลับดูเหมือนไปทางเดียว) */
function routeSummary(destinations: DraftDestination[]): { destination: string; jobSummary: string } {
  const isTransfer = destinations.some(d => d.transferRole === "pickup" || d.transferRole === "drop")
  // ตรงกับ RequestForm: โหมดหลายจุด = ไม่ใช่รับ-ส่ง และมีจุดติดป้ายลำดับ
  if (!isTransfer && destinations.some(d => d.inSequence)) {
    // ไปตามลำดับจริง — ชื่อซ้ำต้องคงไว้ (ไซต์ A → ที่ทำเอกสาร → ไซต์ A = ขากลับ)
    return {
      destination: destinations.map(placeName).filter(Boolean).join(" → "),
      jobSummary: destinations.map((d, i) => jobText(d) && `${i + 1}) ${jobText(d)}`).filter(Boolean).join(" · "),
    }
  }
  if (isTransfer) {
    const pickups = destinations.filter(d => d.transferRole === "pickup")
    const drop = destinations.find(d => d.transferRole === "drop")
    const pickupNames = [...new Set(pickups.map(placeName).filter(Boolean))]
    const dropName = drop ? placeName(drop) : ""
    return {
      destination: [pickupNames.length > 0 && `รับ: ${pickupNames.join(", ")}`, dropName && `ส่ง: ${dropName}`].filter(Boolean).join(" → "),
      jobSummary: [
        ...pickups.map(p => jobText(p) && `รับ ${placeName(p) || "จุดรับ"}: ${jobText(p)}`),
        drop && jobText(drop) && `ส่ง ${dropName || "จุดส่ง"}: ${jobText(drop)}`,
      ].filter(Boolean).join(" · "),
    }
  }
  return {
    destination: [...new Set(destinations.map(placeName).filter(Boolean))].join(", "),
    jobSummary: destinations.map(jobText).find(Boolean) ?? "",
  }
}

/** เติมช่องจากสิ่งที่ผู้ขอกรอกในฟอร์มไว้แล้ว (ปลายทาง/รายละเอียดงาน) + เบอร์ในโปรไฟล์ · ผู้ขอแก้เองได้ก่อนส่ง */
export function urgentPrefill(destinations: DraftDestination[], profilePhone: unknown): UrgentDetails {
  const { destination, jobSummary } = routeSummary(destinations)
  return {
    destination: destination.slice(0, URGENT_DETAIL_LIMITS.destination),
    jobSummary: jobSummary.slice(0, URGENT_DETAIL_LIMITS.jobSummary),
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

/**
 * ผู้ขอกดยกเลิก: ยกเลิกทุกใบของวันนั้นที่ยังรออนุมัติ (เช่น ส่งซ้ำจาก 2 เครื่อง) ไม่ใช่แค่ใบล่าสุด
 * ไม่งั้นใบเก่าค้างที่การ์ดคนจัดรถ และถ้าคนจัดรถอนุมัติใบเก่า server ก็ไม่ให้ส่งใบอยู่ดี (ใบล่าสุด = ยกเลิก)
 * `current` = ค่าที่อ่านซ้ำใน transaction · ไม่มีใบไหนรออนุมัติเหลือ = บอกสถานะจริงของใบล่าสุด
 */
export function planUrgentCancel<T extends UrgentRequestDoc & { id: string }>(current: readonly T[]): { cancelIds: string[]; message: string } {
  const cancelIds = current.filter(r => r.status === "pending").map(r => r.id)
  if (cancelIds.length > 0) return { cancelIds, message: "ยกเลิกคำขออนุมัติแล้ว" }
  return {
    cancelIds,
    message: latestUrgentRequest(current)?.status === "cancelled" ? "คำขอนี้ถูกยกเลิกไปแล้ว" : "คนจัดรถเพิ่งตอบคำขอนี้แล้ว",
  }
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
