"use client"

import * as React from "react"
import { collection, query, where, orderBy, getDocs, Timestamp } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, AlertTriangle, RefreshCcw, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  thaiDayBounds,
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
 * บันทึกการส่งใบขอรถรายวัน (เฉพาะคนจัดรถ/แอดมิน)
 *
 * ตั้งใจให้ตอบคำถาม "ใบที่พนักงานบอกว่าส่งแล้ว อยู่ตรงไหน" และ "วันไหนคนส่งชนกันถี่"
 * จึงดึง ทุกสถานะ ตามช่วงเวลาที่ส่ง — ต่างจากลิสต์ในแท็บจัดการคำขอที่กรองบางสถานะทิ้ง
 * (ใบที่จัดรถไปแล้วหรือถูกแทนที่จะหายจากลิสต์นั้น แต่ต้องอยู่ในบันทึกนี้)
 */
export function SubmissionLogTab() {
  const db = useFirestore()
  const [dayStr, setDayStr] = React.useState(thaiTodayStr)
  const [rows, setRows] = React.useState<SubmissionRow[] | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState("")

  // กันผลลัพธ์ของวันเก่ามาทับวันใหม่ ถ้าผู้ใช้กดเปลี่ยนวันรัว ๆ (คำขอเก่าอาจตอบกลับทีหลัง)
  const loadSeq = React.useRef(0)

  const load = React.useCallback(async (day: string) => {
    if (!db || !day) return
    const mySeq = ++loadSeq.current
    setIsLoading(true)
    setError("")
    try {
      const { startMs, endMs } = thaiDayBounds(day)
      // ช่วงเดียวบนฟิลด์เดียว + เรียงด้วยฟิลด์เดิม → ไม่ต้องสร้าง composite index
      const snap = await getDocs(query(
        collection(db, "vehicleRequests"),
        where("createdAt", ">=", Timestamp.fromMillis(startMs)),
        where("createdAt", "<", Timestamp.fromMillis(endMs)),
        orderBy("createdAt", "asc"),
      ))
      if (mySeq !== loadSeq.current) return // มีคำขอใหม่กว่าแล้ว ทิ้งผลนี้ไป
      setRows(buildSubmissionLog(snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }))))
    } catch (e) {
      if (mySeq !== loadSeq.current) return
      console.error("[submission-log]", e)
      setError("โหลดบันทึกไม่สำเร็จ กรุณาลองใหม่")
      setRows(null)
    } finally {
      if (mySeq === loadSeq.current) setIsLoading(false)
    }
  }, [db])

  React.useEffect(() => { load(dayStr) }, [load, dayStr])

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
          <Button variant="outline" className="h-10" onClick={() => load(dayStr)} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
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
            {summary.byProxy > 0 && (
              <Badge variant="outline" className="h-7 gap-1.5 border-blue-500/40 bg-blue-500/10 text-blue-400">
                เกิดจากการเลื่อนงาน {summary.byProxy} ใบ
              </Badge>
            )}
            {summary.perRequester.slice(0, 3).map((p) => (
              <Badge key={p.name} variant="outline" className="h-7 gap-1.5 border-border/50 bg-secondary/30">
                <Users className="h-3 w-3" /> {p.name} {p.count}
              </Badge>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
        )}

        {isLoading && !rows ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
        ) : rows && rows.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-lg border border-border/50">
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
                  {rows.map((r) => (
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
                        {r.byProxy && <span className="ml-1 text-blue-400">(ส่งแทน)</span>}
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
            {summary && summary.closeCalls > 0 && (
              <p className="text-xs text-amber-400/90">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                แถวสีเหลือง = มีใบอื่นของ<b>วันใช้รถเดียวกัน</b>ถูกส่งห่างกันไม่ถึง 1 นาที — เป็นแค่ข้อสังเกตว่าคนส่งพร้อมกัน ไม่ได้แปลว่ามีใบหาย
              </p>
            )}
          </>
        ) : (
          <div className="py-12 text-center text-sm text-muted-foreground">
            ไม่มีใบขอที่ส่งในวันที่เลือก
            <br />
            <span className="text-xs">หมายเหตุ: ใบที่ถูกลบทิ้งไปแล้วจะไม่ปรากฏที่นี่</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
