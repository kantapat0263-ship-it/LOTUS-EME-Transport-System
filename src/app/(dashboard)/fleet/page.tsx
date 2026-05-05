"use client"

import * as React from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, Truck, User, Phone, Weight, MoreHorizontal, Edit, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const MOCK_VEHICLES = [
  { id: '1', plate: '1กก 1234', type: 'Pickup', maxLoad: 1500, driver: 'สมชาย รักดี', status: 'Available' },
  { id: '2', plate: 'ผห 5678', type: '4-wheel truck', maxLoad: 3500, driver: 'วิชัย ใจตรง', status: 'On Trip' },
  { id: '3', plate: '7กก 9012', type: '6-wheel truck', maxLoad: 7000, driver: 'ยังไม่ระบุ', status: 'Maintenance' },
]

const MOCK_DRIVERS = [
  { id: '1', name: 'สมชาย รักดี', phone: '081-234-5678', vehicle: '1กก 1234', status: 'Active' },
  { id: '2', name: 'วิชัย ใจตรง', phone: '089-876-5432', vehicle: 'ผห 5678', status: 'Active' },
  { id: '3', name: 'มานะ ขยันงาน', phone: '085-555-1212', vehicle: '-', status: 'Off Duty' },
]

export default function FleetPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">ฟลีทรถและคนขับ</h2>
          <p className="text-muted-foreground">จัดการยานพาหนะและการมอบหมายงานให้คนขับ</p>
        </div>
      </div>

      <Tabs defaultValue="vehicles" className="space-y-4">
        <TabsList className="bg-secondary/50 p-1">
          <TabsTrigger value="vehicles" className="data-[state=active]:bg-accent">ยานพาหนะ (Vehicles)</TabsTrigger>
          <TabsTrigger value="drivers" className="data-[state=active]:bg-accent">คนขับ (Drivers)</TabsTrigger>
        </TabsList>

        <TabsContent value="vehicles" className="space-y-4">
          <div className="flex justify-end">
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" /> เพิ่มรถยนต์ใหม่
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MOCK_VEHICLES.map((v) => (
              <Card key={v.id} className="relative overflow-hidden group hover:border-accent/50 transition-all">
                <div className={cn(
                  "absolute top-0 right-0 h-24 w-24 -mr-8 -mt-8 rounded-full opacity-10",
                  v.status === 'Available' ? "bg-green-500" : v.status === 'On Trip' ? "bg-blue-500" : "bg-red-500"
                )} />
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <Badge variant="outline" className="mb-2 uppercase tracking-wider text-[10px]">{v.type}</Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem><Edit className="mr-2 h-4 w-4" /> แก้ไข</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> ลบ</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <CardTitle className="text-2xl font-bold text-accent">{v.plate}</CardTitle>
                  <CardDescription>ID: {v.id}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Weight className="h-4 w-4" />
                    <span>น้ำหนักบรรทุกสูงสุด: <strong>{v.maxLoad.toLocaleString()} kg</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="h-4 w-4" />
                    <span>คนขับประจำ: <strong>{v.driver}</strong></span>
                  </div>
                  <div className="pt-2">
                    <Badge className={cn(
                      "font-semibold",
                      v.status === 'Available' ? "bg-green-500" : 
                      v.status === 'On Trip' ? "bg-blue-500" : "bg-red-500"
                    )}>
                      {v.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="drivers" className="space-y-4">
          <div className="flex justify-end">
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" /> เพิ่มคนขับใหม่
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MOCK_DRIVERS.map((d) => (
              <Card key={d.id} className="relative overflow-hidden group hover:border-accent/50 transition-all">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-xl font-bold text-accent">
                      {d.name.charAt(0)}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem><Edit className="mr-2 h-4 w-4" /> แก้ไข</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> ลบ</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <CardTitle className="text-xl font-bold mt-2">{d.name}</CardTitle>
                  <Badge variant={d.status === 'Active' ? 'default' : 'secondary'} className={d.status === 'Active' ? 'bg-green-500' : ''}>
                    {d.status}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3 pt-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4 text-accent" />
                    <span>เบอร์โทรศัพท์: <strong>{d.phone}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Truck className="h-4 w-4 text-accent" />
                    <span>รถที่ดูแล: <strong>{d.vehicle}</strong></span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
