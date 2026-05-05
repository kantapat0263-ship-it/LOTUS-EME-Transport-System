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
  ExternalLink
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

const data = [
  { name: 'Mon', trips: 12 },
  { name: 'Tue', trips: 15 },
  { name: 'Wed', trips: 8 },
  { name: 'Thu', trips: 20 },
  { name: 'Fri', trips: 18 },
  { name: 'Sat', trips: 5 },
  { name: 'Sun', trips: 2 },
]

const siteVisits = [
  { name: 'ABC Sukhumvit', visits: 45, color: '#172899' },
  { name: 'XYZ Project', visits: 32, color: '#F0890D' },
  { name: 'Lotus Warehouse', visits: 28, color: '#172899' },
  { name: 'Bangna Office', visits: 15, color: '#F0890D' },
]

export default function DashboardPage() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">ภาพรวมการขนส่งและผลงานประจำวันของคุณ</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">เที่ยววิ่งวันนี้</CardTitle>
            <Truck className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12 เที่ยว</div>
            <p className="text-xs text-muted-foreground">+2 จากเมื่อวาน</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ระยะทางรวม (กม.)</CardTitle>
            <MapPin className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">458.2 กม.</div>
            <p className="text-xs text-muted-foreground">ในเดือนนี้</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">อัตราความตรงต่อเวลา</CardTitle>
            <TrendingUp className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">94%</div>
            <p className="text-xs text-green-500">+1.2% จากเดือนที่แล้ว</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ไซน์งานที่ดูแล</CardTitle>
            <Calendar className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">24 แห่ง</div>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>สถิติการส่งของรายสัปดาห์</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
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
                    strokeWidth={2} 
                    dot={{ fill: '#F0890D' }} 
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
            <CardDescription>จำนวนครั้งที่ส่งของแยกตามโครงการ</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={siteVisits} layout="vertical">
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
                    {siteVisits.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>สถานะการส่งวันนี้</CardTitle>
              <CardDescription>อัปเดตแบบเรียลไทม์</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/trips/history">
                ดูทั้งหมด <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { id: 'T-1001', site: 'โครงการ ABC สุขุมวิท', status: 'Completed', time: '09:30', driver: 'สมชาย' },
                { id: 'T-1002', site: 'ไซน์งานบางนา', status: 'In Progress', time: '11:15', driver: 'วิชัย' },
                { id: 'T-1003', site: 'คลังสินค้าหลัก', status: 'Planned', time: '14:00', driver: 'มานะ' },
              ].map((trip) => (
                <div key={trip.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "p-2 rounded-full",
                      trip.status === 'Completed' ? "bg-green-500/10 text-green-500" :
                      trip.status === 'In Progress' ? "bg-blue-500/10 text-blue-500" : "bg-orange-500/10 text-orange-500"
                    )}>
                      {trip.status === 'Completed' ? <CheckCircle2 className="h-5 w-5" /> :
                       trip.status === 'In Progress' ? <Clock className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{trip.site}</p>
                      <p className="text-xs text-muted-foreground">{trip.id} • คนขับ: {trip.driver}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{trip.time}</p>
                    <p className="text-xs text-muted-foreground">{trip.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Insights ล่าสุด (AI Analysis)</CardTitle>
            <CardDescription>ข้อมูลวิเคราะห์จากการขนส่งสัปดาห์ที่ผ่านมา</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 rounded-lg border border-accent/20 bg-accent/5">
                <h4 className="font-semibold text-accent mb-1">ประสิทธิภาพคนขับ</h4>
                <p className="text-sm text-muted-foreground">
                  "คุณสมชาย ทำเวลาได้ดีกว่าค่าเฉลี่ย 15% ในเส้นทางสุขุมวิท"
                </p>
              </div>
              <div className="p-4 rounded-lg border border-primary/20 bg-primary/5">
                <h4 className="font-semibold text-primary-foreground mb-1">จุดติดขัดที่ควรระวัง</h4>
                <p className="text-sm text-muted-foreground">
                  "ไซน์งานบางนา มักจะเกิดความล่าช้าในช่วงเวลา 10:00 - 11:00 น. เนื่องจากการรอเข้าคิวลงของ"
                </p>
              </div>
              <div className="p-4 rounded-lg border border-green-500/20 bg-green-500/5">
                <h4 className="font-semibold text-green-500 mb-1">ข้อเสนอแนะเพื่อลดต้นทุน</h4>
                <p className="text-sm text-muted-foreground">
                  "การจัดเส้นทางแบบ Multi-stop ในวันอังคารจะช่วยลดระยะทางวิ่งเปล่าได้ถึง 22 กม."
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
