"use client"

import * as React from "react"
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, getDocs } from "firebase/firestore"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { 
  FileText, 
  Printer, 
  Search, 
  Loader2, 
  Calendar as CalendarIcon,
  AlertCircle,
  Truck,
  User as UserIcon,
  MapPin
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Trip } from "@/types/models"
import { cn } from "@/lib/utils"

export default function DailySummaryPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const [selectedDate, setSelectedDate] = React.useState(new Date().toISOString().split('T')[0])
  const [trips, setTrips] = React.useState<Trip[]>([])
  const [isLoading, setIsLoading] = React.useState(false)

  const fetchTrips = async () => {
    setIsLoading(true)
    try {
      // Use basic query to avoid potential index errors
      const q = query(
        collection(db, "trips"),
        where("tripDate", "==", selectedDate)
      )
      
      const snapshot = await getDocs(q)
      const results = snapshot.docs
        .map(doc => ({ ...doc.data(), id: doc.id } as Trip))
        .filter(trip => trip.status !== 'Cancelled')
        // Sort in memory: first by departure time (if exists), then by status
        .sort((a, b) => {
          const timeA = (a as any).departureTime || "08:30"
          const timeB = (b as any).departureTime || "08:30"
          return timeA.localeCompare(timeB)
        })

      setTrips(results)
      if (results.length === 0) {
        toast({ title: "ไม่พบข้อมูล", description: "ไม่มีเที่ยววิ่งสำหรับวันที่เลือก" })
      }
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถโหลดข้อมูลได้", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  const formatThaiDate = (dateStr: string) => {
    if (!dateStr) return ""
    const d = new Date(dateStr)
    const day = d.getDate()
    const month = d.getMonth() + 1
    const year = (d.getFullYear() + 543).toString().slice(-2)
    return `${day}/${month}/${year}`
  }

  const handlePrint = () => {
    if (trips.length === 0) {
      toast({ title: "ไม่มีข้อมูล", description: "กรุณาโหลดข้อมูลก่อนทำการพิมพ์", variant: "destructive" })
      return
    }
    window.print()
  }

  // Calculate statistics
  const totalDistance = trips.reduce((sum, t) => sum + (t.totalDistanceKm || 0), 0)
  const uniqueDrivers = new Set(trips.map(t => t.driverName)).size

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">สรุปคิวรถประจำวัน</h2>
          <p className="text-sm md:text-base text-muted-foreground">ตรวจสอบตารางวิ่งรถและพิมพ์รายงานใบงานประจำวัน</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Controls */}
        <Card className="lg:col-span-4 no-print">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-accent" /> ตั้งค่ารายงาน
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="report-date">เลือกวันที่</Label>
              <Input 
                id="report-date" 
                type="date" 
                className="h-11"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <Button 
                className="bg-[#F0890D] hover:bg-[#F0890D]/90 h-11" 
                onClick={fetchTrips}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                โหลดข้อมูล
              </Button>
              <Button 
                variant="outline"
                className="border-accent text-accent hover:bg-accent/10 h-11"
                onClick={handlePrint}
                disabled={trips.length === 0}
              >
                <Printer className="mr-2 h-4 w-4" /> พิมพ์ / PDF
              </Button>
            </div>

            {trips.length > 0 && (
              <div className="pt-4 border-t border-border/50 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-secondary/20 p-3 rounded-lg border border-border/50">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">จำนวนเที่ยววิ่ง</p>
                    <p className="text-xl font-bold text-accent">{trips.length}</p>
                  </div>
                  <div className="bg-secondary/20 p-3 rounded-lg border border-border/50">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">จำนวนคนขับ</p>
                    <p className="text-xl font-bold text-accent">{uniqueDrivers}</p>
                  </div>
                </div>
                <div className="bg-accent/5 p-3 rounded-lg border border-accent/20">
                  <p className="text-[10px] text-accent uppercase font-bold">ระยะทางรวมทั้งหมด</p>
                  <p className="text-xl font-bold text-white">{totalDistance.toFixed(1)} กม.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Preview Area */}
        <div className="lg:col-span-8 space-y-4 min-h-[500px]">
          <div className="no-print bg-secondary/10 border border-dashed rounded-xl p-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <AlertCircle className="h-3 w-3" /> ตัวอย่างใบงาน (Preview) สำหรับพิมพ์ลงกระดาษ A4
          </div>

          <Card className={cn(
            "overflow-hidden transition-all",
            trips.length === 0 && "opacity-40 grayscale"
          )}>
            <CardContent className="p-0 bg-white text-black min-h-[600px] overflow-x-auto">
              {trips.length > 0 ? (
                <div className="w-full min-w-[800px] p-8 print:p-0 bg-white" id="summary-report">
                  <div className="text-center mb-6 space-y-1">
                    <h1 className="text-xl font-bold uppercase underline decoration-2 underline-offset-4">บันทึกใช้รถยนต์ประจำวัน</h1>
                    <h2 className="text-lg font-bold">LOTUS GROUP / LOTUS EME</h2>
                    <p className="text-sm font-semibold">วันที่ {formatThaiDate(selectedDate)} (พ.ศ.)</p>
                  </div>

                  <table className="w-full border-collapse border-2 border-black text-[12px]">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-black p-2 w-[12%] text-center">วัน เดือน ปี<br/>ที่ใช้รถ</th>
                        <th className="border border-black p-2 w-[8%] text-center">เวลา</th>
                        <th className="border border-black p-2 w-[55%] text-left">รายละเอียดของงานที่ปฏิบัติ<br/><span className="font-normal text-[10px]">ลักษณะงาน (แยกเป็นข้อ ๆ) และ สถานที่</span></th>
                        <th className="border border-black p-2 w-[25%] text-left">ผู้ปฏิบัติงาน / ทะเบียนรถ<br/><span className="font-normal text-[10px]">ผู้ขอใช้รถ</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {trips.map((trip, idx) => {
                        // Extract all requesters for this trip
                        const requesters = Array.from(new Set([
                          (trip as any).requestedBy,
                          ...(trip.stops || []).map((s: any) => s.requestedBy).filter(Boolean)
                        ])).filter(Boolean).join(", ")

                        return (
                          <tr key={trip.id}>
                            <td className="border border-black p-2 text-center align-top">
                              {formatThaiDate(trip.tripDate)}
                            </td>
                            <td className="border border-black p-2 text-center align-top">
                              {(trip as any).departureTime || "08:30"} น.
                            </td>
                            <td className="border border-black p-2 align-top space-y-4">
                              {(trip.stops || []).map((stop, sIdx) => {
                                const locationText = (stop as any).address || (stop as any).zone || ""
                                return (
                                  <div key={sIdx} className="space-y-1">
                                    <div className="flex gap-1.5 font-bold">
                                      <span>{sIdx + 1}.</span>
                                      <span>{stop.siteName}</span>
                                    </div>
                                    <div className="pl-5 space-y-0.5">
                                      <div className="flex gap-2">
                                        <span className="shrink-0">-</span>
                                        <span className="italic">{stop.cargoDetails || "ส่งวัสดุ/ปฏิบัติงานตามแผน"}</span>
                                      </div>
                                      {locationText && (
                                        <div className="pl-3 text-[10px] text-gray-600">
                                          {locationText}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                              {trip.stops?.length === 0 && <div className="text-gray-400 italic">ไม่มีข้อมูลจุดส่งของ</div>}
                            </td>
                            <td className="border border-black p-2 align-top space-y-2">
                              <div>
                                <p className="font-bold">คนขับ: {trip.driverName}</p>
                                <p className="font-bold">ทะเบียน: {trip.vehiclePlate}</p>
                              </div>
                              <div className="pt-2 border-t border-gray-200">
                                <p className="text-[10px] font-bold text-gray-500 uppercase">ผู้ขอใช้รถ:</p>
                                <p className="leading-tight">{requesters || "-"}</p>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  <div className="mt-8 flex justify-between text-sm">
                    <div className="space-y-1 font-bold">
                      <p>รวม: {trips.length} เที่ยว</p>
                      <p>ระยะทางรวม: {totalDistance.toFixed(1)} กม.</p>
                    </div>
                    <div className="flex gap-12">
                      <div className="text-center w-48">
                        <div className="h-10 border-b border-black mb-2"></div>
                        <p>ลายเซ็นผู้อนุมัติ</p>
                        <p className="text-xs">วันที่ ______/______/______</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 text-[10px] text-gray-400 italic text-right">
                    * รายงานสร้างจากระบบ LOTUS GROUP Transport Management
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-32 text-gray-400">
                  <FileText className="h-16 w-16 mb-4 opacity-20" />
                  <p className="text-lg font-medium">ไม่มีข้อมูลเที่ยววิ่งสำหรับวันที่เลือก</p>
                  <p className="text-sm">กรุณาเลือกวันที่และกด "โหลดข้อมูล"</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm 15mm 10mm 15mm;
          }
          body {
            background-color: white !important;
            color: black !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .card {
            border: none !important;
            box-shadow: none !important;
          }
          #summary-report {
            padding: 0 !important;
            min-width: 100% !important;
          }
          table {
            width: 100% !important;
            table-layout: fixed;
          }
        }
      `}</style>
    </div>
  )
}
