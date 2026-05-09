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
  Image as ImageIcon
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Trip, CompanySetting } from "@/types/models"
import { cn } from "@/lib/utils"
import { startOfMonth, format } from "date-fns"
import { th } from "date-fns/locale"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"

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
      // 1. Fetch Trips
      const tripsQ = query(
        collection(db, "trips"),
        where("tripDate", ">=", startDate),
        where("tripDate", "<=", endDate)
      )
      const tripsSnap = await getDocs(tripsQ)
      const tripsData = tripsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }))
      setTrips(tripsData)

      // 2. Fetch Requests
      const vrQ = query(
        collection(db, "vehicleRequests"),
        where("requestDate", ">=", startDate),
        where("requestDate", "<=", endDate)
      )
      const vrSnap = await getDocs(vrQ)
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

  // AGGREGATIONS
  const stats = React.useMemo(() => {
    const totalDist = trips.reduce((sum, t) => sum + (t.totalDistanceKm || 0), 0)
    const totalStops = trips.reduce((sum, t) => sum + (t.stops?.length || 0), 0)
    
    // Calculation: (Total Distance / defaultFuelRate) * dieselPrice
    const fuelRate = settings?.defaultFuelRate || 10
    const dieselPrice = settings?.dieselPrice || 32.5
    const totalFuelCost = (totalDist / fuelRate) * dieselPrice

    return {
      trips: trips.length,
      distance: totalDist,
      stops: totalStops,
      fuelCost: totalFuelCost
    }
  }, [trips, settings])

  const driverStats = React.useMemo(() => {
    const data: Record<string, any> = {}
    trips.forEach(t => {
      const name = t.driverName || "ไม่ระบุ"
      if (!data[name]) data[name] = { name, count: 0, distance: 0, stops: 0, cost: 0 }
      data[name].count += 1
      data[name].distance += (t.totalDistanceKm || 0)
      data[name].stops += (t.stops?.length || 0)
      
      const rate = settings?.defaultFuelRate || 10
      const price = settings?.dieselPrice || 32.5
      data[name].cost += ((t.totalDistanceKm || 0) / rate) * price
    })
    return Object.values(data).sort((a, b) => b.distance - a.distance)
  }, [trips, settings])

  const vehicleStats = React.useMemo(() => {
    const data: Record<string, any> = {}
    trips.forEach(t => {
      const plate = t.vehiclePlate || "ไม่ระบุ"
      if (!data[plate]) data[plate] = { plate, count: 0, distance: 0, cost: 0 }
      data[plate].count += 1
      data[plate].distance += (t.totalDistanceKm || 0)
      
      const rate = settings?.defaultFuelRate || 10
      const price = settings?.dieselPrice || 32.5
      data[plate].cost += ((t.totalDistanceKm || 0) / rate) * price
    })
    return Object.values(data).sort((a, b) => b.distance - a.distance)
  }, [trips, settings])

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
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full h-11 justify-start text-left font-normal bg-background">
                    <CalendarIcon className="mr-2 h-4 w-4 text-accent" />
                    {startDate ? formatDateDisplay(startDate) : <span>เริ่มวันที่</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate ? new Date(startDate) : undefined}
                    onSelect={(date) => setStartDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>ถึงวันที่</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full h-11 justify-start text-left font-normal bg-background">
                    <CalendarIcon className="mr-2 h-4 w-4 text-accent" />
                    {endDate ? formatDateDisplay(endDate) : <span>ถึงวันที่</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate ? new Date(endDate) : undefined}
                    onSelect={(date) => setEndDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
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
                <MapPin className="h-4 w-4 text-accent" /> ระยะทางสะสม
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
              <CardTitle className="text-lg flex items-center gap-2"><MapPin className="h-5 w-5 text-accent" /> Top 10 ไซน์งาน/สถานที่</CardTitle>
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

        <div className="text-center pt-10 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground italic">
            รายงานสร้างจากระบบ LOTUS GROUP Transport Management เมื่อ {new Date().toLocaleString('th-TH')}
          </p>
        </div>
      </div>
    </div>
  )
}
