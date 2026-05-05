"use client"

import * as React from "react"
import { Search, Filter, Calendar, MapPin, Truck, ChevronRight, FileText, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"

const MOCK_TRIPS = [
  { id: 'T-1001', date: '2024-05-15', driver: 'สมชาย รักดี', vehicle: '1กก 1234', stops: 3, distance: 45.2, status: 'Completed', site: 'โครงการ ABC' },
  { id: 'T-1002', date: '2024-05-15', driver: 'วิชัย ใจตรง', vehicle: 'ผห 5678', stops: 2, distance: 32.8, status: 'In Progress', site: 'ไซน์งานบางนา' },
  { id: 'T-1003', date: '2024-05-16', driver: 'สมชาย รักดี', vehicle: '1กก 1234', stops: 1, distance: 15.0, status: 'Planned', site: 'คลังสินค้าหลัก' },
  { id: 'T-1004', date: '2024-05-14', driver: 'วิชัย ใจตรง', vehicle: 'ผห 5678', stops: 4, distance: 68.5, status: 'Completed', site: 'The Base Park' },
]

export default function TripHistoryPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">ประวัติการส่งของ</h2>
          <p className="text-muted-foreground">รายการเที่ยววิ่งทั้งหมดและการติดตามสถานะ</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหา Trip ID, คนขับ..." className="pl-10" />
            </div>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="สถานะทั้งหมด" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">สถานะทั้งหมด</SelectItem>
                <SelectItem value="Planned">Planned</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input type="date" className="pl-10" />
            </div>
            <Button variant="outline" className="w-full">
              <Filter className="mr-2 h-4 w-4" /> กรองเพิ่มเติม
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {MOCK_TRIPS.map((trip) => (
          <Card key={trip.id} className="hover:border-accent/30 transition-all cursor-pointer overflow-hidden group">
            <div className="flex flex-col md:flex-row items-center p-4 gap-4">
              <div className="flex items-center gap-4 w-full md:w-auto">
                <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center">
                  <Truck className="h-6 w-6 text-accent" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">{trip.id}</span>
                    <Badge variant={trip.status === 'Completed' ? 'default' : trip.status === 'In Progress' ? 'secondary' : 'outline'}
                      className={trip.status === 'Completed' ? 'bg-green-500 hover:bg-green-600' : ''}>
                      {trip.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{trip.date} • {trip.site}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-8 flex-1 w-full md:w-auto">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">คนขับ</p>
                  <p className="text-sm font-medium">{trip.driver}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">พาหนะ</p>
                  <p className="text-sm font-medium">{trip.vehicle}</p>
                </div>
                <div className="hidden md:block">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">ระยะทาง / จุดส่ง</p>
                  <p className="text-sm font-medium">{trip.distance} กม. / {trip.stops} จุด</p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                <Button variant="ghost" size="sm" className="hidden sm:flex">
                  <FileText className="mr-2 h-4 w-4" /> ใบงาน
                </Button>
                <Button variant="ghost" size="icon" className="group-hover:translate-x-1 transition-transform">
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}