"use client"

import * as React from "react"
import { thaiToday } from "@/lib/driverLeave"
import { fetchDriverLeaves } from "@/lib/driverLeaveClient"

const CODE_RE = /^\d{4,6}$/
const DEBOUNCE_MS = 500

type Lookup = { kind: "found"; name: string } | { kind: "not_found" } | { kind: "inactive" } | { kind: "error" }

/**
 * ผลตรวจรหัสพนักงานใต้ช่องในฟอร์มคนขับ (ถามชื่อจากระบบใบลาว่ารหัสนี้เป็นใคร) + เตือนรหัสซ้ำ
 *
 * - ตรวจเมื่อค่าที่ trim แล้วเป็นตัวเลข 4–6 หลักเท่านั้น · debounce 500ms · `enabled=false` (viewer) = ไม่ยิง
 * - ผลเก็บคู่กับรหัสที่ตรวจ และแสดงเมื่อรหัสนั้นยังตรงกับช่องอยู่ → ผลที่ตอบช้ามาทีหลังไม่ทับของใหม่
 *   (บวก abort คำขอเดิมทุกครั้งที่รหัสเปลี่ยน/ปิดฟอร์ม)
 * - เป็นแค่คำแนะนำ — ไม่บล็อกการบันทึก · ตรวจไม่ได้ = "ตรวจไม่ได้ตอนนี้" ไม่ใช่ "ไม่พบ"
 */
export function EmployeeCodeHint({
  value,
  enabled,
  getToken,
  duplicateOf,
}: {
  value: string
  enabled: boolean
  getToken: () => Promise<string>
  /** ชื่อคนขับคนอื่นที่ผูกรหัสเดียวกันอยู่แล้ว (ว่าง = ไม่ซ้ำ) */
  duplicateOf: string[]
}) {
  const code = (value ?? "").trim()
  const lookupable = enabled && CODE_RE.test(code)
  const [result, setResult] = React.useState<{ code: string; lookup: Lookup } | null>(null)

  React.useEffect(() => {
    if (!lookupable) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      let lookup: Lookup
      try {
        const today = thaiToday()
        const res = await fetchDriverLeaves({ codes: [code], from: today, to: today, getToken, signal: ctrl.signal })
        // ตัดสินจากตัวตนพนักงาน (ไม่ใช่สถานะลา) · ไม่มี key = ไม่ได้ตรวจ → "ตรวจไม่ได้" ห้ามอ้างว่าไม่พบ
        const emp = Object.prototype.hasOwnProperty.call(res.employees, code) ? res.employees[code] : undefined
        if (emp === undefined) lookup = { kind: "error" }
        else if (emp === null) lookup = { kind: "not_found" }
        else if (!emp.active) lookup = { kind: "inactive" }
        else lookup = { kind: "found", name: emp.name }
      } catch {
        lookup = { kind: "error" }
      }
      if (ctrl.signal.aborted) return
      setResult({ code, lookup })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [code, lookupable, getToken])

  let line: string | null = null
  if (lookupable) {
    // ยังไม่มีผลของรหัสนี้ (รอ debounce หรือกำลังยิง) = กำลังตรวจ
    const l = result?.code === code ? result.lookup : null
    if (!l) line = "⏳ กำลังตรวจ…"
    else if (l.kind === "found") line = `✓ ${l.name}`
    else if (l.kind === "not_found") line = "❔ ไม่พบรหัสนี้ในระบบใบลา"
    else if (l.kind === "inactive") line = "⛔ พ้นสภาพ"
    else line = "⚠️ ตรวจไม่ได้ตอนนี้"
  }

  if (!line && duplicateOf.length === 0) return null
  return (
    <div className="space-y-0.5 text-sm" aria-live="polite">
      {line && <p className="text-muted-foreground">{line}</p>}
      {duplicateOf.length > 0 && <p className="text-amber-500">{`⚠️ รหัสนี้ผูกกับ ${duplicateOf.join(", ")} อยู่แล้ว`}</p>}
    </div>
  )
}
