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

  // ลอยมุมล่าง ไม่ใช่แถบบนสุด — header ของ layout เป็น sticky top-0 อยู่แล้ว
  // ถ้าวางแถบไว้บนสุดแบบ sticky เหมือนกัน พอเลื่อนหน้าแถบจะไปทับ header จนเมนูหาย
  return (
    <div className="fixed inset-x-3 bottom-4 z-50 mx-auto max-w-md rounded-xl border border-amber-500/50 bg-amber-500/15 p-3 shadow-xl backdrop-blur print:hidden sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2">
      <div className="flex items-start gap-2.5 text-sm text-amber-200">
        <RefreshCcw className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-2">
          <p>
            <b>มีระบบเวอร์ชันใหม่</b> — กดอัปเดตเพื่อโหลดตัวล่าสุด (หรือกด F5)
            <br />
            <span className="text-xs text-amber-200/80">
              ถ้ากำลังกรอกใบขอรถอยู่ ให้กดส่งให้เสร็จก่อน ไม่งั้นข้อมูลที่กรอกจะหาย
            </span>
          </p>
          <Button
            size="sm"
            className="h-8 bg-amber-500 text-black hover:bg-amber-400"
            onClick={() => window.location.reload()}
          >
            อัปเดตเลย
          </Button>
        </div>
      </div>
    </div>
  )
}
