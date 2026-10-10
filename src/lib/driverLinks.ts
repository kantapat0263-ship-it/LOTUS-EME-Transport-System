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
 * ดึงใหม่เมื่อชุดทริปเปลี่ยน, เมื่อกลับเข้าแท็บ (เผื่อมีคนกด "สร้างลิงก์ใหม่" จากอีกหน้า) และลองใหม่ทุก 10 วิเมื่อโหลดไม่สำเร็จ
 * ระหว่างดึงใหม่ยังใช้ลิงก์เดิมได้ · ผลที่ดึงก่อนการ replace (หลังกดสร้างใหม่) จะไม่ทับลิงก์ใหม่
 */
export function useDriverLinks(user: TokenSource | null | undefined, tripIds: string[]) {
  const key = [...new Set(tripIds.filter(Boolean))].sort().join("\n")
  const [state, setState] = React.useState<{ key: string; urls: Record<string, string>; error: string | null }>({ key: "", urls: {}, error: null })
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const generation = React.useRef(0)
  React.useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") setRefreshNonce(n => n + 1) }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [])
  React.useEffect(() => {
    if (!user || !key) return
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const startedAt = generation.current
    requestDriverLinks(user, key.split("\n"))
      .then(urls => { if (!cancelled && generation.current === startedAt) setState({ key, urls, error: null }) })
      .catch(error => {
        if (cancelled) return
        setState(prev => prev.key === key
          ? prev // ยังมีลิงก์ที่ได้ก่อนหน้า — ใช้ต่อ แล้วค่อยลองใหม่
          : { key, urls: {}, error: error instanceof Error ? error.message : "สร้างลิงก์ใบงานไม่สำเร็จ" })
        retry = setTimeout(() => setRefreshNonce(n => n + 1), 10_000)
      })
    return () => { cancelled = true; if (retry) clearTimeout(retry) }
  }, [user, key, refreshNonce])
  const ready = state.key === key
  const replace = React.useCallback((tripId: string, url: string) => {
    generation.current += 1
    setState(prev => ({ ...prev, urls: { ...prev.urls, [tripId]: url } }))
  }, [])
  return { urls: ready ? state.urls : {}, ready, error: ready ? state.error : null, replace }
}
