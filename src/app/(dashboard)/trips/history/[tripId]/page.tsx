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
  Send,
  Copy,
  Check,
  QrCode,
  X,
  FileText,
  ClipboardList,
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
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog"
import { useDoc, useFirestore, useMemoFirebase, useCollection } from "@/firebase"
import { doc, updateDoc, serverTimestamp, collection } from "firebase/firestore"
import { Trip, TripStatus, CompanySetting, Site, Driver } from "@/types/models"
import { cn } from "@/lib/utils"
import { Loader } from "@googlemaps/js-api-loader"
import { useToast } from "@/hooks/use-toast"

// Production URL for public access
const PRODUCTION_URL = "https://lotus-eme-transport-system.vercel.app"

// LOTUS GROUP Head Office Coordinates (Default)
const HEAD_OFFICE = { lat: 14.0815, lng: 100.7129 }

export default function TripDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const db = useFirestore()
  const tripId = params.tripId as string
  
  const tripRef = useMemoFirebase(() => doc(db, "trips", tripId), [db, tripId])
  const { data: trip, isLoading: isTripLoading } = useDoc<Trip>(tripRef)

  // Fetch sites for Master Data fallback if needed
  const sitesRef = useMemoFirebase(() => collection(db, "sites"), [db])
  const { data: allSites, isLoading: isSitesLoading } = useCollection<Site>(sitesRef)
  
  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: companySettings } = useDoc<CompanySetting>(settingsRef)
  
  const driverRef = useMemoFirebase(() => trip?.driverId ? doc(db, "drivers", trip.driverId) : null, [db, trip?.driverId])
  const { data: driverData } = useDoc<Driver>(driverRef)

  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<google.maps.Map | null>(null)
  const directionsRendererRef = React.useRef<google.maps.DirectionsRenderer | null>(null)
  const [apiLoaded, setApiLoaded] = React.useState(false)
  const [calculatedStats, setCalculatedStats] = React.useState<{ distance: number, duration: number } | null>(null)

  const markersRef = React.useRef<google.maps.Marker[]>([])

  // Share Dialog States
  const [isShareOpen, setIsShareOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  const formatDurationFormatted = (minutes: number) => {
    if (minutes <= 0) return "-";
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h > 0) {
      return m > 0 ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
    }
    return `${m} นาที`;
  };

  const formatDisplayDate = (dateStr: any) => {
    if (!dateStr) return "-";
    try {
      const d = dateStr.toDate ? dateStr.toDate() : new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      if (typeof dateStr === 'string' && dateStr.includes('-')) {
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
      }
      return "-";
    }
  };

  const getStopLocation = (stop: any) => {
    if (stop.address) return stop.address;
    const site = allSites?.find(s => s.id === stop.siteId);
    return site?.address || "";
  };

  // 1. Initialize Google Maps API
  React.useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || companySettings?.googleMapsApiKeyReference;
    if (!apiKey) return;
    
    const loader = new Loader({ 
      apiKey, 
      version: "weekly",
      libraries: ["places", "geometry"]
    });
    loader.load().then(() => setApiLoaded(true));
  }, [companySettings]);

  // 2. Draw Route using saved coordinates or master data
  React.useEffect(() => {
    if (!apiLoaded || !mapContainerRef.current || !trip || isSitesLoading || !allSites) return;

    const timeout = setTimeout(() => {
      const google = window.google;
      
      if (!mapRef.current) {
        const map = new google.maps.Map(mapContainerRef.current!, {
          center: { lat: trip.originLat || HEAD_OFFICE.lat, lng: trip.originLng || HEAD_OFFICE.lng },
          zoom: 12,
          styles: [
            { featureType: "landscape", elementType: "all", color: "#2d3139" },
            { featureType: "road", elementType: "all", color: "#1a1c23" },
            { featureType: "water", elementType: "all", color: "#172899" }
          ] as unknown as google.maps.MapTypeStyle[],
          disableDefaultUI: true
        });

        const renderer = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: true,
          polylineOptions: { 
            strokeColor: "#F0890D", 
            strokeWeight: 6,
            strokeOpacity: 0.9
          }
        });

        mapRef.current = map;
        directionsRendererRef.current = renderer;
      }

      const map = mapRef.current!;
      const directionsRenderer = directionsRendererRef.current!;
      const directionsService = new google.maps.DirectionsService();

      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];

      // Resolve Waypoints: Priority 1 - Trip Stops Saved Lat/Lng, Priority 2 - Master Sites Data
      const resolvedWaypoints = (trip.stops || []).map((s: any) => {
        let position: google.maps.LatLng | null = null;
        if (s.lat && s.lng) {
          position = new google.maps.LatLng(s.lat, s.lng);
        } else if (s.siteId) {
          const site = allSites.find(site => site.id === s.siteId);
          if (site?.latitude && site?.longitude) {
            position = new google.maps.LatLng(site.latitude, site.longitude);
          }
        }
        return { position, siteName: s.siteName };
      });

      const validWaypoints = resolvedWaypoints.filter(w => w.position !== null);
      
      if (validWaypoints.length > 0) {
        const origin = new google.maps.LatLng(trip.originLat || HEAD_OFFICE.lat, trip.originLng || HEAD_OFFICE.lng);
        const destination = validWaypoints[validWaypoints.length - 1].position!;
        const intermediates = validWaypoints.slice(0, -1).map(w => ({
          location: w.position!,
          stopover: true
        }));

        directionsService.route({
          origin,
          destination,
          waypoints: intermediates,
          travelMode: google.maps.TravelMode.DRIVING
        }, (result, status) => {
          if (status === "OK" && result) {
            directionsRenderer.setDirections(result);
            
            let totalDurValue = 0;
            let totalDistValue = 0;
            result.routes[0].legs.forEach(leg => {
              totalDurValue += leg.duration?.value || 0;
              totalDistValue += leg.distance?.value || 0;
            });

            setCalculatedStats({
              distance: totalDistValue / 1000,
              duration: Math.ceil(totalDurValue / 60)
            });

            // Markers
            const startMarker = new google.maps.Marker({
              position: origin,
              map,
              title: trip.departurePoint || "จุดเริ่มต้น (สำนักงาน)",
              icon: {
                path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                scale: 7,
                fillColor: "#10b981",
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: "#ffffff"
              }
            });
            markersRef.current.push(startMarker);

            validWaypoints.forEach((wp, idx) => {
              const marker = new google.maps.Marker({
                position: wp.position!,
                map,
                label: {
                  text: (idx + 1).toString(),
                  color: "#ffffff",
                  fontWeight: "bold",
                  fontSize: "12px"
                },
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 12,
                  fillColor: "#F0890D",
                  fillOpacity: 1,
                  strokeWeight: 2,
                  strokeColor: "#ffffff"
                },
                title: wp.siteName
              });
              markersRef.current.push(marker);
            });

            const bounds = new google.maps.LatLngBounds();
            bounds.extend(origin);
            validWaypoints.forEach(wp => bounds.extend(wp.position!));
            map.fitBounds(bounds);
          }
        });
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [apiLoaded, trip, allSites, isSitesLoading]);

  const handleStatusChange = async (newStatus: TripStatus) => {
    if (!trip) return
    const tRef = doc(db, "trips", trip.id)
    await updateDoc(tRef, { 
      status: newStatus,
      updatedAt: serverTimestamp()
    })
  }

  const driverUrl = `${PRODUCTION_URL}/driver/${trip?.tripId}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(driverUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "คัดลอกลิงก์แล้ว", description: "คุณสามารถส่งลิงก์นี้ให้คนขับได้ทันที" });
  };

  const getStatusColor = (status: TripStatus) => {
    switch (status) {
      case 'Completed': return 'bg-green-500 text-white';
      case 'In Progress': return 'bg-blue-500 text-white';
      case 'Planned': return 'bg-orange-500 text-white';
      case 'Cancelled': return 'bg-destructive text-white';
      default: return '';
    }
  }

  if (isTripLoading || isSitesLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
  if (!trip) return <div className="flex flex-col items-center justify-center h-[50vh] gap-4"><AlertCircle className="h-12 w-12 text-destructive" /><p>ไม่พบข้อมูลเที่ยววิ่ง</p><Button onClick={() => router.push('/trips/history')}>กลับไปหน้าประวัติ</Button></div>

  const finalDuration = (trip.totalEstimatedTimeMinutes && trip.totalEstimatedTimeMinutes > 0) 
    ? trip.totalEstimatedTimeMinutes 
    : (calculatedStats?.duration || 0);

  const finalDistance = (trip.totalDistanceKm && trip.totalDistanceKm > 0)
    ? trip.totalDistanceKm
    : (calculatedStats?.distance || 0);

  const getDisplayStatus = (t: any): TripStatus => {
    if (t.status === 'Cancelled') return 'Cancelled';
    const today = new Date().toISOString().split('T')[0];
    if (!t.tripDate) return t.status;
    if (t.tripDate < today) return 'Completed';
    if (t.tripDate === today) return 'In Progress';
    return 'Planned';
  };
  const displayStatus = getDisplayStatus(trip);

  return (
    <>
      <div className="space-y-6 animate-in fade-in duration-500 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <Button variant="ghost" onClick={() => router.push('/trips/history')} className="w-full sm:w-auto justify-start">
            <ChevronLeft className="mr-2 h-4 w-4" /> กลับหน้าประวัติ
          </Button>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Button 
              variant="outline" 
              className="flex-1 sm:flex-none h-11 sm:h-9 border-blue-500 text-blue-500 hover:bg-blue-500/10"
              onClick={() => setIsShareOpen(true)}
            >
              <Send className="mr-2 h-4 w-4" /> ส่งให้คนขับ
            </Button>
            <Button variant="outline" onClick={() => window.print()} className="flex-1 sm:flex-none h-11 sm:h-9">
              <Printer className="mr-2 h-4 w-4" /> พิมพ์ใบงาน
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className={cn("flex-1 sm:flex-none h-11 sm:h-9 hover:opacity-90", getStatusColor(displayStatus))}>
                  สถานะ: {displayStatus}
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
                    <CardTitle className="text-xl md:text-2xl truncate">Trip ID: {trip.tripId}</CardTitle>
                    <CardDescription className="text-xs">สร้างเมื่อ: {trip.createdAt?.toDate()?.toLocaleString('th-TH')}</CardDescription>
                  </div>
                  <Badge className={cn("text-base md:text-lg px-3 md:px-4 py-1 self-start sm:self-auto", getStatusColor(displayStatus))}>{displayStatus}</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6">
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><CalendarIcon className="h-3 w-3 text-white" /> วันที่ส่ง</p>
                    <p className="font-bold text-sm md:text-base">{formatDisplayDate(trip.tripDate)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><User className="h-3 w-3" /> คนขับ</p>
                    <p className="font-bold text-sm md:text-base">{trip.driverName}</p>
                    <p className="text-[10px] text-accent flex items-center gap-1">
                      <Phone className="h-2.5 w-2.5" /> {driverData?.phoneNumber || "ไม่ระบุเบอร์"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><Truck className="h-3 w-3" /> ทะเบียนรถ</p>
                    <p className="font-bold text-sm md:text-base">{trip.vehiclePlate}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><RouteIcon className="h-3 w-3" /> ระยะทาง</p>
                    <p className="font-bold text-sm md:text-base">{finalDistance.toFixed(1)} กม.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 md:p-6">
                <CardTitle className="flex items-center gap-2 text-lg"><MapPin className="h-5 w-5 text-accent" /> ลำดับจุดส่งของ</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 space-y-4 pt-0">
                {(trip.stops || []).map((stop: any, index: number) => (
                  <div key={index} className="flex flex-col gap-3 p-4 rounded-xl bg-secondary/20 border border-border/50">
                    <div className="flex gap-4 items-start">
                      <div className="w-8 h-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-bold shrink-0 text-sm">
                        {index + 1}
                      </div>
                      <div className="flex-1 overflow-hidden space-y-2">
                        <div className="flex justify-between items-start gap-4">
                          <p className="font-bold text-lg text-accent truncate">{stop.siteName}</p>
                          {stop.requestTime && (
                            <Badge variant="outline" className="shrink-0 bg-background/50 border-accent/30 text-accent">
                              🕗 {stop.requestTime} น.
                            </Badge>
                          )}
                        </div>
                        
                        <div className="bg-background/50 p-3 rounded-lg border border-dashed border-border/50">
                          <p className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-wider">📦 รายการสินค้า / รายละเอียดงาน:</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{stop.cargoDetails || "ไม่มีรายละเอียด"}</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                          {stop.requestedBy && (
                            <div className="bg-accent/5 p-2 rounded-lg border border-accent/10">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-0.5">ผู้ขอใช้รถ:</p>
                              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                                <User className="h-3 w-3 text-accent" /> {stop.requestedBy}
                              </p>
                              {stop.requestedByPhone && (
                                <a href={`tel:${stop.requestedByPhone}`} className="text-xs text-orange-400 font-bold hover:underline flex items-center gap-1.5 mt-1">
                                  <Phone className="h-3 w-3" /> {stop.requestedByPhone}
                                </a>
                              )}
                            </div>
                          )}
                          {stop.note && (
                            <div className="bg-orange-500/5 p-2 rounded-lg border border-orange-500/10">
                              <p className="text-[10px] font-bold text-orange-400 uppercase mb-0.5">📌 หมายเหตุผู้ขอ:</p>
                              <p className="text-xs italic text-gray-300">"{stop.note}"</p>
                            </div>
                          )}
                        </div>

                        {stop.dispatcherNote && (
                          <div className="mt-2 bg-blue-600/5 p-2 rounded-lg border border-blue-600/20">
                            <p className="text-[10px] font-bold text-blue-400 uppercase mb-0.5 flex items-center gap-1">
                              <Info className="h-3 w-3" /> บันทึกจากจัดรถ:
                            </p>
                            <p className="text-xs text-blue-100">{stop.dispatcherNote}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="h-[300px] sm:h-[450px] overflow-hidden sticky top-20 md:top-24">
              <CardHeader className="bg-background/80 backdrop-blur z-10 border-b p-3">
                <CardTitle className="text-xs md:text-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RouteIcon className="h-4 w-4 text-accent" /> เส้นทางการเดินทาง
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-[#10b981]" /> เริ่มต้น
                    <div className="w-2 h-2 rounded-full bg-[#F0890D] ml-2" /> จุดส่ง
                  </div>
                </CardTitle>
              </CardHeader>
              <div ref={mapContainerRef} className="w-full h-full bg-muted/20" />
            </Card>
            
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="text-xs md:text-sm">สรุปเวลาเดินทาง (จาก Google Maps)</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="flex items-center gap-2 text-xl md:text-2xl font-bold">
                  <Clock className="h-5 w-5 md:h-6 md:w-6 text-accent" />
                  {formatDurationFormatted(finalDuration)}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">* คำนวณตามเวลาจราจรปัจจุบัน</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Share Dialog */}
      <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-500" /> ส่งใบงานให้คนขับ
            </DialogTitle>
            <DialogDescription>
              คนขับสามารถดูใบงานและนำทางได้ทันทีโดยไม่ต้องเข้าสู่ระบบ
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Link สำหรับคนขับ</p>
              <div className="flex items-center gap-2 p-3 bg-secondary/30 rounded-xl border border-border/50 group">
                <p className="text-sm font-medium truncate flex-1 text-blue-400">{driverUrl}</p>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 hover:bg-blue-500/10" onClick={handleCopyLink}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-blue-500" />}
                </Button>
              </div>
            </div>

            <div className="flex flex-col items-center gap-4 py-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">QR Code สำหรับสแกน</p>
              <div className="bg-white p-4 rounded-2xl shadow-inner border border-gray-100">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(driverUrl)}`}
                  alt="Trip QR Code"
                  className="w-48 h-48"
                />
              </div>
              <p className="text-[10px] text-muted-foreground italic">(สแกนเพื่อเปิดใบงานในโทรศัพท์มือถือ)</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="w-full h-11" onClick={() => setIsShareOpen(false)}>ปิดหน้าต่าง</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                ผู้ปฏิบัติงาน / ทะเบียนรถ<br/>วันที่บันทึก
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ border: '1px solid #000', padding: '10px', verticalAlign: 'top', textAlign: 'center' }}>
                {formatDisplayDate(trip.tripDate)}
              </td>
              <td style={{ border: '1px solid #000', padding: '10px', verticalAlign: 'top', textAlign: 'center' }}>
                {(trip as any).departureTime || "08:30"} น.
              </td>
              <td style={{ border: '1px solid #000', padding: '10px', verticalAlign: 'top' }}>
                {(trip.stops || []).map((stop: any, index: number) => (
                  <div key={index} style={{ marginBottom: '16px', borderBottom: index < trip.stops.length - 1 ? '1px dashed #ccc' : 'none', paddingBottom: '8px' }}>
                    <div style={{ fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{index + 1}. {stop.siteName}</span>
                      {stop.requestTime && <span style={{ fontWeight: 'normal', fontSize: '11px' }}>⏰ นัดหมาย: {stop.requestTime} น.</span>}
                    </div>
                    {stop.cargoDetails && (
                      <div style={{ marginLeft: '16px', fontSize: '12px', whiteSpace: 'pre-line', marginTop: '4px', backgroundColor: '#f9f9f9', padding: '4px' }}>
                        <strong>งาน:</strong> {stop.cargoDetails}
                      </div>
                    )}
                    <div style={{ marginLeft: '16px', marginTop: '6px', fontSize: '11px' }}>
                      <div style={{ color: '#444' }}>📍 สถานที่: {getStopLocation(stop)}</div>
                      {stop.requestedBy && (
                        <div style={{ color: '#222', marginTop: '2px' }}>
                          👤 ผู้ขอ: <strong>{stop.requestedBy}</strong> {stop.requestedByPhone && <span>(📞 {stop.requestedByPhone})</span>}
                        </div>
                      )}
                      {stop.note && <div style={{ color: '#666', marginTop: '2px' }}>📌 หมายเหตุ: <em>"{stop.note}"</em></div>}
                      {stop.dispatcherNote && <div style={{ color: '#0056b3', marginTop: '2px' }}>✏️ บันทึกจัดคิว: {stop.dispatcherNote}</div>}
                    </div>
                  </div>
                ))}
              </td>
              <td style={{ border: '1px solid #000', padding: '10px', verticalAlign: 'top', fontSize: '12px' }}>
                <div style={{ marginBottom: '6px' }}><strong>ผู้ขับ:</strong> {trip.driverName}</div>
                <div style={{ marginBottom: '6px' }}><strong>ทะเบียน:</strong> {trip.vehiclePlate}</div>
                <div style={{ marginTop: '12px', fontSize: '10px', color: '#555' }}>วันที่บันทึก: {formatDisplayDate(trip.createdAt)}</div>
              </td>
            </tr>
            <tr>
              <td colSpan={2} style={{ border: '1px solid #000', padding: '30px 10px 10px 10px', textAlign: 'center', verticalAlign: 'bottom' }}>
                <div style={{ marginBottom: '40px' }}>ลายเซ็นคนขับ</div>
                _________________________<br/>({trip.driverName})
              </td>
              <td colSpan={2} style={{ border: '1px solid #000', padding: '30px 10px 10px 10px', textAlign: 'center', verticalAlign: 'bottom' }}>
                <div style={{ marginBottom: '40px' }}>ลายเซ็นผู้อนุมัติ</div>
                _________________________<br/>วันที่ ______/______/______
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: '15px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
          <div><strong>ระยะทางรวม:</strong> {finalDistance.toFixed(1)} กม.</div>
          <div><strong>เวลาเดินทางโดยประมาณ:</strong> {formatDurationFormatted(finalDuration)}</div>
          <div style={{ fontStyle: 'italic' }}>* พิมพ์จากระบบ LOTUS GROUP Transport Management</div>
        </div>
      </div>
    </>
  )
}
