"use client"

import * as React from "react"
import { doc } from "firebase/firestore"
import { BookOpen, Clock, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import type { UserProfile } from "@/types/models"

/**
 * คู่มือผู้ขอรถแบบคลิปสั้นพร้อมเสียง (ผู้ใช้กำหนด 2026-11-06: ตัวหนังสือน้อย เน้นกรณีกรอกใบให้ถูก ฉบับจอคอม)
 * ไฟล์อยู่ public/noprecache/manual — โฟลเดอร์ noprecache ไม่ถูก service worker โหลดเก็บล่วงหน้า (next.config publicExcludes)
 * preload="none" = เปิดหน้านี้โหลดแค่ภาพปก วิดีโอโหลดตอนกดเล่น · ข้อมูลในคลิปเป็นข้อมูลสมมุติจากระบบทดสอบทั้งหมด
 */
const CLIPS = [
  { file: "01-one-place", title: "ขอรถไปที่เดียว", when: "ไปส่งของ ไปทำงานที่เดียว หรือซื้อของเข้าออฟฟิศ — เริ่มดูคลิปนี้ก่อน", length: "1:01" },
  { file: "02-shop-to-site", title: "รับของจากร้าน ไปส่งไซต์", when: "รับของร้านเดียวหรือหลายร้าน แล้วเอาไปส่งไซต์", length: "0:56" },
  { file: "03-site-to-site", title: "ย้ายของ จากไซต์ไปอีกไซต์", when: "ของอยู่ไซต์หนึ่ง ต้องย้ายไปอีกไซต์", length: "0:44" },
  { file: "04-multi-place", title: "ไปหลายที่ ในวันเดียวกัน", when: "วันเดียวมีหลายงาน คนละที่", length: "0:34" },
  { file: "05-round-trip", title: "ไป-กลับ / หลายจุดตามลำดับ", when: "รับคนงานไปทำเอกสารแล้วส่งกลับไซต์ · ส่งของไปดัดแล้วรอรับกลับ · สลับของกับร้าน", length: "1:04" },
  { file: "06-far-site", title: "คนงานต่างจังหวัด มาทำเอกสาร", when: "คนงานนั่งรถมาถึงออฟฟิศเอง ทำเอกสารแล้วส่งขึ้นรถที่หมอชิต", length: "0:59" },
  { file: "07-notes", title: "ต้องใช้รถใหญ่ / มีคนนั่งไปด้วย", when: "ของใหญ่ต้องใช้รถ 6 ล้อ หรือมีคนนั่งรถไปด้วย", length: "0:30" },
  { file: "08-parcel-watch", title: "ฝากของไปไซต์", when: "อยากฝากของไปไซต์ แต่ไม่รู้ว่ารถไปวันไหน", length: "0:51" },
  // คลิป 09 "ขอรถหลังเวลาปิดรับ" ถอดออก (2026-11-14) — สอนกดขออนุมัติพิเศษ ซึ่งเลิกใช้แล้ว (หลังเวลาปิดรับให้แจ้งคนจัดรถ) · ไฟล์ยังอยู่ใน public
] as const

const QUICK = [
  { when: "ไปที่เดียว / ซื้อของหรือเอาของกลับเข้าออฟฟิศ", pick: "🚚 งานปกติ (ไม่ต้องใส่ออฟฟิศ)" },
  { when: "รับของจากร้านหรือไซต์ แล้วไปส่งอีกที่ (ที่ไม่ใช่ออฟฟิศ)", pick: "📦 รับของไปส่งต่อ" },
  { when: "ไป-กลับ / ไปหลายจุดต่อกันในงานเดียว", pick: "🔁 ไปหลายจุดตามลำดับ" },
  { when: "ไปหลายที่ คนละงาน", pick: "ทำใบละที่" },
  { when: "เลยเวลาปิดรับแล้ว แต่ต้องใช้รถพรุ่งนี้", pick: "📞 แจ้งคนจัดรถโดยตรง (ส่งใบเองไม่ได้)" },
] as const

/**
 * คู่มือคนจัดรถ (ผู้ใช้ OK 2026-11-10) — เห็นเฉพาะคนจัดรถ/แอดมิน · เรียงหมวดตามช่วงของวัน · ขึ้นเฉพาะคลิปที่ทำเสร็จ
 * ซ่อนแค่บนหน้าจอ ไฟล์ยังเปิดตรงได้ถ้ารู้ลิงก์ (ในคลิปเป็นข้อมูลสมมุติทั้งหมด)
 */
const DISPATCH_GROUPS = [
  { title: "1 · รับใบขอ", clips: [
    { file: "d11-intake", no: "1.1", title: "รับเรื่องใบขอ", when: "มีใบใหม่เข้ามา — ต้องกดรับทราบก่อน งานถึงจะขึ้นหน้าจัดกลุ่ม", length: "1:27" },
  ] },
  { title: "2 · จัดเที่ยววิ่ง", clips: [
    { file: "d21-trip", no: "2.1", title: "จัดเที่ยววิ่ง", when: "เลือกงาน รถ และคนขับ แล้วสร้างเที่ยว — เริ่มดูคลิปนี้ก่อน", length: "1:09" },
    { file: "d22-driver-labels", no: "2.2", title: "ป้ายคนขับ", when: "ป้ายลา / รออนุมัติ / ไม่ประจำ / มีงานแล้ว · รวมเข้าเที่ยวเดิม", length: "1:04" },
  ] },
  { title: "3 · ส่งงานให้คนขับ", clips: [
    { file: "d31-line", no: "3.1", title: "ส่งคิวเข้า LINE กลุ่ม", when: "จัดเสร็จแล้ว ส่งคิวเข้ากลุ่ม · โควตาบอทเต็มใช้คัดลอกข้อความ", length: "0:40" },
    { file: "d32-driver-link", no: "3.2", title: "ส่งลิงก์ใบงานให้คนขับ", when: "คนขับขอลิงก์หรือ QR ใบงาน · ส่งลิงก์ผิดคน", length: "0:39" },
  ] },
  { title: "4 · แผนเปลี่ยนระหว่างวัน", clips: [
    { file: "d41-insert", no: "4.1", title: "ไซต์โทรมาขอเพิ่มงานวันนี้", when: "แทรกงานด่วนเข้าเที่ยวที่วิ่งอยู่", length: "0:49" },
    { file: "d42-move", no: "4.2", title: "คันนี้ไปไม่ทัน", when: "โยกงานให้คันอื่น หรือให้คน/รถที่ยังไม่มีเที่ยว", length: "0:49" },
  ] },
  { title: "5 · ปิดวัน", clips: [
    { file: "d51-close", no: "5.1", title: "ปิดผลงานจริงตอนเย็น", when: "แตะเฉพาะจุดที่ผิดแผน · ลูกค้าขอเลื่อน · รถไม่กลับออฟฟิศ", length: "0:53" },
  ] },
] as const

const DISPATCH_QUICK = [
  { when: "มีใบขอรถใหม่ (เลขแดงที่เมนู \"ขอรถ\")", pick: "1.1 รับเรื่องใบขอ" },
  { when: "จะจัดรถให้งานที่รับเรื่องแล้ว", pick: "2.1 จัดเที่ยววิ่ง" },
  { when: "ไม่แน่ใจว่าคนขับว่างไหม / ป้ายข้างชื่อคนขับ", pick: "2.2 ป้ายคนขับ" },
  { when: "จัดเสร็จ ต้องส่งคิวเข้ากลุ่ม / โควตาบอทเต็ม", pick: "3.1 ส่งคิวเข้า LINE กลุ่ม" },
  { when: "คนขับขอลิงก์ใบงาน / ส่งลิงก์ผิดคน", pick: "3.2 ส่งลิงก์ใบงานให้คนขับ" },
  { when: "ไซต์โทรมาขอเพิ่มงานวันนี้", pick: "4.1 แทรกงานด่วน" },
  { when: "คันนี้ไปไม่ทัน / ให้คันอื่นไปแทน", pick: "4.2 โยกงาน" },
  { when: "ตอนเย็น ปิดงานของวันนี้ / ลูกค้าขอเลื่อน", pick: "5.1 ปิดผลงานจริง" },
] as const

/** กดเล่นคลิปหนึ่ง → คลิปอื่นที่เล่นอยู่หยุด (ไม่ให้เสียงพากย์ซ้อนกัน) */
function pauseOthers(e: React.SyntheticEvent<HTMLVideoElement>) {
  document.querySelectorAll("video").forEach((v) => { if (v !== e.currentTarget && !v.paused) v.pause() })
}

function QuickBox({ title, rows }: { title: string; rows: readonly { when: string; pick: string }[] }) {
  return (
    <Card className="border-accent/30 bg-accent/5">
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-bold">{title}</p>
        {rows.map((q) => (
          <div key={q.when} className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="text-muted-foreground">{q.when}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-bold">{q.pick}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function ClipCard({ file, label, when, length }: { file: string; label: string; when: string; length: string }) {
  return (
    <Card className="overflow-hidden">
      <video
        controls
        preload="none"
        playsInline
        poster={`/noprecache/manual/${file}.jpg`}
        className="aspect-video w-full bg-black"
        onPlay={pauseOthers}
      >
        <source src={`/noprecache/manual/${file}.mp4`} type="video/mp4" />
      </video>
      <CardContent className="p-4 space-y-1">
        <p className="font-bold">{label}</p>
        <p className="text-sm text-muted-foreground">ใช้เมื่อ: {when}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> {length} นาที</p>
      </CardContent>
    </Card>
  )
}

function RequesterManual() {
  return (
    <div className="space-y-6">
      <QuickBox title="เลือกแบบไหนดี?" rows={QUICK} />
      <div className="grid gap-4 md:grid-cols-2">
        {CLIPS.map((c, i) => <ClipCard key={c.file} file={c.file} label={`${i + 1}. ${c.title}`} when={c.when} length={c.length} />)}
      </div>
    </div>
  )
}

function DispatcherManual() {
  return (
    <div className="space-y-6">
      <QuickBox title="เจอเรื่องนี้ → ดูคลิปไหน" rows={DISPATCH_QUICK} />
      {DISPATCH_GROUPS.map((g) => (
        <div key={g.title} className="space-y-3">
          <p className="text-lg font-bold">{g.title}</p>
          <div className="grid gap-4 md:grid-cols-2">
            {g.clips.map((c) => <ClipCard key={c.file} file={c.file} label={`${c.no} ${c.title}`} when={c.when} length={c.length} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ManualPage() {
  const { user } = useUser()
  const db = useFirestore()
  const profileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading } = useDoc<UserProfile>(profileRef)
  const isStaff = profile?.role === "admin" || profile?.role === "dispatcher"

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2"><BookOpen className="h-7 w-7 text-accent" /> {isStaff ? "คู่มือ" : "คู่มือผู้ขอรถ"}</h2>
        <p className="text-muted-foreground text-sm mt-1">คลิปสั้นพร้อมเสียง — เลือกกรณีที่ตรงกับงานแล้วกดดูได้เลย</p>
      </div>

      {/* useDoc เริ่มที่ isLoading=false ก่อนเริ่มโหลด — ยังไม่มีโปรไฟล์ = รอ (ไม่มีโปรไฟล์จริง layout ไม่แสดงหน้านี้อยู่แล้ว) */}
      {isLoading || !user || !profile ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : isStaff ? (
        // คนจัดรถ/แอดมิน: เปิดมาเจอแท็บคนจัดรถ · แท็บผู้ขอรถไว้อธิบาย/ส่งคลิปให้ผู้ขอ
        <Tabs defaultValue="dispatcher" className="space-y-6">
          <TabsList className="bg-secondary/50 p-1">
            <TabsTrigger value="dispatcher" className="data-[state=active]:bg-accent h-10 px-6">🚚 คนจัดรถ</TabsTrigger>
            <TabsTrigger value="requester" className="data-[state=active]:bg-accent h-10 px-6">📝 ผู้ขอรถ</TabsTrigger>
          </TabsList>
          <TabsContent value="dispatcher"><DispatcherManual /></TabsContent>
          <TabsContent value="requester"><RequesterManual /></TabsContent>
        </Tabs>
      ) : (
        <RequesterManual />
      )}
    </div>
  )
}
