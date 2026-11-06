"use client"

import * as React from "react"
import { BookOpen, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

/**
 * คู่มือผู้ขอรถแบบคลิปสั้นพร้อมเสียง (ผู้ใช้กำหนด 2026-11-06: ตัวหนังสือน้อย เน้นกรณีกรอกใบให้ถูก ฉบับจอคอม)
 * ไฟล์อยู่ public/noprecache/manual — โฟลเดอร์ noprecache ไม่ถูก service worker โหลดเก็บล่วงหน้า (next.config publicExcludes)
 * preload="none" = เปิดหน้านี้โหลดแค่ภาพปก วิดีโอโหลดตอนกดเล่น · ข้อมูลในคลิปเป็นข้อมูลสมมุติจากระบบทดสอบทั้งหมด
 */
const CLIPS = [
  { file: "01-one-place", title: "ขอรถไปที่เดียว", when: "ไปส่งของ หรือไปทำงานที่เดียว — เริ่มดูคลิปนี้ก่อน", length: "0:52" },
  { file: "02-shop-to-office", title: "ซื้อของจากร้าน เข้าออฟฟิศ", when: "ไปซื้อของที่ร้าน แล้วเอากลับมาออฟฟิศ", length: "0:38" },
  { file: "03-shop-to-site", title: "รับของจากร้าน ไปส่งไซต์", when: "รับของร้านเดียวหรือหลายร้าน แล้วเอาไปส่งไซต์", length: "0:56" },
  { file: "04-site-to-site", title: "ย้ายของ จากไซต์ไปอีกไซต์", when: "ของอยู่ไซต์หนึ่ง ต้องย้ายไปอีกไซต์", length: "0:44" },
  { file: "05-multi-place", title: "ไปหลายที่ ในวันเดียวกัน", when: "วันเดียวมีหลายงาน คนละที่", length: "0:34" },
  { file: "06-parcel-watch", title: "ฝากของไปไซต์", when: "อยากฝากของไปไซต์ แต่ไม่รู้ว่ารถไปวันไหน", length: "0:51" },
] as const

const QUICK = [
  { when: "ไปที่เดียว / ซื้อของเข้าออฟฟิศ", pick: "🚚 งานปกติ" },
  { when: "รับของจากร้านหรือไซต์ แล้วไปส่งอีกที่", pick: "📦 รับของไปส่งต่อ" },
  { when: "ไปหลายที่ คนละงาน", pick: "ทำใบละที่" },
] as const

/** กดเล่นคลิปหนึ่ง → คลิปอื่นที่เล่นอยู่หยุด (ไม่ให้เสียงพากย์ซ้อนกัน) */
function pauseOthers(e: React.SyntheticEvent<HTMLVideoElement>) {
  document.querySelectorAll("video").forEach((v) => { if (v !== e.currentTarget && !v.paused) v.pause() })
}

export default function ManualPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2"><BookOpen className="h-7 w-7 text-accent" /> คู่มือผู้ขอรถ</h2>
        <p className="text-muted-foreground text-sm mt-1">คลิปสั้นพร้อมเสียง — เลือกกรณีที่ตรงกับงานแล้วกดดูได้เลย</p>
      </div>

      <Card className="border-accent/30 bg-accent/5">
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-bold">เลือกแบบไหนดี?</p>
          {QUICK.map((q) => (
            <div key={q.when} className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="text-muted-foreground">{q.when}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-bold">{q.pick}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {CLIPS.map((c, i) => (
          <Card key={c.file} className="overflow-hidden">
            <video
              controls
              preload="none"
              playsInline
              poster={`/noprecache/manual/${c.file}.jpg`}
              className="aspect-video w-full bg-black"
              onPlay={pauseOthers}
            >
              <source src={`/noprecache/manual/${c.file}.mp4`} type="video/mp4" />
            </video>
            <CardContent className="p-4 space-y-1">
              <p className="font-bold">{i + 1}. {c.title}</p>
              <p className="text-sm text-muted-foreground">ใช้เมื่อ: {c.when}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> {c.length} นาที</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
