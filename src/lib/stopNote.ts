/**
 * หมายเหตุคนจัดรถรายจุด (✏️ ในใบสรุป / ใบงานคนขับ)
 *
 * ที่เก็บหลัก = บนตัว stop ของทริป (`dispatcherNote` / `dispatcherName`) — ไม่ผูกกับลำดับจุด
 * `trip.stopNotes[stop_N]` เป็นที่เก็บรุ่นเก่า (หน้าคำขอเคย mirror มาด้วยลำดับจุดในใบขอ ซึ่งไม่ตรงกับลำดับในทริป
 * เมื่อทริปรวมหลายใบ) — ตอนแก้หมายเหตุจุดไหน ให้ลบ key รุ่นเก่าของจุดนั้นทิ้ง เพื่อให้ค่าบน stop แสดงแทน
 */

/** key ของ trip.stopNotes / trip.stopNoteAuthors สำหรับจุดลำดับที่ sIdx ในทริป */
export function stopNoteKey(sIdx: number): string {
  return `stop_${sIdx}`
}

/** stops ชุดใหม่ที่แก้หมายเหตุจุด sIdx — ข้อความว่าง = ลบหมายเหตุ+ชื่อทิ้ง · ไม่แก้ array เดิม */
export function editStopNote<T extends object>(stops: T[], sIdx: number, text: string, author: string): T[] {
  if (!Number.isInteger(sIdx) || sIdx < 0 || sIdx >= stops.length) throw new RangeError(`stop index out of range: ${sIdx}`)
  const note = text.trim()
  return stops.map((s, i) => {
    if (i !== sIdx) return s
    const { dispatcherNote: _n, dispatcherName: _a, ...rest } = s as T & { dispatcherNote?: string; dispatcherName?: string }
    return (note ? { ...rest, dispatcherNote: note, dispatcherName: author } : rest) as T
  })
}
