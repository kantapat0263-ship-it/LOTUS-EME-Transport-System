
"use client"

import * as React from "react"
import { 
  TrendingUp, 
  Truck, 
  MapPin, 
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from "recharts"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy } from "firebase/firestore"
import { Trip, Site } from "@/types/models"
import { startOfWeek, endOfWeek, format, isWithinInterval, startOfMonth, endOfMonth, subDays } from "date-fns"
import { th } from "date-fns/locale"

export default function DashboardPage() {
  const db = useFirestore()
  const todayStr = new Date().toISOString().split('T')[0]
  const yesterdayStr = subDays(new Date(), 1).toISOString().split('T')[0]
  
  // Queries
  const tripsRef = useMemoFirebase(() => collection(db, "trips"), [db])
  const { data: allTrips, isLoading: isLoadingTrips } = useCollection<Trip>(tripsRef)
  
  const sitesRef = useMemoFirebase(() => query(collection(db, "sites"), where("status", "==", "Active")), [db])
  const { data: activeSites, isLoading: isLoadingSites } = useCollection<Site>(sitesRef)

  // 1. Stats Calculations
  const stats = React.useMemo(() => {
    if (!allTrips) return { today: 0, yesterday: 0, monthDist: 0, onTimeRate: 0, siteCount: activeSites?.length || 0 }
    
    const todayTrips = allTrips.filter(t => t.tripDate === todayStr)
    const yesterdayTrips = allTrips.filter(t => t.tripDate === yesterdayStr)
    
    const monthStart = startOfMonth(new Date())
    const monthEnd = endOfMonth(new Date())
    
    const monthTrips = allTrips.filter(t => {
      const tripDate = new Date(t.tripDate)
      return tripDate >= monthStart && tripDate <= monthEnd
    })
    
    const monthDist = monthTrips.reduce((acc, t) => acc + (t.totalDistanceKm || 0), 0)
    const completedMonth = monthTrips.filter(t => t.status === 'Completed').length
    const onTimeRate = monthTrips.length > 0 ? (completedMonth / monthTrips.length) * 100 : 0
    
    return {
      today: todayTrips.length,
      yesterday: yesterdayTrips.length,
      monthDist,
      onTimeRate,
      siteCount: activeSites?.length || 0
    }
  }, [allTrips, activeSites, todayStr, yesterdayStr])

  // 2. Weekly Chart Data
  const weeklyData = React.useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const result = days.map(day => ({ name: day, trips: 0 }))
    
    if (!allTrips) return result
    
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 })
    
    allTrips.forEach(t => {
      const d = new Date(t.tripDate)
      if (isWithinInterval(d, { start: weekStart, end: weekEnd })) {
        const dayIdx = (d.getDay() + 6) % 7 // Convert Sun(0) to 6, Mon(1) to 0
        result[dayIdx].trips += 1
      }
    })
    
    return result
  }, [allTrips])

  // 3. Most Frequent Sites Data
  const topSitesData = React.useMemo(() => {
    if (!allTrips) return []
    
    const counts: Record<string, number> = {}
    allTrips.forEach(t => {
      t.stops?.forEach(s => {
        counts[s.siteName] = (counts[s.siteName] || 0) + 1
      })
    })
    
    return Object.entries(counts)
      .map(([name, visits]) => ({ name, visits, color: name.includes('LOTUS') ? '#F0890D' : '#172899' }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 5)
  }, [allTrips])

  // 4. Today's Trips
  const todayTrips = React.useMemo(() => {
    return allTrips?.filter(t => t.tripDate === todayStr) || []
  }, [allTrips, todayStr])

  // 5. Insights
  const insights = React.useMemo(() => {
    if (!allTrips || allTrips.length === 0) return []
    
    const driverCounts: Record<string, number> = {}
    allTrips.forEach(t => {
      if (t.driverName) driverCounts[t.driverName] = (driverCounts[t.driverName] || 0) + 1
    })
    const topDriver = Object.entries(driverCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-"
    
    const avgDist = allTrips.reduce((acc, t) => acc + (t.totalDistanceKm || 0), 0) / allTrips.length
    
    return [
      {
        title: "ประสิทธิภาพคนขับ",
        desc: `คุณ ${topDriver} เป็นคนขับที่วิ่งงานมากที่สุดในระบบขณะนี้`,
        color: "text-accent",
        bg: "bg-accent/5",
        border: "border-accent/20"
      },
      {
        title: "สรุปการดำเนินงาน",
        desc: `ระยะทางเฉลี่ยต่อเที่ยวคือ ${avgDist.toFixed(1)} กม. จากทั้งหมด ${allTrips.length} เที่ยววิ่ง`,
        color: "text-primary-foreground",
        bg: "bg-primary/5",
        border: "border-primary/20"
      },
      {
        title: "ภาพรวมเดือนนี้",
        desc: `ในเดือนนี้มีการส่งสินค้าสำเร็จไปแล้ว ${allTrips.filter(t => t.status === 'Completed').length} จุด`,
        color: "text-green-500",
        bg: "bg-green-500/5",
        border: "border-green-500/20"
      }
    ]
  }, [allTrips])

  if (isLoadingTrips || isLoadingSites) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-accent" />
          <p className="text-muted-foreground animate-pulse">กำลังประมวลผลข้อมูลสดจากคลาวด์...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">ภาพรวมการขนส่งและผลงานประจำวันของคุณ (ข้อมูลเรียลไทม์)</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">เที่ยววิ่งวันนี้</CardTitle>
            <Truck className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.today} เที่ยว</div>
            <div className="flex items-center gap-1 mt-1">
              {stats.today >= stats.yesterday ? (
                <span className="text-xs text-green-500 flex items-center"><ArrowUpRight className="h-3 w-3" /> +{stats.today - stats.yesterday}</span>
              ) : (
                <span className="text-xs text-red-500 flex items-center"><ArrowDownRight className="h-3 w-3" /> {stats.today - stats.yesterday}</span>
              )}
              <span className="text-xs text-muted-foreground">จากเมื่อวาน</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ระยะทางรวม (กม.)</CardTitle>
            <MapPin className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.monthDist.toLocaleString()} กม.</div>
            <p className="text-xs text-muted-foreground">สะสมในเดือน{format(new Date(), 'MMMM', { locale: th })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">อัตราความตรงต่อเวลา</CardTitle>
            <TrendingUp className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.onTimeRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">เที่ยววิ่งสำเร็จเทียบกับทั้งหมด</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ไซน์งานที่ดูแล</CardTitle>
            <Calendar className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.siteCount} แห่ง</div>
            <p className="text-xs text-muted-foreground">สถานะ Active ในระบบ</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>สถิติการส่งของสัปดาห์นี้</CardTitle>
            <CardDescription>จำนวนเที่ยววิ่งแยกตามวัน (จันทร์ - อาทิตย์)</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2D3139" vertical={false} />
                  <XAxis dataKey="name" stroke="#666" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#666" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1A1C23', border: '1px solid #2D3139', color: '#fff' }} 
                    itemStyle={{ color: '#F0890D' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="trips" 
                    stroke="#F0890D" 
                    strokeWidth={3} 
                    dot={{ fill: '#F0890D', strokeWidth: 2, r: 4 }} 
                    activeDot={{ r: 8 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>ไซน์งานที่มีการเข้าบ่อยที่สุด</CardTitle>
            <CardDescription>จำนวนครั้งที่ส่งของแยกตามโครงการ (Top 5)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {topSitesData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topSitesData} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      stroke="#666" 
                      fontSize={11} 
                      width={100} 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <Tooltip 
                      cursor={{fill: 'transparent'}}
                      contentStyle={{ backgroundColor: '#1A1C23', border: '1px solid #2D3139', color: '#fff' }} 
                    />
                    <Bar dataKey="visits" radius={[0, 4, 4, 0]}>
                      {topSitesData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground text-sm">ไม่มีข้อมูลไซน์งาน</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>สถานะการส่งวันนี้</CardTitle>
              <CardDescription>ข้อมูลประจำวันที่ {format(new Date(), 'dd/MM/yyyy')}</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/trips/history">
                ดูประวัติทั้งหมด <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {todayTrips.length > 0 ? todayTrips.slice(0, 5).map((trip) => (
                <div key={trip.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-transparent hover:border-accent/30 transition-all">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "p-2 rounded-full",
                      trip.status === 'Completed' ? "bg-green-500/10 text-green-500" :
                      trip.status === 'In Progress' ? "bg-blue-500/10 text-blue-500" : 
                      trip.status === 'Cancelled' ? "bg-red-500/10 text-red-500" : "bg-orange-500/10 text-orange-500"
                    )}>
                      {trip.status === 'Completed' ? <CheckCircle2 className="h-5 w-5" /> :
                       trip.status === 'In Progress' ? <Clock className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{trip.stops?.[trip.stops.length - 1]?.siteName || "ไม่ระบุไซน์งาน"}</p>
                      <p className="text-xs text-muted-foreground">{trip.tripId} • คนขับ: {trip.driverName || "-"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{trip.status}</p>
                    <p className="text-xs text-muted-foreground">{trip.vehiclePlate || "-"}</p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-8 text-muted-foreground">ไม่มีเที่ยววิ่งในวันนี้</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Insights (Data Analysis)</CardTitle>
            <CardDescription>ข้อมูลวิเคราะห์จากการขนส่งในระบบปัจจุบัน</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {insights.map((insight, idx) => (
                <div key={idx} className={cn("p-4 rounded-lg border", insight.bg, insight.border)}>
                  <h4 className={cn("font-semibold mb-1", insight.color)}>{insight.title}</h4>
                  <p className="text-sm text-muted-foreground">
                    "{insight.desc}"
                  </p>
                </div>
              ))}
              {insights.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">ยังไม่มีข้อมูลเพียงพอสำหรับการวิเคราะห์</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
