
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
  AlertCircle,
  Phone,
  History,
  Info
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
import { useDoc, useFirestore, useMemoFirebase, useCollection } from "@/firebase"
import { doc, updateDoc, serverTimestamp, collection, query, orderBy } from "firebase/firestore"
import { Trip, TripStatus, CompanySetting, Site, Driver, TripEditLog } from "@/types/models"
import { cn } from "@/lib/utils"
import { Loader } from "@googlemaps/js-api-loader"
import { format } from "date-fns"
import { th } from "date-fns/locale"

const DEFAULT_WAREHOUSE_LAT = 14.094126450195006
const DEFAULT_WAREHOUSE_LNG = 100.6893810570115

export default function TripDetailPage() {
  const params = useParams()
  const router = useRouter()
  const db = useFirestore()
  const tripId = params.tripId as string
  
  const tripRef = useMemoFirebase(() => doc(db, "trips", tripId), [db, tripId])
  const { data: trip, isLoading: isTripLoading } = useDoc<Trip>(tripRef)
  
  const sitesRef = useMemoFirebase(() => collection(db, "sites"), [db])
  const { data: allSites, isLoading: isSitesLoading } = useCollection<Site>(sitesRef)
  
  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: companySettings } = useDoc<CompanySetting>(settingsRef)
  
  const driverRef = useMemoFirebase(() => trip?.driverId ? doc(db, "drivers", trip.driverId) : null, [db, trip?.driverId])
  const { data: driverData } = useDoc<Driver>(driverRef)

  // Fetch Edit Logs
  const editLogsRef = useMemoFirebase(() => query(collection(db, "trips", tripId, "editLogs"), orderBy("editedAt", "desc")), [db, tripId])
  const { data: editLogs } = useCollection<TripEditLog>(editLogsRef)

  const mapRef = React.useRef<HTMLDivElement>(null)
  const [isApiLoaded, setIsApiLoaded] = React.useState(false)

  // Helper Functions for Print
  const formatThaiShortDate = (dateStr: string | any) => {
    if (!dateStr) return "-";
    try {
      const d = dateStr.toDate ? dateStr.toDate() : new Date(dateStr);
      const day = d.getDate();
      const month = d.getMonth() + 1;
      const year = (d.getFullYear() + 543).toString().slice(-2);
      return `${day}/${month}/${year}`;
    } catch (e) {
      return dateStr;
    }
  };

  const formatDurationMinutes = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
  };

  const getUniqueRequesters = (trip: any) => {
    const names = new Set<string>();
    if (trip.requestedBy) names.add(trip.requestedBy);
    if (trip.stops) {
      trip.stops.forEach((s: any) => {
        if (s.requestedBy) names.add(s.requestedBy);
      });
    }
    return Array.from(names).filter(Boolean).join(", ") || "-";
  };

  const getStopLocation = (siteId: string) => {
    const site = allSites?.find(s => s.id === siteId);
    return site?.address || "";
  };

  React.useEffect(() => {
    if (!mapRef.current || !trip || !isApiLoaded || !allSites) return

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
      polylineOptions: { 
        strokeColor: "#F0890D", 
        strokeWeight: 6,
        strokeOpacity: 0.8
      }
    })

    if (trip.stops && trip.stops.length > 0) {
      const originLat = companySettings?.warehouseLatitude || DEFAULT_WAREHOUSE_LAT
      const originLng = companySettings?.warehouseLongitude || DEFAULT_WAREHOUSE_LNG
      const origin = new google.maps.LatLng(originLat, originLng)

      const stopPoints = trip.stops.map((s: any) => {
        const site = allSites.find(site => site.id === s.siteId)
        if (site && site.latitude && site.longitude) {
          return new google.maps.LatLng(site.latitude, site.longitude)
        }
        return null
      }).filter((p: any) => p !== null)

      if (stopPoints.length > 0) {
        const destination = stopPoints[stopPoints.length - 1]
        const waypoints = stopPoints.slice(0, -1).map((p: any) => ({
          location: p,
          stopover: true
        }))

        directionsService.route({
          origin,
          destination,
          waypoints,
          travelMode: google.maps.TravelMode.DRIVING
        }, (result, status) => {
          if (status === "OK" && result) {
            directionsRenderer.setDirections(result)
          } else {
            console.warn("Directions request failed due to " + status)
          }
        })
      }
    }
  }, [trip, isApiLoaded, allSites, companySettings])

  React.useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || companySettings?.googleMapsApiKeyReference;
    if (!apiKey) return
    
    const loader = new Loader({ 
      apiKey: apiKey, 
      version: "weekly",
      libraries: ["places", "geometry"]
    })
    loader.load().then(() => setIsApiLoaded(true))
  }, [companySettings])

  const handleStatusChange = async (newStatus: TripStatus) => {
    if (!trip) return
    const tripRef = doc(db, "trips", trip.id)
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

  const isLoading = isTripLoading || isSitesLoading

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
  if (!trip) return <div className="flex flex-col items-center justify-center h-[50vh] gap-4"><AlertCircle className="h-12 w-12 text-destructive" /><p>ไม่พบข้อมูลเที่ยววิ่ง</p><Button onClick={() => router.push('/trips/history')}>กลับไปหน้าประวัติ</Button></div>

  return (
    <>
      <div className="space-y-6 animate-in fade-in duration-500 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <Button variant="ghost" onClick={() => router.push('/trips/history')} className="w-full sm:w-auto justify-start">
            <ChevronLeft className="mr-2 h-4 w-4" /> กลับหน้าประวัติ
          </Button>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={() => window.print()} className="flex-1 sm:flex-none h-11 sm:h-9">
              <Printer className="mr-2 h-4 w-4" /> พิมพ์
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className={cn("flex-1 sm:flex-none h-11 sm:h-9 hover:opacity-90", getStatusColor(trip.status))}>
                  สถานะ: {trip.status}
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
              <CardHeader className="p-4 md:p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                  <div className="overflow-hidden">
                    <CardTitle className="text-xl md:text-2xl truncate">Trip ID: {trip.id}</CardTitle>
                    <CardDescription className="text-xs">สร้างเมื่อ: {trip.createdAt?.toDate()?.toLocaleString('th-TH')}</CardDescription>
                  </div>
                  <Badge className={cn("text-base md:text-lg px-3 md:px-4 py-1 self-start sm:self-auto", getStatusColor(trip.status))}>{trip.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6">
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><CalendarIcon className="h-3 w-3 text-white" /> วันที่ส่ง</p>
                    <p className="font-bold text-sm md:text-base">{trip.tripDate}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><User className="h-3 w-3" /> คนขับ</p>
                    <p className="font-bold text-sm md:text-base">{trip.driverName}</p>
                    <p className="text-[10px] text-accent flex items-center gap-1">
                      <Phone className="h-2.5 w-2.5" />
                      {driverData?.phoneNumber || "ไม่ระบุเบอร์"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><Truck className="h-3 w-3" /> ทะเบียนรถ</p>
                    <p className="font-bold text-sm md:text-base">{trip.vehiclePlate}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><RouteIcon className="h-3 w-3" /> ระยะทาง</p>
                    <p className="font-bold text-sm md:text-base">{trip.totalDistanceKm?.toFixed(1) || 0} กม.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 md:p-6">
                <CardTitle className="flex items-center gap-2 text-lg"><MapPin className="h-5 w-5 text-accent" /> ลำดับจุดส่งของ</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 space-y-4 pt-0">
                {trip.stops?.map((stop: any, index: number) => (
                  <div key={index} className="flex gap-3 md:gap-4 p-3 md:p-4 rounded-lg bg-secondary/30 relative border border-border/50">
                    <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-bold shrink-0 text-sm">
                      {index + 1}
                    </div>
                    <div className="flex-1 space-y-2 overflow-hidden">
                      <p className="font-bold text-base md:text-lg text-accent truncate">{stop.siteName}</p>
                      <div className="bg-background/50 p-2 md:p-3 rounded border border-dashed border-border">
                        <p className="text-[10px] font-bold text-muted-foreground mb-1">รายการสินค้า:</p>
                        <p className="text-xs md:text-sm whitespace-pre-wrap">{stop.cargoDetails || "ไม่มีรายละเอียด"}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Edit History Section */}
            {editLogs && editLogs.length > 0 && (
              <Card className="border-accent/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <History className="h-5 w-5 text-accent" /> ประวัติการแก้ไข
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {editLogs.map((log) => (
                    <div key={log.id} className="p-4 rounded-lg bg-secondary/10 border border-border/50 text-sm space-y-2">
                      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                        <p className="font-bold text-accent">
                          แก้ไขเมื่อ {log.editedAt?.toDate() ? format(log.editedAt.toDate(), "dd/MM/yyyy HH:mm", { locale: th }) : "-"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">โดย {log.editedBy}</p>
                      </div>
                      
                      <div className="space-y-1 pl-2 border-l-2 border-accent/20">
                        {log.changes.vehicle && (
                          <p className="text-xs">🚗 เปลี่ยนรถ: {log.changes.vehicle.from} → {log.changes.vehicle.to}</p>
                        )}
                        {log.changes.driver && (
                          <p className="text-xs">👤 เปลี่ยนคนขับ: {log.changes.driver.from} → {log.changes.driver.to}</p>
                        )}
                        {log.changes.stopsAdded && log.changes.stopsAdded.length > 0 && (
                          <p className="text-xs">➕ เพิ่มจุดส่ง: {log.changes.stopsAdded.join(", ")}</p>
                        )}
                        {log.changes.stopsRemoved && log.changes.stopsRemoved.length > 0 && (
                          <p className="text-xs">❌ ลบจุดส่ง: {log.changes.stopsRemoved.join(", ")}</p>
                        )}
                        {log.changes.cargoChanged && (
                          <p className="text-xs">📦 มีการแก้ไขรายละเอียดสินค้า</p>
                        )}
                      </div>

                      <div className="mt-2 flex items-start gap-2 text-xs italic text-muted-foreground bg-secondary/5 p-2 rounded">
                        <Info className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>หมายเหตุ: {log.note}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card className="h-[300px] sm:h-[450px] overflow-hidden sticky top-20 md:top-24">
              <CardHeader className="bg-background/80 backdrop-blur z-10 border-b p-3">
                <CardTitle className="text-xs md:text-sm flex items-center gap-2">
                  <RouteIcon className="h-4 w-4 text-accent" /> เส้นทางการเดินทาง
                </CardTitle>
              </CardHeader>
              <div ref={mapRef} className="w-full h-full bg-muted/20" />
            </Card>
            
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="text-xs md:text-sm">สรุปเวลาเดินทาง</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="flex items-center gap-2 text-xl md:text-2xl font-bold">
                  <Clock className="h-5 w-5 md:h-6 md:w-6 text-accent" />
                  {formatDurationMinutes(trip.totalEstimatedTimeMinutes || 0)}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">* เป็นเวลาเดินทางโดยประมาณการ</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Official Form Print Section */}
      <div className="print-only" style={{ width: '100%', color: '#000', backgroundColor: '#fff', padding: '0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', border: '2px solid #000' }}>
          <thead>
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '18px', padding: '12px', borderBottom: '2px solid #000' }}>
                บันทึกใช้รถยนต์ประจำวัน<br/>
                <span style={{ fontSize: '14px' }}>LOTUS GROUP / LOTUS EME</span>
              </td>
            </tr>
            <tr style={{ backgroundColor: '#f0f0f0' }}>
              <th style={{ border: '1px solid #000', padding: '8px', width: '15%', textAlign: 'center' }}>
                วัน เดือน ปี<br/>ที่ใช้รถ
              </th>
              <th style={{ border: '1px solid #000', padding: '8px', width: '10%', textAlign: 'center' }}>
                เวลา
              </th>
              <th style={{ border: '1px solid #000', padding: '8px', width: '50%', textAlign: 'left' }}>
                รายละเอียดของงานที่ปฏิบัติ<br/>
                <span style={{ fontWeight: 'normal', fontSize: '11px' }}>ลักษณะงาน (แยกเป็นข้อ ๆ) และ สถานที่</span>
              </th>
              <th style={{ border: '1px solid #000', padding: '8px', width: '25%', textAlign: 'left' }}>
                ผู้ปฏิบัติงาน / ทะเบียนรถ<br/>ผู้ขอใช้รถ / วันที่บันทึก
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {/* วัน เดือน ปี */}
              <td style={{ border: '1px solid #000', padding: '10px', verticalAlign: 'top', textAlign: 'center' }}>
                {formatThaiShortDate(trip.tripDate)}
              </td>
              
              {/* เวลา */}
              <td style={{ border: '1px solid #000', padding: '10px', verticalAlign: 'top', textAlign: 'center' }}>
                {trip.departureTime || "08:30"} น.
              </td>
              
              {/* ลักษณะงาน + สถานที่ */}
              <td style={{ border: '1px solid #000', padding: '10px', verticalAlign: 'top' }}>
                {trip.stops?.map((stop, index) => (
                  <div key={index} style={{ marginBottom: '12px' }}>
                    <div style={{ fontWeight: 'bold' }}>{index + 1}. {stop.siteName}</div>
                    {stop.cargoDetails && (
                      <div style={{ marginLeft: '16px', fontSize: '12px', whiteSpace: 'pre-line', marginTop: '2px' }}>
                        {stop.cargoDetails}
                      </div>
                    )}
                    <div style={{ textAlign: 'right', color: '#444', fontSize: '11px', fontStyle: 'italic', marginTop: '2px' }}>
                      สถานที่: {getStopLocation(stop.siteId)}
                    </div>
                  </div>
                ))}
              </td>
              
              {/* ผู้ปฏิบัติงาน / ทะเบียนรถ / ผู้ขอใช้รถ */}
              <td style={{ border: '1px solid #000', padding: '10px', verticalAlign: 'top', fontSize: '12px' }}>
                <div style={{ marginBottom: '6px' }}>
                  <strong>ผู้ขับ:</strong> {trip.driverName}
                </div>
                <div style={{ marginBottom: '6px' }}>
                  <strong>ทะเบียน:</strong> {trip.vehiclePlate}
                </div>
                <div style={{ marginTop: '10px' }}>
                  <strong>ผู้ขอใช้รถ:</strong><br/>
                  <span style={{ fontSize: '11px' }}>{getUniqueRequesters(trip)}</span>
                </div>
                <div style={{ marginTop: '12px', fontSize: '10px', color: '#555' }}>
                  วันที่บันทึก: {formatThaiShortDate(trip.createdAt)}
                </div>
              </td>
            </tr>
            
            {/* Signature row */}
            <tr>
              <td colSpan={2} style={{ border: '1px solid #000', padding: '30px 10px 10px 10px', textAlign: 'center', verticalAlign: 'bottom' }}>
                <div style={{ marginBottom: '40px' }}>ลายเซ็นคนขับ</div>
                _________________________<br/>
                ({trip.driverName})
              </td>
              <td colSpan={2} style={{ border: '1px solid #000', padding: '30px 10px 10px 10px', textAlign: 'center', verticalAlign: 'bottom' }}>
                <div style={{ marginBottom: '40px' }}>ลายเซ็นผู้อนุมัติ</div>
                _________________________<br/>
                วันที่ ______/______/______
              </td>
            </tr>
          </tbody>
        </table>
        
        {/* Summary footer */}
        <div style={{ marginTop: '15px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <strong>ระยะทางรวม:</strong> {trip.totalDistanceKm?.toFixed(1) || 0} กม.
          </div>
          <div>
            <strong>เวลาเดินทางโดยประมาณ:</strong> {formatDurationMinutes(trip.totalEstimatedTimeMinutes || 0)}
          </div>
          <div style={{ fontStyle: 'italic' }}>
            * พิมพ์จากระบบ LOTUS GROUP Transport Management
          </div>
        </div>
      </div>
    </>
  )
}
