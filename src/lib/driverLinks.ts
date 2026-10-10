"use client"

import * as React from "react"

/** โดเมนที่ใส่ในลิงก์ใบงาน (ส่งเข้า LINE/QR) — เหมือนเดิม */
export const DRIVER_LINK_BASE = process.env.NEXT_PUBLIC_APP_URL || "https://lotus-eme-transport-system.vercel.app"

export const driverTicketUrl = (tripId: string, token: string) =>
  `${DRIVER_LINK_BASE}/driver/${encodeURIComponent(tripId)}?t=${encodeURIComponent(token)}`

type TokenSource = { getIdToken(): Promise<string> }

/**
 * ขอลิงก์ใบงาน (มี token) ของหลายทริปจาก server → { [tripId]: url }
 * rotate = "สร้างลิงก์ใหม่ (ยกเลิกลิงก์เดิม)" ทีละทริป · ทริปที่ยกเลิก/ไม่มีอยู่จะไม่มีลิงก์
 */
export async function requestDriverLinks(user: TokenSource, tripIds: string[], rotate = false): Promise<Record<string, string>> {
  if (tripIds.length === 0) return {}
  const res = await fetch("/api/driver-links", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(rotate ? { tripIds, rotate } : { tripIds }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "สร้างลิงก์ใบงานไม่สำเร็จ")
  return Object.fromEntries(Object.entries((body.links ?? {}) as Record<string, string>).map(([id, token]) => [id, driverTicketUrl(id, token)]))
}

/**
 * เตรียมลิงก์ใบงานของทริปที่แสดงอยู่ล่วงหน้า — ปุ่มคัดลอกต้องเขียน clipboard ทันทีโดยไม่มี await (Safari/iOS)
 * ดึงใหม่เมื่อชุดทริปเปลี่ยน (ไม่ใช่ทุกครั้งที่ข้อมูลทริปขยับ) · ลิงก์เดิมของแต่ละทริปไม่เปลี่ยนจนกว่าจะกดสร้างใหม่
 */
export function useDriverLinks(user: TokenSource | null | undefined, tripIds: string[]) {
  const key = [...new Set(tripIds.filter(Boolean))].sort().join("\n")
  const [state, setState] = React.useState<{ key: string; urls: Record<string, string>; error: string | null }>({ key: "", urls: {}, error: null })
  React.useEffect(() => {
    if (!user || !key) return
    let cancelled = false
    requestDriverLinks(user, key.split("\n"))
      .then(urls => { if (!cancelled) setState({ key, urls, error: null }) })
      .catch(error => { if (!cancelled) setState({ key, urls: {}, error: error instanceof Error ? error.message : "สร้างลิงก์ใบงานไม่สำเร็จ" }) })
    return () => { cancelled = true }
  }, [user, key])
  const ready = state.key === key
  const replace = React.useCallback((tripId: string, url: string) =>
    setState(prev => ({ ...prev, urls: { ...prev.urls, [tripId]: url } })), [])
  return { urls: ready ? state.urls : {}, ready, error: ready ? state.error : null, replace }
}
