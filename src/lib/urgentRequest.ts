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

/** ข้อความผิดพลาดของช่องที่ยังไม่ผ่าน (ไม่มี = ส่งได้) */
export function urgentDetailsError(details: UrgentDetails): string | null {
  if (!details.destination.trim()) return "กรุณาระบุว่าจะไปที่ไหน"
  if (!details.jobSummary.trim()) return "กรุณาระบุงานหรือของที่จะขน"
  if (!details.contactPhone.trim()) return "กรุณาระบุเบอร์ติดต่อ"
  if (!/^[0-9+\-\s()]+$/.test(details.contactPhone.trim())) return "เบอร์ติดต่อใช้ได้เฉพาะตัวเลข เว้นวรรค + - ( )"
  for (const key of Object.keys(URGENT_DETAIL_LIMITS) as (keyof UrgentDetails)[]) {
    if (details[key].trim().length > URGENT_DETAIL_LIMITS[key]) return "ข้อความยาวเกินไป กรุณาย่อให้สั้นลง"
  }
  return null
}
