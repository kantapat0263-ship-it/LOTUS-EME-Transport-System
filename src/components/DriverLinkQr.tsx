"use client"

import * as React from "react"
import QRCode from "qrcode"

/**
 * QR ของลิงก์ใบงาน สร้างในเครื่อง — เดิมส่งลิงก์ (ซึ่งตอนนี้มี token) ไปให้ api.qrserver.com วาดให้
 * ลิงก์ที่มี token ห้ามส่งออกไปบริการภายนอก
 */
export function DriverLinkQr({ url, className }: { url: string; className?: string }) {
  const [src, setSrc] = React.useState("")
  React.useEffect(() => {
    let cancelled = false
    setSrc("")
    if (url) QRCode.toDataURL(url, { width: 200, margin: 1 }).then(data => { if (!cancelled) setSrc(data) }).catch(() => {})
    return () => { cancelled = true }
  }, [url])
  if (!src) return <div className={className} />
  return <img src={src} alt="Trip QR Code" className={className} />
}
