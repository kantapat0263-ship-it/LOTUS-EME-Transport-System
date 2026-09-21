"use client"

import * as React from "react"
import { RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

/** รหัสเวอร์ชันที่ฝังมาตอน build — ค่านี้ "แช่แข็ง" อยู่กับหน้าที่เปิดค้างไว้ */
const LOADED_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || ""

/** ถามเซิร์ฟเวอร์ทุก 5 นาที — ถี่พอให้รู้ตัวในวันเดียวกัน แต่ไม่กวนเครือข่าย */
const POLL_MS = 5 * 60 * 1000

/**
 * แถบแจ้งเตือนเมื่อมีการ deploy เวอร์ชันใหม่ขณะที่ผู้ใช้เปิดหน้าค้างไว้
 *
 * ทำไมต้องมี: แท็บที่เปิดค้างจะรันโค้ดเก่าต่อไปจนกว่าจะรีเฟรช ผู้ใช้จึงอาจยังเจอบั๊ก
 * ที่แก้ไปแล้ว (เช่น การออกรหัสใบขอรถแบบเก่าที่เขียนทับกันได้)
 *
 * ทำไมไม่บังคับรีเฟรช: คนที่กำลังกรอกใบขอรถอยู่จะเสียข้อมูลที่พิมพ์ไว้ทั้งหมด
 * จึงเป็นแถบที่ไม่บังหน้าจอ ให้ผู้ใช้เลือกจังหวะกดเอง
 */
export function VersionUpdateBanner() {
  const [hasUpdate, setHasUpdate] = React.useState(false)

  React.useEffect(() => {
    // ไม่มีรหัสฝังมา (เช่น รัน dev ที่ไม่ได้ตั้งค่า) = ตรวจไม่ได้ อย่าไปกวนผู้ใช้
    if (!LOADED_BUILD_ID) return
    let alive = true

    const check = async () => {
      if (!alive || document.visibilityState === "hidden") return
      try {
        // กัน service worker คืนของเก่า: ทั้ง query กันแคชและ no-store
        const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" })
        if (!res.ok) return
        const { buildId } = (await res.json()) as { buildId?: string }
        if (alive && buildId && buildId !== LOADED_BUILD_ID) setHasUpdate(true)
      } catch {
        // เน็ตสะดุด = ข้ามรอบนี้ไป ไม่ต้องแจ้งอะไร
      }
    }

    check()
    const timer = setInterval(check, POLL_MS)
    // กลับมาที่แท็บ = จังหวะที่คนมักเพิ่งกลับมาทำงานต่อ ตรวจให้ทันที
    const onFocus = () => check()
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)

    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [])

  if (!hasUpdate) return null

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-200 backdrop-blur print:hidden">
      <RefreshCcw className="h-4 w-4 shrink-0" />
      <span>มีระบบเวอร์ชันใหม่ — กดอัปเดตเมื่อพร้อม (งานที่กรอกค้างไว้จะหายไป ควรกดส่งให้เสร็จก่อน)</span>
      <Button
        size="sm"
        className="h-7 bg-amber-500 text-black hover:bg-amber-400"
        onClick={() => window.location.reload()}
      >
        อัปเดตเลย
      </Button>
    </div>
  )
}
