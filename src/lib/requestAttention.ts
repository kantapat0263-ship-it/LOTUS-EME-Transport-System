// คำขอใช้รถที่ยังไม่มีคนจัดรถกด "รับงาน" — ให้หน้า "จัดการคำขอ" เห็นชัด ต่อจากเลขบนเมนู "ขอรถ"
// (เลขบนเมนูนับ status === 'pending' + คำขอส่งใบหลังเวลาปิดรับที่รออนุมัติ — app-sidebar.tsx)

type ReqLike = { status?: string; createdAt?: unknown }

/** ยังไม่มีใครรับงาน (กด "รับงาน" แล้ว = in_progress) */
export function isAwaitingPickup(req: ReqLike): boolean {
  return req.status === 'pending'
}

/** เวลาส่งคำขอ (ms) จาก Firestore Timestamp — ยังไม่มี (serverTimestamp ค้างเขียน) / ผิดชนิด = null */
export function requestCreatedMs(req: ReqLike): number | null {
  const c = req.createdAt as { toDate?: () => Date } | null | undefined
  if (!c || typeof c.toDate !== 'function') return null
  const ms = c.toDate().getTime()
  return Number.isFinite(ms) ? ms : null
}

/** ใบรอรับงานขึ้นก่อน แต่ละกลุ่มใหม่สุดก่อน (ลำดับเดิมของหน้า) — array ใหม่ */
export function sortForManage<T extends ReqLike>(reqs: T[]): T[] {
  return [...reqs].sort((a, b) => {
    const pa = isAwaitingPickup(a) ? 0 : 1
    const pb = isAwaitingPickup(b) ? 0 : 1
    if (pa !== pb) return pa - pb
    return (requestCreatedMs(b) ?? 0) - (requestCreatedMs(a) ?? 0)
  })
}

/** "ส่งมา X นาทีที่แล้ว" — ไม่มีเวลาส่ง = null */
export function waitingLabel(createdMs: number | null, nowMs: number): string | null {
  if (createdMs == null) return null
  const min = Math.floor((nowMs - createdMs) / 60_000)
  if (min < 1) return 'ส่งมาเมื่อสักครู่'
  if (min < 60) return `ส่งมา ${min} นาทีที่แล้ว`
  const hr = Math.floor(min / 60)
  if (hr < 24) return min % 60 ? `ส่งมา ${hr} ชม. ${min % 60} นาทีที่แล้ว` : `ส่งมา ${hr} ชม.ที่แล้ว`
  return `ส่งมา ${Math.floor(hr / 24)} วันที่แล้ว`
}
