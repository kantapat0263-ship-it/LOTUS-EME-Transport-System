"use client"

import * as React from "react"
import { collection, query, where, orderBy, limit, getDocs, Timestamp } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, AlertTriangle, RefreshCcw, Users, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  thaiDayBounds,
  isValidDayStr,
  buildSubmissionLog,
  summarizeSubmissions,
  type SubmissionRow,
} from "@/lib/submissionLog"

/** วันนี้ตามเวลาไทย (yyyy-MM-dd) */
function thaiTodayStr(): string {
  const n = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-${String(n.getUTCDate()).padStart(2, "0")}`
}

const STATUS_LABEL: Record<string, string> = {
  pending: "รอดำเนินการ",
  in_progress: "กำลังดำเนินการ",
  partial: "จัดบางส่วน",
  approved: "จัดรถแล้ว",
  rejected: "ปฏิเสธ",
  rescheduled: "เลื่อนวันแล้ว",
  cancelled: "ยกเลิกแล้ว",
  superseded: "ถูกแทนด้วยใบใหม่",
}

/**
 * สามสถานะที่ต้อง "แยกขาดจากกัน"
 *
 * สำคัญมาก: "อ่านข้อมูลไม่ได้" ต้องไม่ถูกแสดงเป็น "วันนั้นไม่มีใครส่งใบ"
 * เพราะหน้านี้มีไว้ตัดสินข้อพิพาทว่าพนักงานส่งใบจริงหรือไม่ ถ้าเน็ตสะดุดแล้วหน้าจอ
 * บอกว่า "ไม่มีใบ" คนจัดรถจะสรุปผิดและปิดเรื่องไปเลย
 * ready ผูกวันที่ไว้ด้วย เพื่อให้ตารางบอกได้เสมอว่าข้อมูลนี้เป็นของวันไหนจริง ๆ
 */
type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; day: string; rows: SubmissionRow[]; truncated: boolean }

/** เพดานแถวต่อวัน — กันหน้าค้างถ้าวันไหนมีใบเยอะผิดปกติ และต้องบอกผู้ใช้เมื่อถูกตัด */
const ROW_LIMIT = 500

export function SubmissionLogTab() {
  const db = useFirestore()
  const [dayStr, setDayStr] = React.useState(thaiTodayStr)
  const [state, setState] = React.useState<LoadState>({ kind: "loading" })

  // กันผลลัพธ์ของวันเก่ามาทับวันใหม่ — ช่องวันที่ยิง onChange ทุกครั้งที่แก้ตัวเลข
  // จึงมีหลายคำขอวิ่งพร้อมกันได้ตามปกติ ตัวที่ตอบช้าห้ามชนะ
  const loadSeq = React.useRef(0)

  const load = React.useCallback(async (day: string) => {
    if (!db || !day) return
    const mySeq = ++loadSeq.current
    setState({ kind: "loading" }) // ล้างของวันก่อนทิ้งทันที อย่าให้ตารางเก่าค้างใต้วันที่ใหม่
    if (!isValidDayStr(day)) {
      setState({ kind: "error", message: "วันที่ไม่ถูกต้อง" })
      return
    }
    try {
      const { startMs, endMs } = thaiDayBounds(day)
      // ช่วงเดียวบนฟิลด์เดียว + เรียงด้วยฟิลด์เดิม → ไม่ต้องสร้าง composite index
      const snap = await getDocs(query(
        collection(db, "vehicleRequests"),
        where("createdAt", ">=", Timestamp.fromMillis(startMs)),
        where("createdAt", "<", Timestamp.fromMillis(endMs)),
        orderBy("createdAt", "asc"),
        limit(ROW_LIMIT),
      ))
      if (mySeq !== loadSeq.current) return // มีคำขอใหม่กว่าแล้ว ทิ้งผลนี้
      setState({
        kind: "ready",
        day,
        rows: buildSubmissionLog(snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }))),
        truncated: snap.size >= ROW_LIMIT,
      })
    } catch (e) {
      if (mySeq !== loadSeq.current) return
      console.error("[submission-log]", e)
      // แนบรหัสข้อผิดพลาดไว้ด้วย จะได้แยกออกว่าเป็นเรื่องสิทธิ์ ดัชนี หรือเน็ต โดยไม่ต้องเปิด devtools
      const code = (e as any)?.code
      setState({ kind: "error", message: code ? `อ่านข้อมูลไม่สำเร็จ (${code})` : "อ่านข้อมูลไม่สำเร็จ" })
    }
  }, [db])

  React.useEffect(() => { load(dayStr) }, [load, dayStr])

  const rows = state.kind === "ready" ? state.rows : null
  const summary = React.useMemo(() => (rows ? summarizeSubmissions(rows) : null), [rows])

  return (
    <Card className="border-accent/20 bg-card/50">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">บันทึกการส่งใบขอรถ</CardTitle>
        <CardDescription>
          ดูว่าวันนั้นมีใครส่งใบเข้ามาเวลาไหนบ้าง (ทุกสถานะ รวมใบที่จัดรถไปแล้ว) — เลือกตาม <b>วันที่ส่ง</b> ไม่ใช่วันที่ใช้รถ
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="submission-day" className="text-xs">วันที่ส่ง</Label>
            <Input
              id="submission-day"
              type="date"
              value={dayStr}
              max={thaiTodayStr()}
              onChange={(e) => setDayStr(e.target.value)}
              className="h-10 w-44"
            />
          </div>
          <Button
            variant="outline"
            className="h-10"
            onClick={() => load(dayStr)}
            disabled={state.kind === "loading"}
          >
            {state.kind === "loading"
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <RefreshCcw className="mr-2 h-4 w-4" />}
            โหลดใหม่
          </Button>
        </div>

        {summary && summary.total > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="h-7 gap-1.5 border-border/50 bg-secondary/30">
              ส่งทั้งหมด <b className="text-foreground">{summary.total}</b> ใบ
            </Badge>
            {summary.closeCalls > 0 && (
              <Badge variant="outline" className="h-7 gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-400">
                <AlertTriangle className="h-3 w-3" /> ส่งใกล้กัน {summary.closeCalls} ใบ
              </Badge>
            )}
            {summary.fromReschedule > 0 && (
              <Badge variant="outline" className="h-7 gap-1.5 border-blue-500/40 bg-blue-500/10 text-blue-400">
                เกิดจากการเลื่อนงาน {summary.fromReschedule} ใบ
              </Badge>
            )}
            {summary.perRequester.slice(0, 3).map((p) => (
              <Badge key={p.name} variant="outline" className="h-7 gap-1.5 border-border/50 bg-secondary/30">
                <Users className="h-3 w-3" /> {p.name} {p.count}
              </Badge>
            ))}
          </div>
        )}

        {state.kind === "loading" ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
        ) : state.kind === "error" ? (
          // ห้ามตกไปที่ข้อความ "ไม่มีใบขอ" เด็ดขาด — อ่านไม่ได้ ไม่เท่ากับ ไม่มี
          <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            <p className="flex items-center gap-2 font-semibold">
              <WifiOff className="h-4 w-4" /> {state.message}
            </p>
            <p className="text-xs text-red-300/80">
              <b>ยังสรุปไม่ได้ว่าวันนั้นมีใบขอหรือไม่</b> — ข้อมูลอาจมีอยู่แต่โหลดมาไม่ได้ กรุณาลองใหม่ก่อนตัดสินใจ
            </p>
            <Button size="sm" variant="outline" className="h-8" onClick={() => load(dayStr)}>
              <RefreshCcw className="mr-2 h-3 w-3" /> ลองใหม่
            </Button>
          </div>
        ) : state.rows.length > 0 ? (
          <>
            <div className="overflow-hidden rounded-lg border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">เวลาส่ง</TableHead>
                    <TableHead className="whitespace-nowrap">รหัสใบ</TableHead>
                    <TableHead className="whitespace-nowrap">ผู้ขอใช้รถ</TableHead>
                    <TableHead className="whitespace-nowrap">บัญชีที่กดส่ง</TableHead>
                    <TableHead className="whitespace-nowrap">ใช้รถวันที่</TableHead>
                    <TableHead className="whitespace-nowrap">จุด</TableHead>
                    <TableHead className="whitespace-nowrap">สถานะ</TableHead>
                    <TableHead className="whitespace-nowrap">ที่มา</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.rows.map((r) => (
                    <TableRow key={r.requestId} className={cn(r.closeCall && "bg-amber-500/10")}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {r.closeCall && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />}
                          {r.timeLabel}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{r.requestId}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.requestedBy}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.submittedByEmail}
                        {r.fromReschedule && <span className="ml-1 text-blue-400">(คนจัดรถสร้างให้)</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{r.requestDate || "-"}</TableCell>
                      <TableCell>{r.destinationCount}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{STATUS_LABEL[r.status] || r.status || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{r.originLabel}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {state.truncated && (
              <p className="text-xs text-amber-400">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                แสดงเพียง {ROW_LIMIT} แถวแรกของวันนี้ — ยังมีมากกว่านี้
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              ข้อมูลของวันที่ส่ง <b className="text-foreground">{state.day}</b>
              {summary && summary.closeCalls > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-400/90">
                    แถวสีเหลือง = มีใบอื่นของ<b>วันใช้รถเดียวกัน</b>ถูกส่งห่างกันไม่ถึง 1 นาที
                    เป็นแค่ข้อสังเกตว่าคนส่งพร้อมกัน ไม่ได้แปลว่ามีใบหาย
                  </span>
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground/80">
              บันทึกนี้แสดงเฉพาะใบที่ยังอยู่ในระบบ — ใบที่ถูกลบทิ้ง หรือถูกเขียนทับสมัยก่อนแก้เรื่องรหัสชน จะไม่เหลือร่องรอยให้เห็นเลย
            </p>
          </>
        ) : (
          <div className="py-12 text-center text-sm text-muted-foreground">
            ไม่มีใบขอที่ส่งในวันที่ <b className="text-foreground">{state.day}</b>
            <br />
            <span className="text-xs">หมายเหตุ: ใบที่ถูกลบทิ้ง หรือถูกเขียนทับสมัยก่อนแก้เรื่องรหัสชน จะไม่ปรากฏที่นี่</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
