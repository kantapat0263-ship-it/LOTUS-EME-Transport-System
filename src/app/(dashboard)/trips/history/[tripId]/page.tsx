"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { 
  ChevronLeft, 
  Printer, 
  MapPin, 
  Truck, 
  User, 
  Calendar as CalendarIcon, 
  Clock, 
  Route as RouteIcon,
  Loader2,
  AlertCircle
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { Trip, TripStatus } from "@/types/models"
import { cn } from "@/lib/utils"
import { Loader } from "@googlemaps/js-api-loader"

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""
const DEFAULT_WAREHOUSE_LAT = 14.094126450195006
const DEFAULT_WAREHOUSE_LNG = 100.6893810570115

export default function TripDetailPage() {
  const params = useParams()
  const router = useRouter()
  const db = useFirestore()
  const tripId = params.tripId as string
  
  const tripRef = useMemoFirebase(() => doc(db, "trips", tripId), [db, tripId])
  const { data: trip, isLoading } = useDoc<any>(tripRef)
  
  const mapRef = React.useRef<HTMLDivElement>(null)
  const [isApiLoaded, setIsApiLoaded] = React.useState(false)

  // Initialize Map
  React.useEffect(() => {
    if (!mapRef.current || !GOOGLE_MAPS_API_KEY || !trip || !isApiLoaded) return

    const google = window.google
    const map = new google.maps.Map(mapRef.current!, {
      center: { lat: DEFAULT_WAREHOUSE_LAT, lng: DEFAULT_WAREHOUSE_LNG },
      zoom: 12,
      disableDefaultUI: true,
      styles: [
        { featureType: "landscape", elementType: "all", color: "#2d3139" },
        { featureType: "road", elementType: "all", color: "#1a1c23" },
        { featureType: "water", elementType: "all", color: "#172899" }
      ]
    })

    const directionsService = new google.maps.DirectionsService()
    const directionsRenderer = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: false,
      polylineOptions: { strokeColor: "#F0890D", strokeWeight: 5 }
    })

    if (trip.stops && trip.stops.length > 0) {
      const origin = { lat: DEFAULT_WAREHOUSE_LAT, lng: DEFAULT_WAREHOUSE_LNG }
      const waypoints = trip.stops.map((s: any) => ({
        location: s.siteName,
        stopover: true
      }))
      const destination = waypoints.pop().location

      directionsService.route({
        origin,
        destination,
        waypoints,
        travelMode: google.maps.TravelMode.DRIVING
      }, (result, status) => {
        if (status === "OK") directionsRenderer.setDirections(result)
      })
    }
  }, [trip, isApiLoaded])

  // Load Google Maps API
  React.useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return
    const loader = new Loader({ apiKey: GOOGLE_MAPS_API_KEY, version: "weekly" })
    loader.load().then(() => setIsApiLoaded(true))
  }, [])

  const handleStatusChange = async (newStatus: TripStatus) => {
    await updateDoc(tripRef, { 
      status: newStatus,
      updatedAt: serverTimestamp()
    })
  }

  const getStatusColor = (status: TripStatus) => {
    switch (status) {
      case 'Completed': return 'bg-green-500 text-white';
      case 'In Progress': return 'bg-blue-500 text-white';
      case 'Planned': return 'bg-orange-500 text-white';
      case 'Cancelled': return 'bg-destructive text-white';
      default: return '';
    }
  }

  // Format time properly
  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours} ชม. ${mins} นาที`;
  }

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
  if (!trip) return <div className="flex flex-col items-center justify-center h-[50vh] gap-4"><AlertCircle className="h-12 w-12 text-destructive" /><p>ไม่พบข้อมูลเที่ยววิ่ง</p><Button onClick={() => router.push('/trips/history')}>กลับไปหน้าประวัติ</Button></div>

  return (
    <>
      {/* SCREEN VIEW */}
      <div className="space-y-6 animate-in fade-in duration-500 no-print">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => router.push('/trips/history')}>
            <ChevronLeft className="mr-2 h-4 w-4" /> กลับหน้าประวัติ
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> พิมพ์ใบงาน
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className={cn("hover:opacity-90", getStatusColor(trip.status))}>
                  เปลี่ยนสถานะ: {trip.status}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleStatusChange('Planned')}>Planned</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange('In Progress')}>In Progress</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange('Completed')}>Completed</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange('Cancelled')}>Cancelled</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-2xl">Trip ID: {trip.id}</CardTitle>
                    <CardDescription>สร้างเมื่อ: {trip.createdAt?.toDate()?.toLocaleString('th-TH')}</CardDescription>
                  </div>
                  <Badge className={cn("text-lg px-4 py-1", getStatusColor(trip.status))}>{trip.status}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase flex items-center gap-1"><CalendarIcon className="h-3 w-3" /> วันที่ส่งของ</p>
                    <p className="font-bold">{trip.tripDate}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase flex items-center gap-1"><User className="h-3 w-3" /> คนขับ</p>
                    <p className="font-bold">{trip.driverName}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase flex items-center gap-1"><Truck className="h-3 w-3" /> ทะเบียนรถ</p>
                    <p className="font-bold">{trip.vehiclePlate}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase flex items-center gap-1"><RouteIcon className="h-3 w-3" /> ระยะทางรวม</p>
                    <p className="font-bold">{trip.totalDistanceKm?.toFixed(1) || 0} กม.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-accent" /> ลำดับจุดส่งของ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {trip.stops?.map((stop: any, index: number) => (
                  <div key={index} className="flex gap-4 p-4 rounded-lg bg-secondary/30 relative border border-border/50">
                    <div className="w-8 h-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-bold shrink-0">
                      {index + 1}
                    </div>
                    <div className="flex-1 space-y-2">
                      <p className="font-bold text-lg text-accent">{stop.siteName}</p>
                      <div className="bg-background/50 p-3 rounded border border-dashed border-border">
                        <p className="text-xs font-bold text-muted-foreground mb-1">รายการสินค้า:</p>
                        <p className="text-sm whitespace-pre-wrap">{stop.cargoDetails || "ไม่มีรายละเอียด"}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="h-[400px] overflow-hidden sticky top-24">
              <CardHeader className="bg-background/80 backdrop-blur z-10 border-b">
                <CardTitle className="text-sm">แผนที่เส้นทาง</CardTitle>
              </CardHeader>
              <div ref={mapRef} className="w-full h-full bg-muted" />
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">สรุปเวลาเดินทาง</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-2xl font-bold">
                  <Clock className="h-6 w-6 text-accent" />
                  {formatTime(trip.totalEstimatedTimeMinutes || 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-2">* เป็นเวลาเดินทางโดยประมาณการ (ไม่รวมเวลาลงของ)</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* PRINT VIEW (Clean Document) */}
      <div className="print-only w-full bg-white text-black p-4 font-sans leading-relaxed">
        <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold uppercase tracking-tighter">LOTUS EME</h1>
            <h2 className="text-xl font-semibold">ใบงานการขนส่ง (Delivery Worksheet)</h2>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">Trip ID: {trip.tripId || trip.id}</p>
            <p className="text-sm">สถานะ: {trip.status}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-8">
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-600 uppercase">ข้อมูลเที่ยววิ่ง</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="font-semibold text-gray-700">วันที่ส่งของ:</span> <span>{trip.tripDate}</span>
              <span className="font-semibold text-gray-700">ระยะทางรวม:</span> <span>{trip.totalDistanceKm?.toFixed(1) || 0} กม.</span>
              <span className="font-semibold text-gray-700">เวลาเดินทาง:</span> <span>{formatTime(trip.totalEstimatedTimeMinutes || 0)}</span>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-600 uppercase">ข้อมูลคนขับและรถ</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="font-semibold text-gray-700">ชื่อคนขับ:</span> <span>{trip.driverName}</span>
              <span className="font-semibold text-gray-700">ทะเบียนรถ:</span> <span>{trip.vehiclePlate}</span>
              <span className="font-semibold text-gray-700">พิกัดเริ่มต้น:</span> <span>คลังสินค้าหลัก LOTUS</span>
            </div>
          </div>
        </div>

        <div className="border-t border-black pt-6 mb-8">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2 underline">
            ลำดับจุดส่งของ (Delivery Sequence)
          </h3>
          <div className="space-y-6">
            {trip.stops?.map((stop: any, index: number) => (
              <div key={index} className="flex gap-6 border-b border-gray-100 pb-4">
                <div className="w-8 h-8 rounded-full border-2 border-black flex items-center justify-center font-bold text-lg shrink-0">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <p className="text-xl font-bold">{stop.siteName}</p>
                  <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded">
                    <p className="text-xs font-bold text-gray-500 mb-1">รายการสินค้าและวัสดุ:</p>
                    <p className="text-sm whitespace-pre-wrap">{stop.cargoDetails || "ไม่มีรายละเอียด"}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Signature Area */}
        <div className="mt-20 grid grid-cols-3 gap-8">
          <div className="text-center space-y-12">
            <div className="border-b border-black w-full" />
            <p className="text-sm font-semibold">( ลงชื่อคนขับรถ )</p>
            <p className="text-xs">วันที่: ____/____/____</p>
          </div>
          <div className="text-center space-y-12">
            <div className="border-b border-black w-full" />
            <p className="text-sm font-semibold">( ลงชื่อผู้รับของ/ไซน์งาน )</p>
            <p className="text-xs">วันที่: ____/____/____</p>
          </div>
          <div className="text-center space-y-12">
            <div className="border-b border-black w-full" />
            <p className="text-sm font-semibold">( ลงชื่อผู้อนุมัติ )</p>
            <p className="text-xs">วันที่: ____/____/____</p>
          </div>
        </div>

        <div className="mt-12 text-center text-[10px] text-gray-400">
          เอกสารนี้สร้างขึ้นโดยระบบอัตโนมัติ LOTUS EME Transport Management System
        </div>
      </div>
    </>
  )
}