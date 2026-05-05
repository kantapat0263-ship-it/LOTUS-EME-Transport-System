
"use client"

import * as React from "react"
import { 
  Plus, 
  MapPin, 
  Navigation, 
  Trash2, 
  GripVertical, 
  Sparkles,
  Truck,
  User,
  Calendar as CalendarIcon,
  Route as RouteIcon,
  Loader2,
  AlertCircle,
  Info
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { intelligentCargoDescriptionAssistant } from "@/ai/flows/cargo-description-assistant-flow"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useCollection, useFirestore, useMemoFirebase, useDoc } from "@/firebase"
import { collection, serverTimestamp, doc } from "firebase/firestore"
import { Site, Vehicle, Driver, CompanySetting } from "@/types/models"
import { setDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useRouter } from "next/navigation"
import { Loader } from "@googlemaps/js-api-loader"

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""

export default function TripPlanPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const router = useRouter()
  
  // Data Fetching
  const sitesRef = useMemoFirebase(() => collection(db, "sites"), [db])
  const vehiclesRef = useMemoFirebase(() => collection(db, "vehicles"), [db])
  const driversRef = useMemoFirebase(() => collection(db, "drivers"), [db])
  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  
  const { data: sites } = useCollection<Site>(sitesRef)
  const { data: vehicles } = useCollection<Vehicle>(vehiclesRef)
  const { data: drivers } = useCollection<Driver>(driversRef)
  const { data: companySettings } = useDoc<CompanySetting>(settingsRef)

  // Form State
  const [vehicleId, setVehicleId] = React.useState("")
  const [driverId, setDriverId] = React.useState("")
  const [tripDate, setTripDate] = React.useState(new Date().toISOString().split('T')[0])
  const [stops, setStops] = React.useState([
    { id: '1', siteId: '', cargo: '' }
  ])
  const [isLoadingAi, setIsLoadingAi] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  // Map State
  const mapRef = React.useRef<HTMLDivElement>(null)
  const [map, setMap] = React.useState<google.maps.Map | null>(null)
  const [directionsRenderer, setDirectionsRenderer] = React.useState<google.maps.DirectionsRenderer | null>(null)
  const [markers, setMarkers] = React.useState<google.maps.Marker[]>([])
  const [routeStats, setRouteStats] = React.useState<{ distance: string, duration: string } | null>(null)
  const [isOptimizing, setIsOptimizing] = React.useState(false)
  const [infoWindow, setInfoWindow] = React.useState<google.maps.InfoWindow | null>(null)

  // Initialize Map
  React.useEffect(() => {
    if (!mapRef.current || !GOOGLE_MAPS_API_KEY) return

    const loader = new Loader({
      apiKey: GOOGLE_MAPS_API_KEY,
      version: "weekly",
      libraries: ["places"]
    })

    loader.load().then(() => {
      const google = window.google
      const newMap = new google.maps.Map(mapRef.current!, {
        center: { lat: 13.7563, lng: 100.5018 },
        zoom: 12,
        styles: [
          { featureType: "all", elementType: "labels.text.fill", color: "#ffffff" },
          { featureType: "all", elementType: "labels.text.stroke", color: "#000000" },
          { featureType: "landscape", elementType: "all", color: "#2d3139" },
          { featureType: "poi", elementType: "all", color: "#2d3139" },
          { featureType: "road", elementType: "all", color: "#1a1c23" },
          { featureType: "water", elementType: "all", color: "#172899" }
        ]
      })

      const renderer = new google.maps.DirectionsRenderer({
        map: newMap,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: "#F0890D",
          strokeWeight: 5,
          strokeOpacity: 0.8
        }
      })

      const iw = new google.maps.InfoWindow()

      setMap(newMap)
      setDirectionsRenderer(renderer)
      setInfoWindow(iw)
    }).catch(err => {
      console.error("Map load error:", err)
    })
  }, [])

  // Action: Add stop from InfoWindow
  const addStopBySiteId = React.useCallback((siteId: string) => {
    setStops(prev => {
      // Check if we already have an empty stop to fill
      const emptyStopIndex = prev.findIndex(s => !s.siteId)
      if (emptyStopIndex !== -1) {
        const newStops = [...prev]
        newStops[emptyStopIndex] = { ...newStops[emptyStopIndex], siteId }
        return newStops
      }
      // Otherwise add new
      if (prev.length < 10) {
        return [...prev, { id: Date.now().toString(), siteId, cargo: '' }]
      }
      toast({ title: "เต็มแล้ว", description: "เพิ่มจุดส่งได้สูงสุด 10 จุด", variant: "destructive" })
      return prev
    })
    infoWindow?.close()
  }, [infoWindow, toast])

  // Update Markers and Fit Bounds
  React.useEffect(() => {
    if (!map || !sites || !window.google || !infoWindow) return

    // Clear old markers
    markers.forEach(m => {
      window.google.maps.event.clearInstanceListeners(m)
      m.setMap(null)
    })
    
    const newMarkers: google.maps.Marker[] = []
    const google = window.google
    const bounds = new google.maps.LatLngBounds()

    // 1. Warehouse (Start Point)
    const warehouseLat = companySettings?.warehouseLatitude || 13.7563
    const warehouseLng = companySettings?.warehouseLongitude || 100.5018
    const warehousePos = { lat: warehouseLat, lng: warehouseLng }
    
    const startMarker = new google.maps.Marker({
      position: warehousePos,
      map,
      title: "จุดเริ่มต้น (คลังสินค้า)",
      icon: {
        path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
        scale: 7,
        fillColor: "#10b981", // GREEN
        fillOpacity: 1,
        strokeWeight: 2,
        strokeColor: "#ffffff"
      }
    })
    newMarkers.push(startMarker)
    bounds.extend(warehousePos)

    // 2. All Sites from Firestore
    sites.forEach((site) => {
      if (!site.latitude || !site.longitude) return
      
      const pos = { lat: site.latitude, lng: site.longitude }
      bounds.extend(pos)

      // Find if this site is selected as a stop
      const stopIndex = stops.findIndex(s => s.siteId === site.id)
      const isSelected = stopIndex !== -1

      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: site.name,
        label: isSelected ? {
          text: (stopIndex + 1).toString(),
          color: "#ffffff",
          fontWeight: "bold"
        } : undefined,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: isSelected ? 14 : 10,
          fillColor: isSelected ? "#3b82f6" : "#f59e0b", // BLUE if selected, ORANGE if not
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: "#ffffff"
        }
      })

      // Info Window Listener
      marker.addListener("click", () => {
        const content = document.createElement("div")
        content.className = "p-2 min-w-[200px] text-foreground"
        content.innerHTML = `
          <div class="font-bold text-accent mb-1">${site.name}</div>
          <div class="text-xs text-muted-foreground mb-3">${site.address}</div>
          ${!isSelected ? `
            <button id="btn-add-${site.id}" class="w-full bg-accent text-white text-[10px] py-1 px-2 rounded hover:bg-accent/80 transition-colors">
              + เพิ่มเป็นจุดส่ง
            </button>
          ` : `<div class="text-[10px] font-bold text-blue-500">✓ เลือกเป็นจุดส่งที่ ${stopIndex+1} แล้ว</div>`}
        `
        
        infoWindow.setContent(content)
        infoWindow.open(map, marker)

        // Bind button click (need to wait for DOM)
        setTimeout(() => {
          const btn = document.getElementById(`btn-add-${site.id}`)
          if (btn) {
            btn.onclick = () => addStopBySiteId(site.id)
          }
        }, 100)
      })

      newMarkers.push(marker)
    })

    // Auto-fit map bounds
    if (sites.length > 0) {
      map.fitBounds(bounds)
      // Don't zoom in too much if only 1 marker
      const listener = google.maps.event.addListener(map, 'idle', () => {
        if (map.getZoom()! > 15) map.setZoom(15)
        google.maps.event.removeListener(listener)
      })
    }

    setMarkers(newMarkers)
  }, [map, sites, stops, companySettings, infoWindow, addStopBySiteId])

  const calculateRoute = async (optimize: boolean = false) => {
    if (!map || !directionsRenderer || stops.some(s => !s.siteId)) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุจุดส่งของให้ครบถ้วนก่อนคำนวณเส้นทาง", variant: "destructive" })
      return
    }

    setIsOptimizing(true)
    const google = window.google
    const directionsService = new google.maps.DirectionsService()
    
    try {
      const origin = { 
        lat: companySettings?.warehouseLatitude || 13.7563, 
        lng: companySettings?.warehouseLongitude || 100.5018 
      }
      
      const waypointPromises = stops.map(async (s) => {
        const site = sites?.find(site => site.id === s.siteId)
        if (!site || !site.latitude || !site.longitude) throw new Error(`ไม่พบพิกัดของไซน์งาน: ${s.siteId}`)
        return { location: new google.maps.LatLng(site.latitude, site.longitude), stopover: true }
      })

      const resolvedWaypoints = await Promise.all(waypointPromises)
      const destination = resolvedWaypoints.pop()?.location

      if (!destination) {
        throw new Error("กรุณาระบุจุดส่งของอย่างน้อย 1 จุด")
      }

      directionsService.route({
        origin,
        destination,
        waypoints: resolvedWaypoints,
        optimizeWaypoints: optimize,
        travelMode: google.maps.TravelMode.DRIVING
      }, (result, status) => {
        setIsOptimizing(false)
        if (status === "OK" && result) {
          directionsRenderer.setDirections(result)
          
          const legs = result.routes[0].legs
          let totalDistance = 0
          let totalDuration = 0
          legs.forEach(leg => {
            totalDistance += leg.distance?.value || 0
            totalDuration += leg.duration?.value || 0
          })

          setRouteStats({
            distance: (totalDistance / 1000).toFixed(1) + " กม.",
            duration: Math.floor(totalDuration / 3600) + " ชม. " + Math.floor((totalDuration % 3600) / 60) + " นาที"
          })

          if (optimize) {
            toast({ title: "สำเร็จ!", description: "จัดเรียงลำดับจุดจอดที่สั้นที่สุดให้เรียบร้อยแล้ว" })
            // Note: In real app, we should update the stops state order based on result.routes[0].waypoint_order
          }
        } else {
          toast({ title: "Error", description: "ไม่สามารถคำนวณเส้นทางได้: " + status, variant: "destructive" })
        }
      })
    } catch (error: any) {
      setIsOptimizing(false)
      toast({ title: "แจ้งเตือน", description: error.message, variant: "destructive" })
    }
  }

  const addStop = () => {
    if (stops.length < 10) {
      setStops([...stops, { id: Date.now().toString(), siteId: '', cargo: '' }])
    }
  }

  const removeStop = (id: string) => {
    if (stops.length > 1) {
      setStops(stops.filter(s => s.id !== id))
    }
  }

  const updateStop = (id: string, field: string, value: string) => {
    setStops(stops.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  const handleAiDescription = async (stopId: string, currentDescription: string) => {
    if (!currentDescription) {
      toast({ title: "แจ้งเตือน", description: "กรุณาระบุคำอธิบายเบื้องต้น", variant: "destructive" })
      return
    }
    setIsLoadingAi(stopId)
    try {
      const result = await intelligentCargoDescriptionAssistant({ highLevelDescription: currentDescription })
      updateStop(stopId, 'cargo', result.detailedDescription)
    } catch (error) {
      toast({ title: "AI Error", description: "ไม่สามารถสร้างรายการสินค้าได้", variant: "destructive" })
    } finally {
      setIsLoadingAi(null)
    }
  }

  const handleSaveTrip = async () => {
    if (!vehicleId || !driverId || !tripDate || stops.some(s => !s.siteId)) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุข้อมูลให้ครบถ้วนก่อนบันทึก", variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const tripsRef = collection(db, "trips")
      const newTripRef = doc(tripsRef)
      const tripId = newTripRef.id
      
      setDocumentNonBlocking(newTripRef, {
        id: tripId,
        tripDate,
        vehicleId,
        driverId,
        status: "Planned",
        departureSiteId: "warehouse",
        stopIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })

      stops.forEach((stop, index) => {
        const stopRef = doc(collection(db, "trips", tripId, "tripStops"))
        setDocumentNonBlocking(stopRef, {
          id: stopRef.id,
          tripId: tripId,
          siteId: stop.siteId,
          orderIndex: index,
          plannedCargoDescription: stop.cargo,
          driverId: driverId,
          createdAt: serverTimestamp(),
        }, { merge: true })
      })

      toast({ title: "สำเร็จ", description: "บันทึกแผนเที่ยววิ่งเรียบร้อยแล้ว" })
      router.push("/trips/history")
    } catch (error) {
      toast({ title: "Error", description: "เกิดข้อผิดพลาดในการบันทึก", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="flex items-center justify-center h-full flex-col gap-4 text-center">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-bold">กรุณาใส่ Google Maps API Key ใน .env</h2>
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-160px)] animate-in slide-in-from-bottom-4 duration-700">
      <div className="w-full lg:w-1/2 flex flex-col gap-6 overflow-y-auto pr-2">
        <Card className="border-accent/20">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <RouteIcon className="text-accent" /> ข้อมูลทั่วไปของเที่ยววิ่ง
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">รถขนส่ง</label>
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger><SelectValue placeholder="เลือกพาหนะ" /></SelectTrigger>
                  <SelectContent>
                    {vehicles?.map(v => <SelectItem key={v.id} value={v.id}>{v.licensePlate} ({v.type})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">คนขับรถ</label>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger><SelectValue placeholder="เลือกคนขับ" /></SelectTrigger>
                  <SelectContent>
                    {drivers?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">วันที่ส่งของ</label>
                <Input type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">จุดเริ่มต้น</label>
                <Select defaultValue="warehouse">
                  <SelectTrigger><SelectValue placeholder="เลือกจุดเริ่มต้น" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warehouse">คลังสินค้า ({companySettings?.warehouseName || "สำนักงานใหญ่"})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">ลำดับจุดส่งของ ({stops.length}/10)</h3>
            <Button variant="outline" size="sm" onClick={addStop}><Plus className="mr-2 h-4 w-4" /> เพิ่มจุดส่ง</Button>
          </div>

          <div className="space-y-4">
            {stops.map((stop, index) => (
              <Card key={stop.id} className="relative border-l-4 border-l-primary">
                <CardContent className="p-4 flex gap-4">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <GripVertical className="h-5 w-5" />
                    <span className="text-xs font-bold mt-2 bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center">
                      {index + 1}
                    </span>
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <Select value={stop.siteId} onValueChange={(val) => updateStop(stop.id, 'siteId', val)}>
                          <SelectTrigger><SelectValue placeholder="เลือกไซน์งานปลายทาง" /></SelectTrigger>
                          <SelectContent>
                            {sites?.map(s => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name} {s.latitude && s.longitude ? "(📍)" : "(⚠️ ไม่มีพิกัด)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeStop(stop.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="relative">
                      <Textarea placeholder="รายละเอียดของที่ส่ง..." className="min-h-[80px] resize-none" value={stop.cargo} onChange={(e) => updateStop(stop.id, 'cargo', e.target.value)} />
                      <Button variant="ghost" size="icon" className="absolute right-2 bottom-2 text-accent" onClick={() => handleAiDescription(stop.id, stop.cargo)} disabled={isLoadingAi === stop.id}>
                        <Sparkles className={cn("h-4 w-4", isLoadingAi === stop.id && "animate-pulse")} />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="flex gap-4 pt-4 sticky bottom-0 bg-background/80 backdrop-blur pb-4">
          <Button className="flex-1 bg-accent hover:bg-accent/90" onClick={handleSaveTrip} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} บันทึกแผนเที่ยววิ่ง
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => window.print()}>พิมพ์ใบงานขนส่ง</Button>
        </div>
      </div>

      <div className="w-full lg:w-1/2 relative rounded-xl overflow-hidden border border-border shadow-2xl bg-card">
        {/* Map UI Overlays */}
        <div className="absolute top-4 left-4 z-10 space-y-2">
          <div className="bg-background/90 backdrop-blur p-3 rounded-lg border shadow-lg max-w-xs">
            <h4 className="text-sm font-bold text-accent mb-2">สรุปเส้นทาง</h4>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span>ระยะทางรวม:</span><span className="font-bold">{routeStats?.distance || "-- กม."}</span></div>
              <div className="flex justify-between"><span>เวลาเดินทางรวม:</span><span className="font-bold">{routeStats?.duration || "-- ชม. -- นาที"}</span></div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" className="flex-1 h-8 text-[10px] bg-primary" onClick={() => calculateRoute(false)} disabled={isOptimizing}>คำนวณเส้นทาง</Button>
              <Button size="sm" variant="outline" className="flex-1 h-8 text-[10px]" onClick={() => calculateRoute(true)} disabled={isOptimizing}>เส้นทางสั้นที่สุด</Button>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="absolute top-4 right-4 z-10 bg-background/90 backdrop-blur p-2 rounded-lg border shadow-lg text-[10px] space-y-1">
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-[#f59e0b] border border-white" /> ไซน์งานทั้งหมด</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-[#10b981] border border-white" /> จุดเริ่มต้น</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-[#3b82f6] border border-white" /> จุดส่งของที่เลือก</div>
        </div>

        <div className="absolute inset-0 z-0">
          <div ref={mapRef} className="w-full h-full bg-muted/20" />
        </div>
      </div>
    </div>
  )
}
