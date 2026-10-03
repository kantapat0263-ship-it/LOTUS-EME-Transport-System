'use client'

import { cn } from '@/lib/utils'
import { leaveBadgeText, type DriverLeaveStatus } from '@/lib/driverLeave'

const RED = 'border-red-500/30 bg-red-500/10 text-red-400'
const AMBER = 'border-amber-500/30 bg-amber-500/10 text-amber-400'
const MUTED = 'border-border bg-muted/40 text-muted-foreground'

/** ป้ายสั้นหลังชื่อคนขับ — ว่าง/ไม่รู้ = ไม่แสดง (แถบรวม `LeaveCheckBanner` บอกแทน) */
export function LeaveBadge({ status }: { status: DriverLeaveStatus }) {
  const text = leaveBadgeText(status)
  if (!text) return null
  const tone =
    status.kind === 'inactive' || (status.kind === 'leave' && status.items.some((i) => i.approved))
      ? RED
      : status.kind === 'leave'
        ? AMBER
        : MUTED
  return (
    <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium leading-tight', tone)}>
      {text}
    </span>
  )
}
