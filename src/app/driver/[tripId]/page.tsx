
"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { initializeFirebase } from "@/firebase"
import { doc, getDoc } from "firebase/firestore"
import { Trip } from "@/types/models"
import { 
  MapPin, 
  Truck, 
  User, 
  Calendar, 
  Clock, 
  Navigation, 
  Phone,
  ArrowLeft,
  AlertCircle,
  FileText
} from "lucide-react"
import { cn } from "@/lib/utils"

// Note: Firestore rules must allow public read for /trips
// Admin should update rules to:
// match /trips/{tripId} {
//   allow read: if true;  // public read
//   allow write: if request.auth != null;
// }

export default function DriverTripPage() {
  const params = useParams()
  const tripId = params.tripId as string
  const [trip, setTrip] = React.useState<Trip | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function fetchTrip() {
      try {
        const { firestore } = initializeFirebase()
        const docRef = doc(firestore, "trips", tripId)
        const docSnap = await getDoc(docRef)

        if (docSnap.exists()) {
          setTrip({ ...docSnap.data(), id: docSnap.id } as Trip)
        } else {
          setError(`ไม่พบข้อมูลเที่ยววิ่ง ${tripId}`)
        }
      } catch (err) {
        console.error(err)
        setError("เกิดข้อผิดพลาดในการโหลดข้อมูล")
      } finally {
        setIsLoading(false)
      }
    }

    if (tripId) fetchTrip()
  }, [tripId])

  const formatDuration = (minutes?: number) => {
    if (!minutes) return "-"
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error || !trip) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center">
        <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">{error}</h1>
        <p className="text-gray-500">กรุณาตรวจสอบลิงก์ หรือติดต่อผู้จัดรถ</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex justify-center font-sans antialiased">
      <div className="w-full max-w-[480px] bg-white shadow-lg min-h-screen pb-12">
        {/* Header */}
        <header className="bg-blue-700 text-white p-6 rounded-b-3xl shadow-md">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-white/20 p-2 rounded-xl">
              <Truck className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-none">LOTUS GROUP</h1>
              <p className="text-blue-100 text-sm font-medium mt-1">ใบงานคนขับขนส่ง</p>
            </div>
          </div>
          
          <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-sm border border-white/10 space-y-3">
            <div className="flex justify-between items-center border-b border-white/10 pb-2">
              <span className="text-blue-100 text-xs font-bold uppercase tracking-wider">Trip ID</span>
              <span className="text-xl font-black">{trip.tripId}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-blue-100 text-[10px] font-bold uppercase">วันที่</p>
                <p className="text-sm font-bold flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {trip.tripDate}</p>
              </div>
              <div className="space-y-1">
                <p className="text-blue-100 text-[10px] font-bold uppercase">เวลาออกรถ</p>
                <p className="text-sm font-bold flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {(trip as any).departureTime || "08:30"} น.</p>
              </div>
            </div>
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="bg-white p-1 rounded-full">
                    <User className="h-3.5 w-3.5 text-blue-700" />
                  </div>
                  <div>
                    <p className="text-blue-100 text-[10px] font-bold uppercase">คนขับรถ</p>
                    <p className="text-sm font-bold">{trip.driverName}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-blue-100 text-[10px] font-bold uppercase">ทะเบียนรถ</p>
                  <p className="text-sm font-bold underline decoration-accent underline-offset-4">{trip.vehiclePlate}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Stops List */}
        <main className="p-4 space-y-6">
          <div className="flex items-center justify-between px-2 pt-2">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Navigation className="h-5 w-5 text-blue-600" /> ลำดับจุดส่งของ ({trip.stops?.length || 0})
            </h2>
          </div>

          <div className="space-y-4">
            {trip.stops?.map((stop, index) => (
              <section 
                key={index} 
                className="relative bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
              >
                <div className="absolute left-0 top-0 bottom-0 w-2 bg-blue-600" />
                
                <div className="p-5">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg shrink-0">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-blue-600 text-xs font-black uppercase tracking-wider mb-1">📍 สถานที่</p>
                        <h3 className="text-xl font-bold text-gray-900 leading-tight">{stop.siteName}</h3>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div>
                      <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">📦 รายละเอียดงาน</p>
                      <p className="text-base font-medium text-gray-800 whitespace-pre-wrap leading-snug">
                        {stop.cargoDetails || "ส่งวัสดุตามใบเบิก"}
                      </p>
                    </div>
                    {stop.requestedBy && (
                      <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                        <User className="h-3 w-3 text-gray-400" />
                        <span className="text-xs text-gray-500">ผู้ขอใช้งาน: <strong className="text-gray-700">{stop.requestedBy}</strong></span>
                      </div>
                    )}
                  </div>

                  <a 
                    href={(stop as any).lat && (stop as any).lng 
                      ? `https://www.google.com/maps/dir/?api=1&destination=${(stop as any).lat},${(stop as any).lng}&travelmode=driving`
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.siteName)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full h-[52px] bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-200 transition-colors"
                  >
                    <Navigation className="h-5 w-5" />
                    นำทางด้วย Google Maps
                  </a>
                </div>
              </section>
            ))}
          </div>

          {/* Footer Stats */}
          <div className="pt-4 px-2">
            <div className="bg-gray-900 text-white rounded-2xl p-6 space-y-3 shadow-xl">
              <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest border-b border-white/10 pb-2 mb-3">สรุปแผนการเดินทาง</h3>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">ระยะทางรวม (กม.)</span>
                <span className="text-xl font-bold">{trip.totalDistanceKm?.toFixed(1) || "-"} กม.</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">ประมาณเวลาเดินทาง</span>
                <span className="text-xl font-bold">{formatDuration(trip.totalEstimatedTimeMinutes)}</span>
              </div>
            </div>
            
            <div className="mt-8 text-center text-gray-400 text-xs px-8">
              <p>กรุณาตรวจสอบความถูกต้องของพิกัดก่อนออกเดินทาง</p>
              <p className="mt-1">หากมีข้อสงสัยติดต่อฝ่ายจัดรถ</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
