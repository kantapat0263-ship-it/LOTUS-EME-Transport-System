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
  MapPin,
  Send,
  Copy,
  Check,
  QrCode,
  Image as ImageIcon,
  ClipboardList
} from "lucide-react"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Trip } from "@/types/models"
import { cn } from "@/lib/utils"

export default function DailySummaryPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const [selectedDate, setSelectedDate] = React.useState(new Date().toISOString().split('T')[0])
  const [trips, setTrips] = React.useState<Trip[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [isSavingImage, setIsSavingImage] = React.useState(false)

  // Share Modal State
  const [selectedTripForShare, setSelectedTripForShare] = React.useState<Trip | null>(null)
  const [copied, setCopied] = React.useState(false)

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
    // Handle YYYY-MM-DD
    if (dateStr.includes('-')) {
      const [y, m, d] = dateStr.split('-')
      return `${d}/${m}/${y}`
    }
    const d = new Date(dateStr)
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    return `${day}/${month}/${year}`
  }

  const handlePrint = () => {
    if (trips.length === 0) {
      toast({ title: "ไม่มีข้อมูล", description: "กรุณาโหลดข้อมูลก่อนทำการพิมพ์", variant: "destructive" })
      return
    }
    window.print()
  }

  const handleSaveImage = async () => {
    if (trips.length === 0) return
    setIsSavingImage(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const element = document.getElementById('summary-report')
      if (!element) return

      const canvas = await html2canvas(element, {
        scale: 2, // High resolution
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      })

      const image = canvas.toDataURL('image/jpeg', 0.95)
      const link = document.createElement('a')
      link.download = `คิวรถประจำวัน_${selectedDate}.jpg`
      link.href = image
      link.click()
      
      toast({ title: "สำเร็จ", description: "บันทึกเป็นรูปภาพเรียบร้อยแล้ว" })
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถบันทึกรูปภาพได้", variant: "destructive" })
    } finally {
      setIsSavingImage(false)
    }
  }

  const handleShareClick = (trip: Trip) => {
    setSelectedTripForShare(trip)
  }

  const handleCopyLink = () => {
    if (!selectedTripForShare) return
    const url = `https://lotus-eme-transport-system.vercel.app/driver/${selectedTripForShare.tripId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "คัดลอกลิงก์แล้ว", description: "ส่งลิงก์ให้คนขับได้เลย" });
  };

  // Calculate statistics
  const totalDistance = trips.reduce((sum, t) => sum + (t.totalDistanceKm || 0), 0)
  const uniqueDrivers = new Set(trips.map(t => t.driverName)).size

  const shareUrl = selectedTripForShare 
    ? `https://lotus-eme-transport-system.vercel.app/driver/${selectedTripForShare.tripId}`
    : '';

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
            <div className="grid grid-cols-1 gap-3 pt-2">
              <Button 
                className="bg-[#F0890D] hover:bg-[#F0890D]/90 h-11" 
                onClick={fetchTrips}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                โหลดข้อมูล
              </Button>
              
              <div className="grid grid-cols-2 gap-3">
                <Button 
                  variant="outline"
                  className="border-accent text-accent hover:bg-accent/10 h-11"
                  onClick={handlePrint}
                  disabled={trips.length === 0}
                >
                  <Printer className="mr-2 h-4 w-4" /> พิมพ์/PDF
                </Button>
                <Button 
                  variant="outline"
                  className="border-green-600 text-green-500 hover:bg-green-600/10 h-11"
                  onClick={handleSaveImage}
                  disabled={trips.length === 0 || isSavingImage}
                >
                  {isSavingImage ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="mr-2 h-4 w-4" />
                  )}
                  {isSavingImage ? "กำลังบันทึก..." : "บันทึกรูปภาพ"}
                </Button>
              </div>
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
                    <p className="text-sm font-semibold">วันที่ {formatThaiDate(selectedDate)} (ค.ศ.)</p>
                  </div>

                  <table className="w-full border-collapse border-2 border-black text-[12px]">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-black p-2 w-[12%] text-center">วัน เดือน ปี<br/>ที่ใช้รถ</th>
                        <th className="border border-black p-2 w-[8%] text-center">เวลา</th>
                        <th className="border border-black p-2 w-[55%] text-left">รายละเอียดของงานที่ปฏิบัติ<br/><span className="font-normal text-[10px]">ลักษณะงาน (แยกเป็นข้อ ๆ) และ สถานที่</span></th>
                        <th className="border border-black p-2 w-[25%] text-left">ผู้ปฏิบัติงาน / ทะเบียนรถ<br/><span className="font-normal text-[10px]">ผู้ขอใช้รถ / ส่งงาน</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {trips.map((trip, idx) => {
                        // Extract all unique requesters for summary column
                        const summaryRequesters = Array.from(new Set([
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
                                const stopRequester = stop.requestedBy || (trip as any).requestedBy || ""
                                
                                // Fetch notes from either stop or trip object
                                const requesterNote = (stop as any).note || (stop as any).notes || ""
                                const dNote = (stop as any).dispatcherNote || (trip as any).dispatcherNote || ""
                                const dName = (stop as any).dispatcherName || (trip as any).dispatcherName || ""
                                
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
                                      {stopRequester && (
                                        <div className="pl-3 text-[10px] text-gray-500 italic flex items-center gap-1 mt-0.5">
                                          <ClipboardList className="h-2.5 w-2.5" />
                                          <span>ผู้ขอ: {stopRequester}</span>
                                        </div>
                                      )}

                                      {/* Note from requester */}
                                      {requesterNote && requesterNote.trim() !== '' && (
                                        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }} className="pl-3">
                                          📌 หมายเหตุผู้ขอ: {requesterNote}
                                        </div>
                                      )}

                                      {/* Note from Dispatcher */}
                                      {dNote && dNote.trim() !== '' && (
                                        <div style={{ fontSize: '11px', color: '#1a56db', marginTop: '2px' }} className="pl-3">
                                          ✏️ บันทึก {dName || "จัดรถ"}: {dNote}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                              {trip.stops?.length === 0 && <div className="text-gray-400 italic">ไม่มีข้อมูลจุดส่งของ</div>}
                            </td>
                            <td className="border border-black p-2 align-top">
                              <div className="flex justify-between items-start">
                                <div className="space-y-2">
                                  <div>
                                    <p className="font-bold">คนขับ: {trip.driverName}</p>
                                    <p className="font-bold">ทะเบียน: {trip.vehiclePlate}</p>
                                  </div>
                                  <div className="pt-2 border-t border-gray-200">
                                    <p className="text-[10px] font-bold text-gray-500 uppercase">ผู้ขอใช้รถ:</p>
                                    <p className="leading-tight">{summaryRequesters || "-"}</p>
                                  </div>
                                </div>
                                <Button 
                                  variant="outline" 
                                  size="icon" 
                                  className="no-print h-8 w-8 shrink-0 border-blue-500 text-blue-600 hover:bg-blue-50"
                                  onClick={() => handleShareClick(trip)}
                                  title="ส่งใบงานให้คนขับ"
                                >
                                  <Send className="h-4 w-4" />
                                </Button>
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

      {/* Share Dialog */}
      <Dialog open={!!selectedTripForShare} onOpenChange={(open) => !open && setSelectedTripForShare(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-500" /> ส่งใบงานให้คนขับ
            </DialogTitle>
            <DialogDescription>
              Trip ID: <span className="font-bold text-gray-900">{selectedTripForShare?.tripId}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Link สำหรับคนขับ</p>
              <div className="flex items-center gap-2 p-3 bg-secondary/30 rounded-xl border border-border/50">
                <p className="text-sm font-medium truncate flex-1 text-blue-400">{shareUrl}</p>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 hover:bg-blue-500/10" onClick={handleCopyLink}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-blue-500" />}
                </Button>
              </div>
            </div>

            <div className="flex flex-col items-center gap-4 py-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">QR Code</p>
              <div className="bg-white p-4 rounded-2xl shadow-inner border border-gray-100">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`}
                  alt="Trip QR Code"
                  className="w-40 h-40"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="w-full h-11" onClick={() => setSelectedTripForShare(null)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
