"use client"

import * as React from "react"
import { useFirestore, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, getDocs, doc } from "firebase/firestore"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table"
import {
  BarChart2,
  Download,
  Calendar as CalendarIcon,
  Truck,
  User,
  MapPin,
  Fuel,
  Loader2,
  TrendingUp,
  Image as ImageIcon,
  CheckCircle2,
  ShieldAlert,
  Lock,
  Repeat
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Trip, CompanySetting } from "@/types/models"
import { computeOutcomeStats, computeDriverReliability } from "@/lib/calculations"
import { cn } from "@/lib/utils"
import { startOfMonth, format } from "date-fns"
import { th } from "date-fns/locale"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

// Helper to format date YYYY-MM-DD to DD/MM/YYYY
function formatDateDisplay(dateStr: string) {
  if (!dateStr) return "";
  if (dateStr.includes('-')) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

export default function ReportPage() {
  const { toast } = useToast()
  const db = useFirestore()
  
  const [startDate, setStartDate] = React.useState(format(startOfMonth(new Date()), 'yyyy-MM-01'))
  const [endDate, setEndDate] = React.useState(new Date().toISOString().split('T')[0])
  const [isLoading, setIsLoading] = React.useState(false)
  const [isExporting, setIsExporting] = React.useState(false)
  
  const [trips, setTrips] = React.useState<any[]>([])
  const [requests, setRequests] = React.useState<any[]>([])

  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: settings } = useDoc<CompanySetting>(settingsRef)

  const fetchData = async () => {
    setIsLoading(true)
    try {
      // Trips and requests are independent queries, so fetch them in
      // parallel instead of waiting for one before starting the other.
      const tripsQ = query(
        collection(db, "trips"),
        where("tripDate", ">=", startDate),
        where("tripDate", "<=", endDate)
      )
      const vrQ = query(
        collection(db, "vehicleRequests"),
        where("requestDate", ">=", startDate),
        where("requestDate", "<=", endDate)
      )

      const [tripsSnap, vrSnap] = await Promise.all([getDocs(tripsQ), getDocs(vrQ)])

      const tripsData = tripsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }))
      setTrips(tripsData)

      const vrData = vrSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }))
      setRequests(vrData)

      toast({ title: "โหลดข้อมูลสำเร็จ", description: `พบรายการเที่ยววิ่ง ${tripsData.length} รายการ` })
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถโหลดข้อมูลรายงานได้", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  React.useEffect(() => {
    fetchData()
  }, [])

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const element = document.getElementById('report-content')
      if (!element) return

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#1A1C23', // Match background-background
        logging: false
      })

      const image = canvas.toDataURL('image/jpeg', 0.9)
      const link = document.createElement('a')
      link.download = `LOTUS-Report-${startDate}-to-${endDate}.jpg`
      link.href = image
      link.click()
      
      toast({ title: "สำเร็จ", description: "บันทึกรายงานเป็นรูปภาพเรียบร้อยแล้ว" })
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถส่งออกรายงานได้", variant: "destructive" })
    } finally {
      setIsExporting(false)
    }
  }

  // ค่าน้ำมันต่อทริป: ใช้ค่าที่ freeze ไว้ตอนสร้างทริป (ราคาวันนั้น) ถ้าไม่มี (ทริปเก่า) ค่อยคำนวณด้วยค่าปัจจุบัน
  const tripFuelCost = (t: any) => {
    if (typeof t.fuelCost === 'number' && t.fuelCost > 0) return t.fuelCost
    const rate = t.fuelRateUsed || settings?.defaultFuelRate || 10
    const price = t.dieselPriceUsed || settings?.dieselPrice || 32.5
    return ((t.totalDistanceKm || 0) / rate) * price
  }

  // ผลจริง: กม. + ค่าน้ำมัน "ย้ายตามงาน" (โยก/รับต่อ) — แนบ fuelCost ที่ resolve แล้วเข้าไป
  // วันที่ทุกจุดตามแผน → จริง = แผน (ไม่มีอะไรเปลี่ยน)
  const outcome = React.useMemo(
    () => computeOutcomeStats(trips.map((t) => ({ ...t, fuelCost: tripFuelCost(t) }))),
    [trips, settings]
  )
  const completionRate = outcome.counts.total
    ? Math.round((outcome.counts.delivered / outcome.counts.total) * 100)
    : 0
  // กม./ค่าน้ำมัน "จริง" ของแต่ละทริป (หลังย้ายงานแล้ว)
  const kmOf = (t: any) => outcome.actualKmByTrip[t.id] ?? (t.totalDistanceKm || 0)
  const costOf = (t: any) => outcome.actualCostByTrip[t.id] ?? tripFuelCost(t)

  // AGGREGATIONS — ใช้ "กม.จริง/ค่าน้ำมันจริง" ที่ย้ายตามงานแล้วทั้งหมด
  const stats = React.useMemo(() => ({
    trips: trips.length,
    distance: outcome.totalActualKm,
    stops: trips.reduce((sum, t) => sum + (t.stops?.length || 0), 0),
    fuelCost: outcome.totalActualCost,
  }), [trips, outcome])

  const driverStats = React.useMemo(() => {
    const data: Record<string, any> = {}
    trips.forEach(t => {
      const name = t.driverName || "ไม่ระบุ"
      if (!data[name]) data[name] = { name, count: 0, distance: 0, stops: 0, cost: 0 }
      data[name].count += 1
      data[name].distance += kmOf(t)
      data[name].stops += (t.stops?.length || 0)
      data[name].cost += costOf(t)
    })
    return Object.values(data).sort((a, b) => b.distance - a.distance)
  }, [trips, outcome])

  const vehicleStats = React.useMemo(() => {
    const data: Record<string, any> = {}
    trips.forEach(t => {
      const plate = t.vehiclePlate || "ไม่ระบุ"
      if (!data[plate]) data[plate] = { plate, count: 0, distance: 0, cost: 0 }
      data[plate].count += 1
      data[plate].distance += kmOf(t)
      data[plate].cost += costOf(t)
    })
    return Object.values(data).sort((a, b) => b.distance - a.distance)
  }, [trips, outcome])

  const siteStats = React.useMemo(() => {
    const data: Record<string, number> = {}
    trips.forEach(t => {
      t.stops?.forEach((s: any) => {
        data[s.siteName] = (data[s.siteName] || 0) + 1
      })
    })
    return Object.entries(data)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [trips])

  const siteCostStats = React.useMemo(() => {
    const data: Record<string, any> = {}
    const tripIds = new Set(trips.map((t: any) => t.id).filter(Boolean))

    trips.forEach(t => {
      const stopCount = t.stops?.length || 1
      const distPerStop = (t.totalDistanceKm || 0) / stopCount
      const costPerStop = tripFuelCost(t) / stopCount
      t.stops?.forEach((s: any) => {
        // นับเฉพาะจุดที่ "มีคนวิ่งจริง": ตามแผน หรือถูกรับต่อ — เลื่อน/ปฏิเสธไม่มีคนรับ = ไม่นับ
        const delivered = !s.outcome || s.outcome === 'delivered'
        const pickedUp = s.reassignedToTripId && tripIds.has(s.reassignedToTripId)
        if (!delivered && !pickedUp) return
        const name = s.siteName || "ไม่ระบุ"
        if (!data[name]) data[name] = { name, count: 0, distance: 0, cost: 0 }
        data[name].count += 1
        data[name].distance += distPerStop
        data[name].cost += costPerStop
      })
    })

    return Object.values(data)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10)
  }, [trips, settings])

  const employeeStats = React.useMemo(() => {
    const data: Record<string, any> = {}
    requests.forEach(r => {
      const name = r.requestedBy || "ไม่ระบุ"
      if (!data[name]) data[name] = { name, total: 0, approved: 0, rejected: 0, pending: 0 }
      data[name].total += 1
      if (r.status === 'approved') data[name].approved += 1
      else if (r.status === 'rejected') data[name].rejected += 1
      else data[name].pending += 1
    })
    return Object.values(data).sort((a, b) => b.total - a.total)
  }, [requests])

  const weeklyTrend = React.useMemo(() => {
    const data: Record<string, { week: string, เที่ยว: number, ระยะทาง: number, ค่าน้ำมัน: number }> = {}
    
    trips.forEach(t => {
      const date = new Date(t.tripDate + 'T00:00:00')
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay() + 1)
      const weekKey = format(weekStart, 'dd/MM')
      
      if (!data[weekKey]) data[weekKey] = { week: weekKey, เที่ยว: 0, ระยะทาง: 0, ค่าน้ำมัน: 0 }
      data[weekKey].เที่ยว += 1
      data[weekKey].ระยะทาง += Math.round(kmOf(t))
      data[weekKey].ค่าน้ำมัน += Math.round(costOf(t))
    })

    return Object.values(data).sort((a, b) => a.week.localeCompare(b.week))
  }, [trips, outcome])

  // รายคนขับ (เฉพาะแอดมิน — ไม่อยู่ในภาพ export) เฉพาะคนที่มี exception ให้ดู
  const driverReliability = React.useMemo(
    () => computeDriverReliability(trips).filter((d) => d.exceptions > 0),
    [trips]
  )

  // รายการ "ปฏิเสธ" พร้อมเหตุผล — ไว้คุยส่วนตัว ไม่ประจานในกลุ่ม
  const refusalIncidents = React.useMemo(() => {
    const out: { date: string; driver: string; site: string; reason: string; pickedUp: string }[] = []
    trips.forEach((t) => {
      (t.stops || []).forEach((s: any) => {
        if (s.outcome === 'driver-refused') {
          out.push({
            date: t.tripDate || '',
            driver: t.driverName || 'ไม่ระบุ',
            site: s.siteName || 'ไม่ระบุ',
            reason: s.outcomeReason || '—',
            pickedUp: s.reassignedToVehiclePlate || '',
          })
        }
      })
    })
    return out.sort((a, b) => b.date.localeCompare(a.date))
  }, [trips])

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">รายงานสรุปการขนส่ง</h2>
          <p className="text-muted-foreground">วิเคราะห์ข้อมูลประสิทธิภาพคนขับ รถ และพนักงาน</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            className="border-accent text-accent hover:bg-accent/10 h-11"
            onClick={handleExport}
            disabled={isExporting || trips.length === 0}
          >
            {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
            บันทึกเป็นรูปภาพ
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row items-end gap-4">
          <div className="grid grid-cols-2 gap-4 flex-1">
            <div className="space-y-2">
              <Label>ตั้งแต่วันที่</Label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-accent pointer-events-none z-10" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>ถึงวันที่</Label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-accent pointer-events-none z-10" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                />
              </div>
            </div>
          </div>
          <Button className="bg-accent h-11 w-full md:w-auto" onClick={fetchData} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart2 className="mr-2 h-4 w-4" />}
            สร้างรายงาน
          </Button>
        </CardContent>
      </Card>

      <div id="report-content" className="space-y-8 p-4 bg-[#1A1C23] rounded-2xl">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-accent">🏢 LOTUS GROUP — รายงานสรุปการขนส่ง</h1>
          <p className="text-sm text-muted-foreground">ช่วงเวลา: {formatDateDisplay(startDate)} ถึง {formatDateDisplay(endDate)}</p>
        </div>

        {/* KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                <Truck className="h-4 w-4 text-accent" /> จำนวนเที่ยววิ่งทั้งหมด
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-black text-white">{stats.trips} <span className="text-xs font-normal">เที่ยว</span></p>
            </CardContent>
          </Card>
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                <MapPin className="h-4 w-4 text-accent" /> ระยะทางวิ่งจริง
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-black text-white">{stats.distance.toLocaleString()} <span className="text-xs font-normal">กม.</span></p>
            </CardContent>
          </Card>
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-accent" /> จำนวนจุดส่งรวม
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-black text-white">{stats.stops} <span className="text-xs font-normal">จุด</span></p>
            </CardContent>
          </Card>
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-2">
                <Fuel className="h-4 w-4 text-accent" /> ประมาณการค่าน้ำมัน
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-black text-accent">{stats.fuelCost.toLocaleString('th-TH', { maximumFractionDigits: 0 })} <span className="text-xs font-normal text-white">บาท</span></p>
            </CardContent>
          </Card>
        </div>

        {/* COMPLETION SUMMARY (ภาพรวม ผลจริง — ไม่ระบุตัวคน จึง export ได้) */}
        {outcome.counts.total > 0 && (
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-accent" /> สรุปผลจริง (Completion)
              </CardTitle>
              <CardDescription>
                เทียบ "ตามแผน" กับ "ผิดแผน" จากการปิดผลงานจริงรายจุด
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                {/* อัตราสำเร็จก้อนใหญ่ */}
                <div className="md:col-span-3 text-center bg-background/40 rounded-xl py-4 border border-border/50">
                  <p className="text-5xl font-black text-green-500">{completionRate}%</p>
                  <p className="text-xs text-muted-foreground mt-1">วิ่งตามแผน</p>
                  <p className="text-[11px] text-muted-foreground/70">
                    {outcome.counts.delivered} จาก {outcome.counts.total} จุด
                  </p>
                </div>
                {/* breakdown 4 ช่อง (ตัวเลขรวม ไม่ระบุตัวคน) */}
                <div className="md:col-span-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-background/40 rounded-lg p-3 text-center border border-border/50">
                    <p className="text-2xl font-bold text-green-500">{outcome.counts.delivered}</p>
                    <p className="text-[11px] text-muted-foreground">ตามแผน</p>
                  </div>
                  <div className="bg-background/40 rounded-lg p-3 text-center border border-border/50">
                    <p className="text-2xl font-bold text-blue-400">{outcome.counts.reassigned}</p>
                    <p className="text-[11px] text-muted-foreground">โยกงาน</p>
                  </div>
                  <div className="bg-background/40 rounded-lg p-3 text-center border border-border/50">
                    <p className="text-2xl font-bold text-amber-400">{outcome.counts.postponed}</p>
                    <p className="text-[11px] text-muted-foreground">เลื่อน</p>
                  </div>
                  <div className="bg-background/40 rounded-lg p-3 text-center border border-border/50">
                    <p className="text-2xl font-bold text-red-400">{outcome.counts.refused}</p>
                    <p className="text-[11px] text-muted-foreground">ปฏิเสธ</p>
                  </div>
                </div>
                {/* กม. แผน vs จริง */}
                <div className="md:col-span-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">กม. ตามแผน</span>
                    <span className="text-white font-medium">{Math.round(outcome.totalPlannedKm).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">กม. วิ่งจริง</span>
                    <span className="text-accent font-bold">{Math.round(outcome.totalActualKm).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {weeklyTrend.length > 0 && (
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-accent" /> แนวโน้มรายสัปดาห์
              </CardTitle>
              <CardDescription>เปรียบเทียบจำนวนเที่ยววิ่งและค่าน้ำมันแต่ละสัปดาห์</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase mb-3">จำนวนเที่ยววิ่ง</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={weeklyTrend} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#888' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        labelStyle={{ color: '#fff' }}
                      />
                      <Bar dataKey="เที่ยว" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase mb-3">ค่าน้ำมัน (บาท)</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={weeklyTrend} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#888' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        labelStyle={{ color: '#fff' }}
                        formatter={(value: any) => [`฿${value.toLocaleString()}`, 'ค่าน้ำมัน']}
                      />
                      <Bar dataKey="ค่าน้ำมัน" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* DRIVER PERFORMANCE */}
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><User className="h-5 w-5 text-accent" /> ประสิทธิภาพคนขับรถ</CardTitle>
              <CardDescription>จัดลำดับตามระยะทางที่วิ่งจริง</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead>คนขับ</TableHead>
                    <TableHead className="text-right">เที่ยว</TableHead>
                    <TableHead className="text-right">ระยะทาง</TableHead>
                    <TableHead className="text-right">ค่าน้ำมัน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {driverStats.map((d, i) => (
                    <TableRow key={i} className="border-border/20">
                      <TableCell className="font-medium text-white">{d.name}</TableCell>
                      <TableCell className="text-right">{d.count}</TableCell>
                      <TableCell className="text-right">{d.distance.toFixed(1)}</TableCell>
                      <TableCell className="text-right text-accent font-bold">฿{d.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* VEHICLE PERFORMANCE */}
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Truck className="h-5 w-5 text-accent" /> ประสิทธิภาพรถยนต์</CardTitle>
              <CardDescription>สรุปการใช้งานยานพาหนะ</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead>ทะเบียน</TableHead>
                    <TableHead className="text-right">ใช้งาน (ครั้ง)</TableHead>
                    <TableHead className="text-right">ระยะทางรวม</TableHead>
                    <TableHead className="text-right">ค่าน้ำมันรวม</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicleStats.map((v, i) => (
                    <TableRow key={i} className="border-border/20">
                      <TableCell className="font-bold text-white">{v.plate}</TableCell>
                      <TableCell className="text-right">{v.count}</TableCell>
                      <TableCell className="text-right">{v.distance.toFixed(1)}</TableCell>
                      <TableCell className="text-right text-accent">฿{v.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* TOP SITES */}
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><MapPin className="h-5 w-5 text-accent" /> Top 10 ไซต์งาน/สถานที่</CardTitle>
              <CardDescription>สถานที่ที่มีการเข้าถึงบ่อยที่สุด</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {siteStats.map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px] font-bold shrink-0">{i+1}</div>
                    <div className="flex-1 bg-background/50 p-2 px-3 rounded-lg border border-border/50 flex justify-between items-center">
                      <span className="text-xs text-white font-medium truncate max-w-[200px]">{s.name}</span>
                      <Badge className="bg-accent text-white">{s.count} ครั้ง</Badge>
                    </div>
                  </div>
                ))}
                {siteStats.length === 0 && <div className="text-center py-10 text-muted-foreground">ไม่มีข้อมูลการจัดส่ง</div>}
              </div>
            </CardContent>
          </Card>

          {/* EMPLOYEE REQUEST STATS */}
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><BarChart2 className="h-5 w-5 text-accent" /> สรุปคำขอแยกตามพนักงาน</CardTitle>
              <CardDescription>สถิติการส่งคำขอใช้รถ</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead>พนักงาน</TableHead>
                    <TableHead className="text-right">รวม</TableHead>
                    <TableHead className="text-right text-green-500">จัดรถแล้ว</TableHead>
                    <TableHead className="text-right text-red-500">ปฏิเสธ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeeStats.map((e, i) => (
                    <TableRow key={i} className="border-border/20">
                      <TableCell className="font-medium text-white">{e.name}</TableCell>
                      <TableCell className="text-right font-bold">{e.total}</TableCell>
                      <TableCell className="text-right text-green-500">{e.approved}</TableCell>
                      <TableCell className="text-right text-red-500">{e.rejected}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {siteCostStats.length > 0 && (
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Fuel className="h-5 w-5 text-accent" /> Top 10 ไซต์งานที่มีค่าใช้จ่ายสูงสุด
              </CardTitle>
              <CardDescription>ประมาณการค่าน้ำมันแยกตามไซต์งาน/สถานที่</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>ไซต์งาน / สถานที่</TableHead>
                    <TableHead className="text-right">จำนวนครั้ง</TableHead>
                    <TableHead className="text-right">ระยะทางรวม</TableHead>
                    <TableHead className="text-right">ค่าน้ำมันประมาณ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {siteCostStats.map((s, i) => (
                    <TableRow key={i} className="border-border/20">
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell className="font-medium text-white">{s.name}</TableCell>
                      <TableCell className="text-right">{s.count} ครั้ง</TableCell>
                      <TableCell className="text-right">{s.distance.toFixed(1)} กม.</TableCell>
                      <TableCell className="text-right text-accent font-bold">
                        ฿{s.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <div className="text-center pt-10 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground italic">
            รายงานสร้างจากระบบ LOTUS GROUP Transport Management เมื่อ {new Date().toLocaleString('th-TH')}
          </p>
        </div>
      </div>

      {/* ============================================================ */}
      {/* เฉพาะแอดมิน — อยู่ "นอก" #report-content จึงไม่ติดไปในรูป JPEG */}
      {/* หลักการ: จัดการคนอู้แบบส่วนตัว ไม่ประจานในกลุ่ม              */}
      {/* ============================================================ */}
      {(driverReliability.length > 0 || refusalIncidents.length > 0) && (
        <Card className="border-red-500/30 bg-red-950/10">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-red-300">
              <Lock className="h-5 w-5" /> เฉพาะแอดมิน — ความน่าเชื่อถือคนขับ
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-red-400/70 shrink-0" />
              ข้อมูลส่วนนี้ <b className="text-red-300/90">ไม่อยู่ในไฟล์ภาพที่กดบันทึก</b> — ไว้ดูเพื่อคุยส่วนตัว ไม่ใช่ประจานในกลุ่ม
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {driverReliability.length > 0 && (
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase mb-2">สรุปรายคนขับ (เรียงตามจำนวนปฏิเสธ)</p>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead>คนขับ</TableHead>
                      <TableHead className="text-right">จุดที่รับ</TableHead>
                      <TableHead className="text-right">ตามแผน</TableHead>
                      <TableHead className="text-right">โยกงาน</TableHead>
                      <TableHead className="text-right">เลื่อน</TableHead>
                      <TableHead className="text-right text-red-400">ปฏิเสธ</TableHead>
                      <TableHead className="text-right">% สำเร็จ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {driverReliability.map((d, i) => (
                      <TableRow key={i} className="border-border/20">
                        <TableCell className="font-medium text-white">{d.driverName || 'ไม่ระบุ'}</TableCell>
                        <TableCell className="text-right">{d.assignedStops}</TableCell>
                        <TableCell className="text-right text-green-500">{d.delivered}</TableCell>
                        <TableCell className="text-right text-blue-400">{d.reassigned || '—'}</TableCell>
                        <TableCell className="text-right text-amber-400">{d.postponed || '—'}</TableCell>
                        <TableCell className="text-right font-bold text-red-400">{d.refused || '—'}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            "font-medium",
                            d.completionRate >= 0.9 ? "text-green-500" : d.completionRate >= 0.7 ? "text-amber-400" : "text-red-400"
                          )}>
                            {Math.round(d.completionRate * 100)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {refusalIncidents.length > 0 && (
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase mb-2">
                  รายการปฏิเสธ + เหตุผล ({refusalIncidents.length} ครั้ง)
                </p>
                <div className="space-y-2">
                  {refusalIncidents.map((r, i) => (
                    <div key={i} className="bg-background/40 rounded-lg p-3 border border-red-500/20 text-sm">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs text-muted-foreground">{formatDateDisplay(r.date)}</span>
                        <span className="font-medium text-white">{r.driver}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground truncate">{r.site}</span>
                        {r.pickedUp && (
                          <Badge variant="outline" className="border-blue-500/40 text-blue-300 text-[10px] gap-1">
                            <Repeat className="h-3 w-3" /> โยกไป {r.pickedUp}
                          </Badge>
                        )}
                      </div>
                      {r.reason && r.reason !== '—' && (
                        <p className="text-xs text-red-300/80 mt-1">เหตุผล: {r.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
