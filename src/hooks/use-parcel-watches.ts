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
  // เปิดระบบค้างข้ามเที่ยงคืน → เปลี่ยนวันเอง (setState ค่าเดิมไม่ render ใหม่)
  const [today, setToday] = React.useState(todayBangkok)
  React.useEffect(() => {
    const timer = setInterval(() => setToday(todayBangkok()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const [parcels, setParcels] = React.useState<ParcelWatch[] | null>(null)
  const [trips, setTrips] = React.useState<Trip[] | null>(null)
  // ข้อมูลชุดแรกอาจมาจากแคช (มีทริปไม่ครบ) — popup รอข้อมูลจาก server ก่อน กันชี้ผิดคัน
  const [parcelsSynced, setParcelsSynced] = React.useState(false)
  const [tripsSynced, setTripsSynced] = React.useState(false)
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    setParcels(null)
    setParcelsSynced(false)
    if (!db || !uid) return
    return onSnapshot(
      query(collection(db, "parcelWatches"), where("userId", "==", uid)),
      { includeMetadataChanges: true },
      (snap) => {
        setParcels(snap.docs.map((d) => ({ ...(d.data({ serverTimestamps: "estimate" }) as ParcelWatch), id: d.id })))
        setParcelsSynced(!snap.metadata.fromCache)
        setError(false)
      },
      () => setError(true),
    )
  }, [db, uid])

  const hasWaiting = parcels?.some((p) => p.status === "waiting") ?? false
  React.useEffect(() => {
    setTrips(null)
    setTripsSynced(false)
    if (!db || !uid || !hasWaiting) return
    return onSnapshot(
      query(collection(db, "trips"), where("tripDate", ">=", today), where("tripDate", "<=", addDaysIso(today, PARCEL_LOOKAHEAD_DAYS))),
      { includeMetadataChanges: true },
      (snap) => {
        setTrips(snap.docs.map((d) => ({ ...(d.data() as Trip), id: d.id })))
        setTripsSynced(!snap.metadata.fromCache)
      },
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
    /** ข้อมูลรายการและทริปมาจาก server แล้ว (ไม่ใช่แคชชุดแรก) */
    synced: parcelsSynced && (!hasWaiting || tripsSynced),
    /** จำนวนรายการที่รอรถและมีรถไปแล้ว = ตัวเลขจุดแดง */
    readyCount: entries?.filter((e) => e.parcel.status === "waiting" && e.runs.length > 0).length ?? 0,
  }
}

const SEEN_LIMIT = 300
const seenStorageKey = (uid: string) => `parcelWatchAlerted:${uid}`
// สำรองในหน่วยความจำ — เขียน localStorage ไม่ได้ (โหมดส่วนตัว/พื้นที่เต็ม) ก็ไม่เด้งซ้ำทุก snapshot
const memorySeen = new Map<string, Set<string>>()

function readSeen(uid: string): Set<string> {
  const seen = new Set(memorySeen.get(uid))
  try {
    const saved = JSON.parse(localStorage.getItem(seenStorageKey(uid)) || "[]")
    if (Array.isArray(saved)) for (const k of saved) if (typeof k === "string") seen.add(k)
  } catch {
    // อ่านไม่ได้ — ใช้ชุดในหน่วยความจำ
  }
  return seen
}

function writeSeen(uid: string, keys: string[]) {
  const kept = keys.slice(-SEEN_LIMIT)
  memorySeen.set(uid, new Set(kept))
  try {
    localStorage.setItem(seenStorageKey(uid), JSON.stringify(kept))
  } catch {
    // พื้นที่เต็ม / โหมดส่วนตัว — เปิดหน้าใหม่แล้ว popup อาจเด้งซ้ำ
  }
}

/** ขอสิทธิ์ popup — ต้องเรียกจากการกดปุ่มของผู้ใช้ · Safari รุ่นเก่าไม่คืน Promise จึงห่อ Promise.resolve */
export function requestParcelNotifyPermission(): Promise<NotificationPermission | undefined> {
  if (typeof window === "undefined" || !("Notification" in window)) return Promise.resolve(undefined)
  if (Notification.permission !== "default") return Promise.resolve(Notification.permission)
  try {
    return Promise.resolve(Notification.requestPermission()).catch(() => undefined)
  } catch {
    return Promise.resolve(undefined)
  }
}

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }

/**
 * จุดแดงบนไอคอนแอป (เฉพาะติดตั้งเป็นแอป) + popup มุมจอ เด้งครั้งเดียวต่อเที่ยวต่อเครื่อง
 * เรียกที่เดียว: เมนูซ้ายฝั่งจอใหญ่ (mount ทุกหน้า แม้ซ่อนบนมือถือ) — เมนูมือถือเปิดเมื่อไหร่ก็ไม่เด้งซ้ำ
 */
export function useParcelRunAlerts(watch: ReturnType<typeof useParcelWatches>, enabled: boolean) {
  const { entries, today, readyCount, synced } = watch
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
    if (!enabled || !uid || !entries || !synced || !("Notification" in window) || Notification.permission !== "granted") return
    const seen = readSeen(uid)
    const fresh = pendingParcelAlerts(entries, seen)
    if (fresh.length === 0) return
    writeSeen(uid, [...seen, ...fresh.map((a) => a.key)])
    // เปิดหน้าฝากของอยู่แล้ว = เห็นการ์ดอยู่ ไม่ต้องเด้ง
    if (pathname === "/parcels" && document.visibilityState === "visible") return
    const { title, body } = parcelAlertMessage(fresh, today)
    // tag ต่อชุด — popup ใหม่ไม่ไปแทนที่อันเก่าที่ค้างในถาดแบบเงียบ แต่แท็บอื่นที่เด้งชุดเดียวกันยังรวมเป็นอันเดียว
    // data.url ให้ worker/index.js (notificationclick) เปิดหน้าฝากของเมื่อแตะบนมือถือ
    const options = { body, icon: "/icons/icon-192x192.png", tag: `parcel-watch:${fresh.map((a) => a.key).join(",")}`, data: { url: "/parcels" } }
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
  }, [enabled, uid, entries, synced, today, pathname, router])
}
