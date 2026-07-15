"use client"

import * as React from "react"

/**
 * Error boundary ระดับราก — แทนหน้า "Application error" default ของ Next.js
 * ถ้าเป็น chunk error (มักเกิดตอนเปิดครั้งแรกหลัง deploy เพราะ service worker/PWA
 * เสิร์ฟไฟล์ JS เก่าค้าง) จะรีโหลดหน้าเองอัตโนมัติ 1 ครั้ง (เหมือนกด F5 ให้)
 * กันลูปด้วยการเช็คว่าเพิ่งรีโหลดไปใน 10 วิ หรือยัง
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    const msg = `${error?.message ?? ""} ${(error as any)?.name ?? ""}`
    const isChunkError =
      /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported|Importing a module script failed|dynamically imported module/i.test(
        msg
      )
    if (isChunkError) {
      try {
        const k = "chunkReloadAt"
        const last = Number(sessionStorage.getItem(k) || 0)
        if (Date.now() - last > 10_000) {
          sessionStorage.setItem(k, String(Date.now()))
          window.location.reload()
        }
      } catch {
        window.location.reload()
      }
    }
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#16181f",
          color: "#e8eeec",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🔄</div>
          <p style={{ fontSize: 15, marginBottom: 20, opacity: 0.9 }}>
            เกิดข้อผิดพลาดชั่วคราว — กำลังโหลดใหม่ให้อัตโนมัติ
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#f97316",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 22px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            โหลดใหม่
          </button>
        </div>
      </body>
    </html>
  )
}
