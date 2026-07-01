"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { initializeFirebase } from "@/firebase"
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore"
import { Trip, Driver } from "@/types/models"
import { computeDriverLeaderboard, monthRange, incomingStopsForTrip, computeOutcomeStats, type DriverStat, type IncomingJob } from "@/lib/calculations"
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
  FileText,
  Info,
  Repeat
} from "lucide-react"
import { cn } from "@/lib/utils"

// Helper to format date YYYY-MM-DD to DD/MM/YYYY
function formatDateDisplay(dateStr: string) {
  if (!dateStr) return "-";
  if (dateStr.includes('-')) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

export default function DriverTripPage() {
  const params = useParams()
  const tripId = params.tripId as string
  const [trip, setTrip] = React.useState<Trip | null>(null)
  const [driverPhone, setDriverPhone] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  // Monthly motivation stats (positive-only; refusals never shown to the driver)
  const [myStat, setMyStat] = React.useState<DriverStat | null>(null)
  const [boardSize, setBoardSize] = React.useState(0)
  const [topKm, setTopKm] = React.useState(0)
  // Jobs other trucks handed to this driver today (public-safe: shown as "รับงานต่อ")
  const [incoming, setIncoming] = React.useState<IncomingJob[]>([])
  // Actual km for this trip after work moved in/out (null = fall back to planned)
  const [actualKm, setActualKm] = React.useState<number | null>(null)

  React.useEffect(() => {
    async function fetchTrip() {
      try {
        const { firestore } = initializeFirebase()
        const docRef = doc(firestore, "trips", tripId)
        const docSnap = await getDoc(docRef)

        if (docSnap.exists()) {
          const tripData = { ...docSnap.data(), id: docSnap.id } as Trip
          setTrip(tripData)
          
          // Fetch driver phone
          if (tripData.driverId) {
            const dRef = doc(firestore, "drivers", tripData.driverId)
            const dSnap = await getDoc(dRef)
            if (dSnap.exists()) {
              setDriverPhone(dSnap.data().phoneNumber || "")
            }
          }

          // Best-effort monthly leaderboard (this driver's own stats + rank)
          try {
            if (tripData.tripDate && tripData.driverId) {
              const { start, end } = monthRange(tripData.tripDate)
              const mSnap = await getDocs(query(
                collection(firestore, "trips"),
                where("tripDate", ">=", start),
                where("tripDate", "<=", end),
              ))
              const monthTrips = mSnap.docs.map(d => ({ ...d.data(), id: d.id })) as any[]
              const board = computeDriverLeaderboard(monthTrips)
              setMyStat(board.find(b => b.driverId === tripData.driverId) || null)
              setBoardSize(board.length)
              setTopKm(board[0]?.actualKm || 0)
              // Surface jobs reassigned *into* this trip (the destination half)
              setIncoming(incomingStopsForTrip(monthTrips, tripData.id))
              // Actual km after work moved in/out (own delivered + รับต่อ − โยกออก)
              setActualKm(computeOutcomeStats(monthTrips).actualKmByTrip[tripData.id] ?? null)
            }
          } catch (statErr) {
            console.error("stats unavailable", statErr)
          }
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

  const monthLabel = trip.tripDate
    ? new Date(trip.tripDate + "T00:00:00").toLocaleDateString("th-TH", { month: "long" })
    : ""

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
                <p className="text-sm font-bold flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {formatDateDisplay(trip.tripDate)}</p>
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
                    {driverPhone && <a href={`tel:${driverPhone}`} className="text-blue-200 text-[10px] font-bold underline">📞 {driverPhone}</a>}
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

        {/* ⭐ Personal monthly stats — positive only, motivational */}
        {myStat && (
          <div className="px-4 -mt-3 relative z-10">
            <div className="relative bg-gradient-to-br from-amber-400 to-orange-500 text-white rounded-2xl p-4 shadow-lg shadow-orange-200">
              <span className="absolute -top-2 -right-2 bg-rose-600 text-[10px] font-black px-2 py-0.5 rounded-full shadow">ของคุณ</span>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-black uppercase tracking-wider text-white/90">⭐ สถิติเดือนนี้{monthLabel ? ` (${monthLabel})` : ""}</p>
                <span className="bg-white/25 rounded-full px-3 py-1 text-sm font-black flex items-center gap-1">🏅 อันดับ {myStat.rank}/{boardSize}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-white/15 rounded-xl py-2">
                  <p className="text-2xl font-black leading-none">{Math.round(myStat.actualKm).toLocaleString()}</p>
                  <p className="text-[10px] mt-1 text-white/90">กม. ที่วิ่ง</p>
                </div>
                <div className="bg-white/15 rounded-xl py-2">
                  <p className="text-2xl font-black leading-none">{myStat.completedStops}</p>
                  <p className="text-[10px] mt-1 text-white/90">จุดส่งสำเร็จ</p>
                </div>
                <div className="bg-white/15 rounded-xl py-2">
                  <p className="text-2xl font-black leading-none">{myStat.workingDays}</p>
                  <p className="text-[10px] mt-1 text-white/90">วันออกงาน</p>
                </div>
              </div>
              <div className="mt-3 bg-black/15 rounded-xl px-3 py-2 flex items-center gap-2">
                {myStat.rank === 1 ? (
                  <>
                    <span className="text-lg">🏆</span>
                    <p className="text-xs font-bold">คุณคือ <span className="text-yellow-200 font-black">อันดับ 1</span> ของเดือนนี้! รักษาไว้นะ</p>
                  </>
                ) : (
                  <>
                    <span className="text-lg">🔥</span>
                    <p className="text-xs font-bold">อีก <span className="text-yellow-200 font-black">{Math.max(0, Math.ceil(topKm - myStat.actualKm)).toLocaleString()} กม.</span> แซงขึ้นอันดับ 1!</p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stops List */}
        <main className="p-4 space-y-6">
          {/* งานที่ถูกโยกมาให้คันนี้เพิ่ม — public-safe: โชว์ "รับงานต่อ" ไม่ใช่ "ปฏิเสธ" */}
          {incoming.length > 0 && (
            <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 overflow-hidden">
              <div className="bg-blue-600 text-white px-4 py-2.5 flex items-center gap-2">
                <Repeat className="h-5 w-5 shrink-0" />
                <span className="font-bold">รับงานต่อ {incoming.length} จุด — โยกมาให้คันนี้เพิ่ม</span>
              </div>
              <div className="p-3 space-y-2">
                {incoming.map((job, i) => (
                  <div key={i} className="bg-white rounded-xl border border-blue-200 p-3">
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                        {(trip.stops?.length || 0) + i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-bold text-gray-900 leading-tight">{job.siteName || "ไม่ระบุสถานที่"}</h3>
                        {job.cargoDetails && (
                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-snug mt-0.5">{job.cargoDetails}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {(job.fromVehiclePlate || job.fromDriverName) && (
                            <span className="text-[11px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              โยกจาก {job.fromVehiclePlate}{job.fromDriverName ? ` (${job.fromDriverName})` : ""}
                            </span>
                          )}
                          {job.siteName && (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.siteName)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-bold text-blue-600 hover:underline inline-flex items-center gap-1"
                            >
                              <Navigation className="h-3 w-3" /> นำทาง
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between px-2 pt-2">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Navigation className="h-5 w-5 text-blue-600" /> ลำดับจุดส่งของ ({trip.stops?.length || 0})
            </h2>
          </div>

          <div className="space-y-4">
            {trip.stops?.map((stop, index) => {
              const movedToPlate = (stop as any).reassignedToVehiclePlate
              const movedToDriver = (stop as any).reassignedToDriverName
              // ฝั่งต้นทาง: งานที่คันนี้ "โยกไปให้" คันอื่น (gate เดียวกับ badge ในใบสรุป)
              const movedAway = movedToPlate && (stop as any).outcome && (stop as any).outcome !== 'delivered'
              // หมายเหตุจัดรถ: อ่านจากแหล่ง canonical (trip.stopNotes) เหมือนใบสรุป + ชื่อคนจัดรถ
              const dispatcherNote = (trip as any)?.stopNotes?.[`stop_${index}`] || (stop as any).dispatcherNote
              const dispatcherBy = (trip as any)?.stopNoteAuthors?.[`stop_${index}`]
              return (
              <section
                key={index}
                className="relative bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
              >
                <div className={`absolute left-0 top-0 bottom-0 w-2 ${movedAway ? 'bg-amber-400' : 'bg-blue-600'}`} />
                
                <div className="p-5">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg shrink-0">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-blue-600 text-xs font-black uppercase tracking-wider">📍 สถานที่</p>
                          {(stop as any).requestTime && (
                            <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100">
                              ⏰ { (stop as any).requestTime } น.
                            </span>
                          )}
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 leading-tight">{stop.siteName}</h3>
                        {movedAway && (
                          <span className="inline-block mt-1 text-[11px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                            🔄 โยกไปให้ {movedToDriver ? `${movedToDriver} ` : ''}({movedToPlate})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-4">
                    <div>
                      <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">📦 รายละเอียดงาน</p>
                      <p className="text-base font-medium text-gray-800 whitespace-pre-wrap leading-snug">
                        {stop.cargoDetails || "ส่งวัสดุตามใบเบิก"}
                      </p>
                    </div>

                    {stop.requestedBy && (
                      <div className="flex flex-col gap-1 pt-2 border-t border-gray-200">
                        <div className="flex items-center gap-2">
                          <User className="h-3 w-3 text-gray-400" />
                          <span className="text-xs text-gray-500">ผู้ขอใช้งาน: <strong className="text-gray-700">{stop.requestedBy}</strong></span>
                        </div>
                        {(stop as any).requestedByPhone && (
                          <a href={`tel:${(stop as any).requestedByPhone}`} className="flex items-center gap-2 text-sm font-bold text-orange-600 ml-5 hover:underline">
                            <Phone className="h-3.5 w-3.5" /> {(stop as any).requestedByPhone}
                          </a>
                        )}
                      </div>
                    )}

                    {((stop as any).note || dispatcherNote) && (
                      <div className="pt-2 border-t border-gray-200 space-y-2">
                        {(stop as any).note && (
                          <div className="flex gap-2">
                            <Info className="h-3 w-3 text-orange-400 shrink-0 mt-0.5" />
                            <p className="text-xs text-gray-600 italic">หมายเหตุผู้ขอ: "{(stop as any).note}"</p>
                          </div>
                        )}
                        {dispatcherNote && (
                          <div className="flex gap-2">
                            <FileText className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-blue-700 font-medium">บันทึกจัดรถ: {dispatcherNote}{dispatcherBy ? ` (โดย ${dispatcherBy})` : ''}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {movedAway ? (
                    <div className="w-full min-h-[52px] bg-amber-50 text-amber-800 font-bold rounded-xl flex items-center justify-center gap-2 border-2 border-amber-200 px-3 py-2 text-center">
                      ✋ งานนี้โยกให้ {movedToDriver ? `${movedToDriver} ` : ''}({movedToPlate}) แล้ว — ไม่ต้องวิ่งจุดนี้
                    </div>
                  ) : (
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
                  )}
                </div>
              </section>
            )})}
          </div>

          {/* Footer Stats */}
          <div className="pt-4 px-2">
            <div className="bg-gray-900 text-white rounded-2xl p-6 space-y-3 shadow-xl">
              <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest border-b border-white/10 pb-2 mb-3">สรุปแผนการเดินทาง</h3>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">ระยะทางวิ่งจริง (กม.)</span>
                <span className="text-xl font-bold">{(actualKm ?? trip.totalDistanceKm)?.toFixed(1) || "-"} กม.</span>
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