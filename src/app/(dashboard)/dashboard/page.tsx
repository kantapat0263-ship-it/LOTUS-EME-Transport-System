
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
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc } from "firebase/firestore"
import { Trip, Site, UserProfile } from "@/types/models"
import { startOfWeek, endOfWeek, format, isWithinInterval, startOfMonth, endOfMonth, subDays } from "date-fns"
import { th } from "date-fns/locale"

export default function DashboardPage() {
  const db = useFirestore()
  const { user } = useUser()
  const todayStr = new Date().toISOString().split('T')[0]
  const yesterdayStr = subDays(new Date(), 1).toISOString().split('T')[0]
  
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef)

  const tripsRef = useMemoFirebase(() => (db && user) ? collection(db, "trips") : null, [db, user])
  const { data: allTrips, isLoading: isLoadingTrips } = useCollection<Trip>(tripsRef)
  
  const sitesRef = useMemoFirebase(() => (db && user) ? query(collection(db, "sites"), where("status", "==", "Active")) : null, [db, user])
  const { data: activeSites, isLoading: isLoadingSites } = useCollection<Site>(sitesRef)

  // Filter trips based on role
  const visibleTrips = React.useMemo(() => {
    if (!allTrips || !profile) return []
    const isStaff = profile.role === 'admin' || profile.role === 'dispatcher'
    if (isStaff) return allTrips

    const userEmail = user?.email
    const userName = profile.name

    return allTrips.filter(trip => {
      const isOwner = 
        trip.requestedBy === userEmail || 
        (trip as any).requestedByEmail === userEmail ||
        (trip as any).requesterEmail === userEmail ||
        (trip as any).requestedBy === userName ||
        (trip as any).userId === user?.uid ||
        trip.stops?.some((s: any) => 
          s.requestedBy === userEmail || 
          s.requestedBy === userName
        );
      return isOwner
    })
  }, [allTrips, profile, user])

  const stats = React.useMemo(() => {
    if (!visibleTrips) return { today: 0, yesterday: 0, monthDist: 0, onTimeRate: 0, siteCount: activeSites?.length || 0 }
    
    const todayTrips = visibleTrips.filter(t => t.tripDate === todayStr)
    const yesterdayTrips = visibleTrips.filter(t => t.tripDate === yesterdayStr)
    
    const monthStart = startOfMonth(new Date())
    const monthEnd = endOfMonth(new Date())
    
    const monthTrips = visibleTrips.filter(t => {
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
  }, [visibleTrips, activeSites, todayStr, yesterdayStr])

  const weeklyData = React.useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const result = days.map(day => ({ name: day, trips: 0 }))
    
    if (!visibleTrips) return result
    
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 })
    
    visibleTrips.forEach(t => {
      const d = new Date(t.tripDate)
      if (isWithinInterval(d, { start: weekStart, end: weekEnd })) {
        const dayIdx = (d.getDay() + 6) % 7 
        result[dayIdx].trips += 1
      }
    })
    
    return result
  }, [visibleTrips])

  const topSitesData = React.useMemo(() => {
    if (!visibleTrips) return []
    
    const counts: Record<string, number> = {}
    visibleTrips.forEach(t => {
      t.stops?.forEach(s => {
        counts[s.siteName] = (counts[s.siteName] || 0) + 1
      })
    })
    
    return Object.entries(counts)
      .map(([name, visits]) => ({ name, visits, color: name.includes('LOTUS') ? '#F0890D' : '#172899' }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 5)
  }, [visibleTrips])

  const todayTripsList = React.useMemo(() => {
    return visibleTrips?.filter(t => t.tripDate === todayStr) || []
  }, [visibleTrips, todayStr])

  const insights = React.useMemo(() => {
    if (!visibleTrips || visibleTrips.length === 0) return []
    
    const driverCounts: Record<string, number> = {}
    visibleTrips.forEach(t => {
      if (t.driverName) driverCounts[t.driverName] = (driverCounts[t.driverName] || 0) + 1
    })
    const topDriver = Object.entries(driverCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-"
    
    const totalDist = visibleTrips.reduce((acc, t) => acc + (t.totalDistanceKm || 0), 0)
    const avgDist = visibleTrips.length > 0 ? totalDist / visibleTrips.length : 0
    
    return [
      {
        title: "ประสิทธิภาพการจัดรถ",
        desc: profile?.role === 'viewer' 
          ? `คุณมีการจัดส่งสินค้าไปแล้ว ${visibleTrips.length} เที่ยววิ่งในระบบ`
          : `คุณ ${topDriver} เป็นคนขับที่วิ่งงานมากที่สุดในระบบขณะนี้`,
        color: "text-accent",
        bg: "bg-accent/5",
        border: "border-accent/20"
      },
      {
        title: "สรุปการดำเนินงาน",
        desc: `ระยะทางเฉลี่ยต่อเที่ยวของคุณคือ ${avgDist.toFixed(1)} กม.`,
        color: "text-primary-foreground",
        bg: "bg-primary/5",
        border: "border-primary/20"
      },
      {
        title: "ภาพรวมเดือนนี้",
        desc: `ในเดือนนี้มีการส่งสินค้าสำเร็จไปแล้ว ${visibleTrips.filter(t => t.status === 'Completed').length} จุด`,
        color: "text-green-500",
        bg: "bg-green-500/5",
        border: "border-green-500/20"
      }
    ]
  }, [visibleTrips, profile])

  if (isLoadingTrips || isLoadingSites || isProfileLoading || !user) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-accent" />
          <p className="text-sm md:text-base text-muted-foreground animate-pulse text-center px-4">กำลังประมวลผลข้อมูลส่วนตัวของคุณ...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-sm md:text-base text-muted-foreground">
          {profile?.role === 'viewer' ? 'ภาพรวมงานขนส่งที่คุณเป็นผู้ขอ' : 'ภาพรวมการขนส่งและผลงานประจำวันของระบบ'}
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">เที่ยววิ่งของคุณวันนี้</CardTitle>
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
            <CardTitle className="text-sm font-medium">ระยะทางรวมของคุณ (กม.)</CardTitle>
            <MapPin className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.monthDist.toLocaleString()} กม.</div>
            <p className="text-xs text-muted-foreground">สะสมในเดือน{format(new Date(), 'MMMM', { locale: th })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">อัตราการจัดส่งสำเร็จ</CardTitle>
            <TrendingUp className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.onTimeRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">ความสำเร็จเทียบกับคำขอทั้งหมด</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ไซน์งานที่เปิดรับของ</CardTitle>
            <Calendar className="h-4 w-4 text-white" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.siteCount} แห่ง</div>
            <p className="text-xs text-muted-foreground">สถานะ Active ในระบบ</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-7">
        <Card className="col-span-1 lg:col-span-4">
          <CardHeader>
            <CardTitle className="text-lg">สถิติการส่งของสัปดาห์นี้</CardTitle>
            <CardDescription>จำนวนเที่ยววิ่งของคุณแยกตามวัน</CardDescription>
          </CardHeader>
          <CardContent className="pl-0 md:pl-2">
            <div className="h-[250px] md:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData} margin={{ left: -20, right: 10 }}>
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

        <Card className="col-span-1 lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">ไซน์งานที่คุณเข้าส่งบ่อย</CardTitle>
            <CardDescription>Top 5 โครงการที่คุณขอใช้รถมากที่สุด</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] md:h-[300px]">
              {topSitesData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topSitesData} layout="vertical" margin={{ left: -10 }}>
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      stroke="#666" 
                      fontSize={11} 
                      width={90} 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <Tooltip 
                      cursor={{fill: 'transparent'}}
                      contentStyle={{ backgroundColor: '#1A1C23', border: '1px solid #2D3139', color: '#fff' }} 
                    />
                    <Bar dataKey="visits" radius={[0, 4, 4, 0]} barSize={20}>
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

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg">สถานะการส่งของคุณวันนี้</CardTitle>
              <CardDescription className="text-xs md:text-sm">{format(new Date(), 'dd/MM/yyyy')}</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild className="h-8 text-xs">
              <Link href="/trips/history">
                ดูทั้งหมด <ExternalLink className="ml-1 md:ml-2 h-3 w-3 md:h-4 md:w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {todayTripsList.length > 0 ? todayTripsList.slice(0, 5).map((trip) => (
                <div key={trip.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-transparent hover:border-accent/30 transition-all">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-1.5 md:p-2 rounded-full",
                      trip.status === 'Completed' ? "bg-green-500/10 text-green-500" :
                      trip.status === 'In Progress' ? "bg-blue-500/10 text-blue-500" : 
                      trip.status === 'Cancelled' ? "bg-red-500/10 text-red-500" : "bg-orange-500/10 text-orange-500"
                    )}>
                      {trip.status === 'Completed' ? <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5" /> :
                       trip.status === 'In Progress' ? <Clock className="h-4 w-4 md:h-5 md:w-5" /> : <AlertCircle className="h-4 w-4 md:h-5 md:w-5" />}
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-sm font-medium truncate">{trip.stops?.[trip.stops.length - 1]?.siteName || "ไม่ระบุไซน์งาน"}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{trip.tripId} • {trip.driverName || "-"}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] md:text-xs font-semibold">{trip.status}</p>
                    <p className="text-[10px] text-muted-foreground">{trip.vehiclePlate || "-"}</p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-8 text-muted-foreground text-sm">คุณไม่มีเที่ยววิ่งในวันนี้</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Insights ของคุณ</CardTitle>
            <CardDescription className="text-xs md:text-sm">ข้อมูลวิเคราะห์จากการใช้งานระบบของคุณ</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.map((insight, idx) => (
                <div key={idx} className={cn("p-3 md:p-4 rounded-lg border", insight.bg, insight.border)}>
                  <h4 className={cn("font-semibold mb-1 text-sm md:text-base", insight.color)}>{insight.title}</h4>
                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                    "{insight.desc}"
                  </p>
                </div>
              ))}
              {insights.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">ยังไม่มีข้อมูลเพียงพอสำหรับการวิเคราะห์</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
