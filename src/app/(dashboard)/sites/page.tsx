"use client"

import * as React from "react"
import { Plus, Search, MapPin, Filter, MoreHorizontal, Edit, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Site, ProjectType } from "@/types/models"

const MOCK_SITES: Site[] = [
  { id: '1', name: 'โครงการ ABC สุขุมวิท 50', address: 'Sukhumvit 50, Bangkok', lat: 13.705, lng: 100.595, projectType: 'Electrical', status: 'Active' },
  { id: '2', name: 'อาคารสำนักงาน XYZ บางนา', address: 'Bang Na-Trat Rd, Bangkok', lat: 13.668, lng: 100.621, projectType: 'HVAC', status: 'Active' },
  { id: '3', name: 'The Base Park West', address: 'On Nut, Bangkok', lat: 13.714, lng: 100.602, projectType: 'Plumbing', status: 'Inactive' },
  { id: '4', name: 'คอนโด Rhythm เอกมัย', address: 'Ekkamai, Bangkok', lat: 13.731, lng: 100.585, projectType: 'Mixed', status: 'Active' },
]

export default function SitesPage() {
  const [searchTerm, setSearchTerm] = React.useState("")

  const filteredSites = MOCK_SITES.filter(site => 
    site.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    site.address.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getTagColor = (type: ProjectType) => {
    switch (type) {
      case 'Electrical': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'Plumbing': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'HVAC': return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
      case 'Mixed': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
      default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">จัดการไซน์งาน</h2>
          <p className="text-muted-foreground">เพิ่ม แก้ไข และจัดการข้อมูลไซน์งานก่อสร้างทั้งหมด</p>
        </div>
        <Button className="bg-accent hover:bg-accent/90">
          <Plus className="mr-2 h-4 w-4" /> เพิ่มไซน์งานใหม่
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 border-b">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาชื่อไซน์งาน หรือ ที่อยู่..." 
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
              <Button variant="outline" size="sm">
                <Filter className="mr-2 h-4 w-4" /> กรองข้อมูล
              </Button>
              <Button variant="outline" size="sm">
                <MapPin className="mr-2 h-4 w-4" /> ดูในแผนที่
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อไซน์งาน</TableHead>
                <TableHead>ประเภทโครงการ</TableHead>
                <TableHead>ที่อยู่</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSites.map((site) => (
                <TableRow key={site.id}>
                  <TableCell className="font-medium">{site.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={getTagColor(site.projectType)}>
                      {site.projectType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{site.address}</TableCell>
                  <TableCell>
                    <Badge variant={site.status === 'Active' ? 'default' : 'secondary'} className={site.status === 'Active' ? 'bg-green-500 hover:bg-green-600' : ''}>
                      {site.status === 'Active' ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Edit className="mr-2 h-4 w-4" /> แก้ไขข้อมูล
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" /> ลบข้อมูล
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filteredSites.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    ไม่พบข้อมูลไซน์งานที่ค้นหา
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}