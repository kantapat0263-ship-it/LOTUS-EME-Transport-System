"use client"

import * as React from "react"
import { useToast } from "@/hooks/use-toast"
import { RELAUNCH_EVENT, RELAUNCH_MESSAGE, type RelaunchWindow } from "@/lib/launchFocus"

/**
 * กดไอคอนแอปซ้ำ → หน้าต่างเดิมถูกดึงขึ้นมา (launch_handler: focus-existing) แล้วแจ้งว่าใช้หน้าต่างนี้ได้เลย
 * อยู่หน้าเดิมเสมอ ไม่เปลี่ยนหน้า (manifest ไม่มี shortcuts) — ดู `lib/launchFocus.ts`
 *
 * ใช้ toast เดิมของระบบ: อยู่เหนือ dialog (z-[100] > z-50) และ Radix ถือว่ากล่อง toast เป็น "branch" ของ dialog
 * → กดปิดข้อความแล้ว dialog ไม่ปิดตาม ข้อมูลที่กรอกค้างไม่หาย · role="status" · หายเองใน 5 วินาที
 */
export function RelaunchNotice() {
  const { toast } = useToast()

  React.useEffect(() => {
    const show = () => toast({ title: RELAUNCH_MESSAGE, duration: 5000 })
    const w = window as Window & RelaunchWindow
    // กดซ้ำก่อน component พร้อม (สคริปต์ inline เก็บคิวไว้) → แจ้งครั้งเดียวแล้วล้างคิว
    if (w.__lotusRelaunches?.length) {
      w.__lotusRelaunches.length = 0
      show()
    }
    const onRelaunch = () => {
      if (w.__lotusRelaunches) w.__lotusRelaunches.length = 0
      show()
    }
    window.addEventListener(RELAUNCH_EVENT, onRelaunch)
    return () => window.removeEventListener(RELAUNCH_EVENT, onRelaunch)
  }, [toast])

  return null
}
