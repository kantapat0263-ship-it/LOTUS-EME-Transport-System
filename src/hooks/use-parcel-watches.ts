"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { collection, onSnapshot, query, where } from "firebase/firestore"
import { useFirestore, useUser } from "@/firebase"
import type { ParcelWatch, Trip } from "@/types/models"
import { todayBangkok } from "@/lib/vehicle-compliance"
import {
  addDaysIso, matchParcelRuns, parcelAlertMessage, pendingParcelAlerts, PARCEL_LOOKAHEAD_DAYS, type ParcelRun,
} from "@/lib/parcelWatch"

export interface ParcelEntry {
  parcel: ParcelWatch
  runs: ParcelRun[]
}

/**
 * รายการฝากของของผู้ใช้ + เที่ยวรถที่จะไปไซต์นั้น — ฟัง Firestore สด (ไม่ผ่าน Vercel)
 * อ่านทริป 14 วันข้างหน้าเฉพาะตอนมีของรอรถ · error ไม่ส่งต่อให้ทั้งแอป throw เพราะเมนูซ้ายเรียกทุกหน้า
 * เมนูซ้ายกับหน้า /parcels ใช้ query เดียวกัน — SDK แชร์ listener ไม่อ่านซ้ำ
 */
export function useParcelWatches() {
  const db = useFirestore()
  const { user } = useUser()
  const uid = user?.uid ?? null
  const today = todayBangkok()
  const [parcels, setParcels] = React.useState<ParcelWatch[] | null>(null)
  const [trips, setTrips] = React.useState<Trip[] | null>(null)
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    setParcels(null)
    if (!db || !uid) return
    return onSnapshot(
      query(collection(db, "parcelWatches"), where("userId", "==", uid)),
      (snap) => {
        setParcels(snap.docs.map((d) => ({ ...(d.data() as ParcelWatch), id: d.id })))
        setError(false)
      },
      () => setError(true),
    )
  }, [db, uid])

  const hasWaiting = parcels?.some((p) => p.status === "waiting") ?? false
  React.useEffect(() => {
    setTrips(null)
    if (!db || !uid || !hasWaiting) return
    return onSnapshot(
      query(collection(db, "trips"), where("tripDate", ">=", today), where("tripDate", "<=", addDaysIso(today, PARCEL_LOOKAHEAD_DAYS))),
      (snap) => setTrips(snap.docs.map((d) => ({ ...(d.data() as Trip), id: d.id }))),
      () => setError(true),
    )
  }, [db, uid, hasWaiting, today])

  const entries = React.useMemo<ParcelEntry[] | null>(
    () => parcels && parcels.map((parcel) => ({
      parcel,
      runs: parcel.status === "waiting" && trips ? matchParcelRuns(parcel, trips, today) : [],
    })),
    [parcels, trips, today],
  )

  return {
    entries,
    today,
    error,
    loading: !error && (parcels == null || (hasWaiting && trips == null)),
    /** จำนวนรายการที่รอรถและมีรถไปแล้ว = ตัวเลขจุดแดง */
    readyCount: entries?.filter((e) => e.parcel.status === "waiting" && e.runs.length > 0).length ?? 0,
  }
}

const SEEN_LIMIT = 300
const seenStorageKey = (uid: string) => `parcelWatchAlerted:${uid}`

function readSeen(uid: string): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(seenStorageKey(uid)) || "[]")
    return new Set(Array.isArray(saved) ? saved.filter((k): k is string => typeof k === "string") : [])
  } catch {
    return new Set()
  }
}

function writeSeen(uid: string, keys: string[]) {
  try {
    localStorage.setItem(seenStorageKey(uid), JSON.stringify(keys.slice(-SEEN_LIMIT)))
  } catch {
    // พื้นที่เต็ม / โหมดส่วนตัว — แค่ popup อาจเด้งซ้ำ
  }
}

/** ขอสิทธิ์ popup — ต้องเรียกจากการกดปุ่มของผู้ใช้ (เบราว์เซอร์บล็อกถ้าเรียกเอง) */
export function requestParcelNotifyPermission() {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "default") return
  Notification.requestPermission().catch(() => {})
}

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }

/**
 * จุดแดงบนไอคอนแอป (เฉพาะติดตั้งเป็นแอป) + popup มุมจอ เด้งครั้งเดียวต่อเที่ยวต่อเครื่อง
 * เรียกที่เดียว: เมนูซ้ายฝั่งจอใหญ่ (mount ทุกหน้า แม้ซ่อนบนมือถือ) — เมนูมือถือเปิดเมื่อไหร่ก็ไม่เด้งซ้ำ
 */
export function useParcelRunAlerts(entries: ParcelEntry[] | null, today: string, readyCount: number, enabled: boolean) {
  const { user } = useUser()
  const uid = user?.uid ?? null
  const router = useRouter()
  const pathname = usePathname()

  React.useEffect(() => {
    if (!enabled) return
    const nav = navigator as BadgeNavigator
    if (readyCount > 0) nav.setAppBadge?.(readyCount).catch(() => {})
    else nav.clearAppBadge?.().catch(() => {})
    return () => { nav.clearAppBadge?.().catch(() => {}) }
  }, [enabled, readyCount])

  React.useEffect(() => {
    if (!enabled || !uid || !entries || !("Notification" in window) || Notification.permission !== "granted") return
    const seen = readSeen(uid)
    const fresh = pendingParcelAlerts(entries, seen)
    if (fresh.length === 0) return
    writeSeen(uid, [...seen, ...fresh.map((a) => a.key)])
    // เปิดหน้าฝากของอยู่แล้ว = เห็นการ์ดอยู่ ไม่ต้องเด้ง
    if (pathname === "/parcels" && document.visibilityState === "visible") return
    const { title, body } = parcelAlertMessage(fresh, today)
    const options = { body, icon: "/icons/icon-192x192.png", tag: "parcel-watch" }
    try {
      const popup = new Notification(title, options)
      popup.onclick = () => {
        window.focus()
        router.push("/parcels")
        popup.close()
      }
    } catch {
      // Android Chrome สร้าง Notification ตรงไม่ได้ ต้องผ่าน service worker
      navigator.serviceWorker?.getRegistration().then((reg) => reg?.showNotification(title, options)).catch(() => {})
    }
  }, [enabled, uid, entries, today, pathname, router])
}
