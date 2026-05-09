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
  Info,
  Table as TableIcon,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  CheckCircle2,
  ClipboardList
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
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { intelligentCargoDescriptionAssistant } from "@/ai/flows/cargo-description-assistant-flow"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { useCollection, useFirestore, useMemoFirebase, useDoc, useUser } from "@/firebase"
import { collection, serverTimestamp, doc, updateDoc, getDocs, query, where } from "firebase/firestore"
import { Site, Vehicle, Driver, CompanySetting } from "@/types/models"
import { setDocumentNonBlocking, updateDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useRouter } from "next/navigation"
import { Loader } from "@googlemaps/js-api-loader"

const DEFAULT_WAREHOUSE_LAT = 14.094126450195006
const DEFAULT_WAREHOUSE_LNG = 100.6893810570115

interface StopItem {
  id: string;
  siteId: string;
  cargo: string;
  customData?: {
    name: string;
    lat: number;
    lng: number;
  } | null;
  note?: string;
  dispatcherNote?: string;
  dispatcherName?: string;
}

export default function TripPlanPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const router = useRouter()
  const { user } = useUser()
  
  // Data Fetching
  const sitesRef = useMemoFirebase(() => db ? collection(db, "sites") : null, [db])
  const vehiclesRef = useMemoFirebase(() => db ? collection(db, "vehicles") : null, [db])
  const driversRef = useMemoFirebase(() => db ? collection(db, "drivers") : null, [db])
  const settingsRef = useMemoFirebase(() => db ? doc(db, "companySettings", "default") : null, [db])
  
  const { data: sites } = useCollection<Site>(sitesRef)
  const { data: vehicles } = useCollection<Vehicle>(vehiclesRef)
  const { data: drivers } = useCollection<Driver>(driversRef)
  const { data: companySettings } = useDoc<CompanySetting>(settingsRef)

  // Form State
  const [vehicleId, setVehicleId] = React.useState("")
  const [driverId, setDriverId] = React.useState("")
  const [tripDate, setTripDate] = React.useState(new Date().toISOString().split('T')[0])
  const [departurePointId, setDeparturePointId] = React.useState("warehouse")
  const [stops, setStops] = React.useState<StopItem[]>([
    { id: '1', siteId: '', cargo: '', customData: null }
  ])
  
  // Pending VR State
  const [pendingVr, setPendingVr] = React.useState<any>(null)

  // UI State
  const [isLoadingAi, setIsLoadingAi] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isApiLoaded, setIsApiLoaded] = React.useState(false)
  const [isAutoCalculating, setIsAutoCalculating] = React.useState(false)

  // Map State
  const mapRef = React.useRef<HTMLDivElement>(null)
  const [map, setMap] = React.useState<google.maps.Map | null>(null)
  const [directionsRenderer, setDirectionsRenderer] = React.useState<google.maps.DirectionsRenderer | null>(null)
  const [markers, setMarkers] = React.useState<google.maps.Marker[]>([])
  const [routeStats, setRouteStats] = React.useState<{ distance: string, duration: string, distanceNum: number, durationNum: number } | null>(null)
  const [isOptimizing, setIsOptimizing] = React.useState(false)
  const [infoWindow, setInfoWindow] = React.useState<google.maps.InfoWindow | null>(null)
  const [hoveredSiteId, setHoveredSiteId] = React.useState<string | null>(null)
  const [pinnedSiteId, setPinnedSiteId] = React.useState<string | null>(null)

  // Distance Caching & Visuals
  const distanceCache = React.useRef<Map<string, number>>(new Map())
  const distanceLinesRef = React.useRef<google.maps.Polyline[]>([])
  const distanceLabelsRef = React.useRef<google.maps.Marker[]>([])

  const clearDistanceLines = React.useCallback(() => {
    distanceLinesRef.current.forEach(l => l.setMap(null));
    distanceLabelsRef.current.forEach(m => m.setMap(null));
    distanceLinesRef.current = [];
    distanceLabelsRef.current = [];
  }, []);

  const calculateRoute = React.useCallback(async (optimize: boolean = false, isAuto: boolean = false) => {
    if (!map || !directionsRenderer || stops.some(s => !s.siteId) || !isApiLoaded) {
      if (!isAuto) {
        toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุจุดส่งของให้ครบถ้วนก่อนคำวณเส้นทาง", variant: "destructive" })
      }
      return
    }

    if (isAuto) setIsAutoCalculating(true)
    else setIsOptimizing(true)
    
    const google = window.google
    const directionsService = new google.maps.DirectionsService()
    
    try {
      const origin = { lat: DEFAULT_WAREHOUSE_LAT, lng: DEFAULT_WAREHOUSE_LNG }
      const waypointPromises = stops.filter(s => s.siteId).map(async (s) => {
        if (s.customData) {
          return { location: new google.maps.LatLng(s.customData.lat, s.customData.lng), stopover: true }
        }
        const site = sites?.find(site => site.id === s.siteId)
        if (!site || !site.latitude || !site.longitude) throw new Error(`ไม่พบพิกัดของไซน์งาน: ${site?.name || s.siteId}`)
        return { location: new google.maps.LatLng(site.latitude, site.longitude), stopover: true }
      })

      const resolvedWaypoints = await Promise.all(waypointPromises)
      const destination = resolvedWaypoints.pop()?.location

      if (!destination) throw new Error("กรุณาระบุจุดส่งของอย่างน้อย 1 จุด")

      directionsService.route({
        origin,
        destination,
        waypoints: resolvedWaypoints,
        optimizeWaypoints: optimize,
        travelMode: google.maps.TravelMode.DRIVING
      }, (result, status) => {
        setIsOptimizing(false)
        setIsAutoCalculating(false)
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
            duration: Math.floor(totalDuration / 3600) + " ชม. " + Math.floor((totalDuration % 3600) / 60) + " นาที",
            distanceNum: totalDistance / 1000,
            durationNum: totalDuration / 60
          })

          if (optimize) {
            toast({ title: "สำเร็จ!", description: "จัดเรียงลำดับจุดจอดที่สั้นที่สุดให้เรียบร้อยแล้ว" })
          }
        } else {
          if (!isAuto) {
            console.warn("Directions request failed due to " + status)
          }
        }
      })
    } catch (error: any) {
      setIsOptimizing(false)
      setIsAutoCalculating(false)
      if (!isAuto) {
        toast({ title: "แจ้งเตือน", description: error.message, variant: "destructive" })
      }
    }
  }, [map, directionsRenderer, stops, isApiLoaded, sites, toast]);

  // Load Pending VR from SessionStorage
  React.useEffect(() => {
    if (typeof window === "undefined") return
    const data = sessionStorage.getItem("pendingVR")
    if (data) {
      try {
        const vr = JSON.parse(data)
        setPendingVr(vr)
        setTripDate(vr.requestDate)
        // Set stops
        const newStops: StopItem[] = vr.destinations.map((d: any, idx: number) => ({
          id: `vr-${idx}`,
          siteId: d.type === 'site' ? d.siteId : `custom-${idx}`,
          cargo: d.jobDescription,
          customData: d.type === 'other' ? { name: d.siteName, lat: d.lat, lng: d.lng } : null,
          note: vr.note || vr.notes || "",
          dispatcherNote: vr.dispatcherNote || "",
          dispatcherName: vr.dispatcherName || ""
        }))
        setStops(newStops)
        toast({ title: "กู้คืนคำขอรถ", description: `กำลังจัดรถสำหรับคำขอ ${vr.vrId}` })
      } catch (e) {
        console.error("Error parsing pendingVR", e)
      }
    }
  }, [toast])

  // Effect for distance lines on hover
  React.useEffect(() => {
    if (!map || !hoveredSiteId || !isApiLoaded || markers.length === 0) {
      clearDistanceLines();
      return;
    }

    const google = window.google;
    const sourceMarker = markers.find(m => {
      if (hoveredSiteId === "warehouse") return m.getTitle()?.includes("คลังสินค้า");
      // Find by title or internal storage
      const site = sites?.find(s => s.id === hoveredSiteId);
      if (site && m.getTitle() === site.name) return true;
      // Handle custom stops
      const customStop = stops.find(s => s.siteId === hoveredSiteId);
      if (customStop && m.getTitle() === customStop.customData?.name) return true;
      return false;
    });

    if (!sourceMarker) return;

    const sourcePos = sourceMarker.getPosition();
    if (!sourcePos) return;

    const service = new google.maps.DistanceMatrixService();

    markers.forEach(targetMarker => {
      if (targetMarker === sourceMarker) return;

      const targetPos = targetMarker.getPosition();
      if (!targetPos) return;

      const cacheKey = `${sourcePos.lat()},${sourcePos.lng()}-${targetPos.lat()},${targetPos.lng()}`;
      
      const drawLine = (distanceText: string) => {
        const line = new google.maps.Polyline({
          path: [sourcePos, targetPos],
          geodesic: true,
          strokeColor: "#F0890D",
          strokeOpacity: 0.6,
          strokeWeight: 2,
          icons: [{
            icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
            offset: "0",
            repeat: "20px"
          }],
          map: map
        });
        distanceLinesRef.current.push(line);

        const midPoint = google.maps.geometry.spherical.computeOffset(
          sourcePos,
          google.maps.geometry.spherical.computeDistanceBetween(sourcePos, targetPos) / 2,
          google.maps.geometry.spherical.computeHeading(sourcePos, targetPos)
        );

        const label = new google.maps.Marker({
          position: midPoint,
          map: map,
          label: {
            text: distanceText,
            color: "#ffffff",
            fontSize: "10px",
            fontWeight: "bold",
            className: "bg-accent/80 px-1.5 py-0.5 rounded border border-white/20 whitespace-nowrap"
          },
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 }
        });
        distanceLabelsRef.current.push(label);
      };

      if (distanceCache.current.has(cacheKey)) {
        drawLine(distanceCache.current.get(cacheKey)!.toString() + " กม.");
      } else {
        service.getDistanceMatrix({
          origins: [sourcePos],
          destinations: [targetPos],
          travelMode: google.maps.TravelMode.DRIVING,
        }, (response, status) => {
          if (status === "OK" && response && response.rows[0].elements[0].status === "OK") {
            const distKm = response.rows[0].elements[0].distance.value / 1000;
            distanceCache.current.set(cacheKey, parseFloat(distKm.toFixed(1)));
            drawLine(distKm.toFixed(1) + " กม.");
          }
        });
      }
    });

    return () => clearDistanceLines();
  }, [hoveredSiteId, map, markers, isApiLoaded, sites, stops, clearDistanceLines]);

  // Auto-calculate Effect
  React.useEffect(() => {
    if (!isApiLoaded) return;
    
    const hasValidStops = stops.every(s => s.siteId !== "");
    if (!hasValidStops) return;

    const timer = setTimeout(() => {
      calculateRoute(false, true)
    }, 1000)

    return () => clearTimeout(timer)
  }, [stops, departurePointId, isApiLoaded, calculateRoute])

  const resetForm = () => {
    setVehicleId("")
    setDriverId("")
    setTripDate(new Date().toISOString().split('T')[0])
    setDeparturePointId("warehouse")
    setStops([{ id: '1', siteId: '', cargo: '', customData: null }])
    setRouteStats(null)
    setPendingVr(null)
    if (typeof window !== "undefined") sessionStorage.removeItem("pendingVR")
    if (directionsRenderer) directionsRenderer.setDirections({ routes: [] } as any)
    toast({ title: "ล้างข้อมูลเรียบร้อย", description: "เริ่มต้นเขียนแผนใหม่แล้ว" })
  }

  // Initialize Map
  React.useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || companySettings?.googleMapsApiKeyReference;
    
    if (!mapRef.current || !apiKey) return

    const loader = new Loader({
      apiKey: apiKey,
      version: "weekly",
      libraries: ["places", "geometry"]
    })

    loader.load().then(() => {
      const google = window.google
      const newMap = new google.maps.Map(mapRef.current!, {
        center: { lat: DEFAULT_WAREHOUSE_LAT, lng: DEFAULT_WAREHOUSE_LNG },
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        styles: [
          { featureType: "landscape", elementType: "all", color: "#2d3139" },
          { featureType: "road", elementType: "all", color: "#1a1c23" },
          { featureType: "water", elementType: "all", color: "#172899" }
        ]
      })

      const renderer = new google.maps.DirectionsRenderer({
        map: newMap,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: "#F0890D",
          strokeWeight: 5
        }
      })

      setMap(newMap)
      setDirectionsRenderer(renderer)
      setInfoWindow(new google.maps.InfoWindow())
      setIsApiLoaded(true)
    })
  }, [companySettings])

  const addStopBySiteId = React.useCallback((siteId: string) => {
    setStops(prev => {
      const emptyStopIndex = prev.findIndex(s => !s.siteId)
      if (emptyStopIndex !== -1) {
        const newStops = [...prev]
        newStops[emptyStopIndex] = { ...newStops[emptyStopIndex], siteId }
        return newStops
      }
      if (prev.length < 10) {
        return [...prev, { id: Date.now().toString(), siteId, cargo: '', customData: null }]
      }
      toast({ title: "เต็มแล้ว", description: "เพิ่มจุดส่งได้สูงสุด 10 จุด", variant: "destructive" })
      return prev
    })
    infoWindow?.close()
  }, [infoWindow, toast])

  React.useEffect(() => {
    if (!map || !sites || !window.google || !infoWindow || !isApiLoaded) return

    markers.forEach(m => m.setMap(null))
    
    const newMarkers: google.maps.Marker[] = []
    const google = window.google
    const bounds = new google.maps.LatLngBounds()

    const warehousePos = { lat: DEFAULT_WAREHOUSE_LAT, lng: DEFAULT_WAREHOUSE_LNG }
    const startMarker = new google.maps.Marker({
      position: warehousePos,
      map,
      title: "จุดเริ่มต้น (คลังสินค้า LOTUS GROUP)",
      icon: {
        path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
        scale: 7,
        fillColor: "#10b981",
        fillOpacity: 1,
        strokeWeight: 2,
        strokeColor: "#ffffff"
      }
    })
    
    startMarker.addListener("mouseover", () => setHoveredSiteId("warehouse"))
    startMarker.addListener("mouseout", () => setHoveredSiteId(null))
    startMarker.addListener("click", () => setPinnedSiteId(prev => prev === "warehouse" ? null : "warehouse"))
    
    newMarkers.push(startMarker)
    bounds.extend(warehousePos)

    sites.forEach((site) => {
      if (!site.latitude || !site.longitude) return
      
      const pos = { lat: site.latitude, lng: site.longitude }
      bounds.extend(pos)

      const stopIndex = stops.findIndex(s => s.siteId === site.id)
      const isSelected = stopIndex !== -1

      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: site.name,
        label: {
          text: site.name,
          color: "#ffffff",
          fontSize: "10px",
          fontWeight: "bold",
          className: "bg-black/60 px-1.5 py-0.5 rounded border border-white/20 translate-y-6 whitespace-nowrap"
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: isSelected ? 14 : 10,
          fillColor: isSelected ? "#3b82f6" : "#f59e0b",
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: "#ffffff"
        }
      })

      marker.addListener("mouseover", () => setHoveredSiteId(site.id))
      marker.addListener("mouseout", () => setHoveredSiteId(null))
      marker.addListener("click", () => {
        if (pinnedSiteId === site.id) {
          setPinnedSiteId(null)
        } else {
          setPinnedSiteId(site.id)
          const content = document.createElement("div")
          content.className = "p-2 min-w-[200px] text-foreground"
          content.innerHTML = `
            <div class="font-bold text-accent mb-1 text-xs">${site.name}</div>
            <div class="text-[10px] text-muted-foreground mb-3">${site.address}</div>
            ${!isSelected ? `
              <button id="btn-add-${site.id}" class="w-full bg-accent text-white text-[10px] py-2 px-2 rounded hover:bg-accent/80 transition-colors h-10">
                + เพิ่มเป็นจุดส่ง
              </button>
            ` : `<div class="text-[10px] font-bold text-blue-500">✓ เลือกเป็นจุดส่งที่ ${stopIndex+1} แล้ว</div>`}
          `
          infoWindow.setContent(content)
          infoWindow.open(map, marker)
          setTimeout(() => {
            const btn = document.getElementById(`btn-add-${site.id}`)
            if (btn) btn.onclick = () => addStopBySiteId(site.id)
          }, 100)
        }
      })

      newMarkers.push(marker)
    })

    // Render Custom VR Markers
    stops.forEach((stop, index) => {
      if (stop.customData) {
        const pos = { lat: stop.customData.lat, lng: stop.customData.lng }
        bounds.extend(pos)

        const marker = new google.maps.Marker({
          position: pos,
          map,
          title: stop.customData.name,
          label: {
            text: stop.customData.name,
            color: "#ffffff",
            fontSize: "10px",
            fontWeight: "bold",
            className: "bg-purple-600/80 px-1.5 py-0.5 rounded border border-white/20 translate-y-6 whitespace-nowrap"
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: "#9333ea",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#ffffff"
          }
        })

        marker.addListener("mouseover", () => setHoveredSiteId(stop.siteId))
        marker.addListener("mouseout", () => setHoveredSiteId(null))
        newMarkers.push(marker)
      }
    })

    if (sites.length > 0 || stops.some(s => s.customData)) {
      map.fitBounds(bounds)
    }

    setMarkers(newMarkers)
  }, [map, sites, stops, infoWindow, addStopBySiteId, isApiLoaded])

  const addStop = () => {
    if (stops.length < 10) {
      setStops([...stops, { id: Date.now().toString(), siteId: '', cargo: '', customData: null }])
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
    const hasValidStops = stops.some(s => s.siteId !== "");
    if (!vehicleId || !driverId || !tripDate || !hasValidStops) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณากรอกข้อมูลคนขับ รถ และจุดส่งอย่างน้อย 1 จุด", variant: "destructive" })
      return
    }

    setIsSaving(true)
    
    try {
      if (!routeStats || routeStats.distanceNum === 0) {
        await calculateRoute(false, true);
      }

      const selectedVehicle = vehicles?.find(v => v.id === vehicleId)
      const selectedDriver = drivers?.find(d => d.id === driverId)
      
      // Sequential Trip ID generation: T-DDMM-XXX
      const [year, month, day] = tripDate.split('-');
      const datePrefix = `T-${day}${month}`;
      const q = query(collection(db, "trips"), where("tripDate", "==", tripDate));
      const snapshot = await getDocs(q);
      const sequence = String(snapshot.size + 1).padStart(3, '0');
      const safety = Math.floor(Math.random() * 10);
      const tripId = `${datePrefix}-${sequence}${safety}`;

      const tripRef = doc(db, "trips", tripId)

      const tripStops = stops
        .filter(s => s.siteId !== "")
        .map((s, index) => {
          if (s.customData) {
            return {
              siteId: s.siteId,
              siteName: s.customData.name,
              order: index,
              cargoDetails: s.cargo,
              isCustom: true,
              lat: s.customData.lat,
              lng: s.customData.lng,
              note: s.note || "",
              dispatcherNote: s.dispatcherNote || "",
              dispatcherName: s.dispatcherName || ""
            }
          }
          const site = sites?.find(site => site.id === s.siteId)
          return {
            siteId: s.siteId,
            siteName: site?.name || "Unknown Site",
            order: index,
            cargoDetails: s.cargo,
            note: s.note || "",
            dispatcherNote: s.dispatcherNote || "",
            dispatcherName: s.dispatcherName || ""
          }
        })
      
      setDocumentNonBlocking(tripRef, {
        id: tripId,
        tripId: tripId,
        tripDate,
        vehicleId,
        vehiclePlate: selectedVehicle?.licensePlate || "",
        driverId,
        driverName: selectedDriver?.name || "",
        departureSiteId: departurePointId,
        stops: tripStops,
        totalDistanceKm: routeStats?.distanceNum || 0,
        totalEstimatedTimeMinutes: Math.round(routeStats?.durationNum || 0),
        status: "Planned",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        vrReferenceId: pendingVr?.vrId || null
      }, { merge: true })

      // Update VR status if this trip was generated from a request
      if (pendingVr) {
        const vrRef = doc(db, "vehicleRequests", pendingVr.docId)
        updateDoc(vrRef, {
          status: "approved",
          tripId: tripId,
          approvedBy: user?.email || "system",
          vehiclePlate: selectedVehicle?.licensePlate || "",
          driverName: selectedDriver?.name || "",
          approvedAt: serverTimestamp()
        })
        if (typeof window !== "undefined") sessionStorage.removeItem("pendingVR")
        toast({ title: "จัดรถสำเร็จ!", description: `${pendingVr.vrId} → Trip ${tripId}` })
      } else {
        toast({ title: "สำเร็จ", description: "บันทึกแผนเที่ยววิ่งเรียบร้อยแล้ว" })
      }

      router.push("/trips/history")
    } catch (error) {
      console.error(error)
      toast({ title: "Error", description: "เกิดข้อผิดพลาดในการบันทึก", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 overflow-x-hidden no-print">
      {pendingVr && (
        <Alert className="bg-accent/10 border-accent/30 text-accent animate-in slide-in-from-top-4 duration-500">
          <Truck className="h-5 w-5" />
          <AlertTitle className="font-bold">📋 กำลังจัดรถสำหรับคำขอ {pendingVr.vrId}</AlertTitle>
          <AlertDescription>
            ดึงข้อมูลจุดหมายจาก {pendingVr.requestedBy} เรียบร้อยแล้ว กรุณาเลือกคนขับและพาหนะเพื่อบันทึกงาน
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col lg:flex-row gap-6 h-auto">
        <div className="w-full lg:w-1/2 flex flex-col gap-6">
          <Card className="border-accent/20 bg-card/50">
            <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                <RouteIcon className="text-accent" /> ข้อมูลทั่วไป
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium">รถขนส่ง</label>
                  <Select value={vehicleId} onValueChange={setVehicleId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกพาหนะ" /></SelectTrigger>
                    <SelectContent>
                      {vehicles?.map(v => <SelectItem key={v.id} value={v.id}>{v.licensePlate} ({v.type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">คนขับรถ</label>
                  <Select value={driverId} onValueChange={setDriverId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกคนขับ" /></SelectTrigger>
                    <SelectContent>
                      {drivers?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">วันที่ส่งของ</label>
                  <Input type="date" className="h-11" value={tripDate} onChange={(e) => setTripDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">จุดเริ่มต้น</label>
                  <Select value={departurePointId} onValueChange={setDeparturePointId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกจุดเริ่มต้น" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warehouse">คลังสินค้า LOTUS GROUP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">ลำดับจุดส่งของ ({stops.length}/10)</h3>
              <Button variant="outline" size="sm" onClick={addStop} className="h-9 border-accent text-accent hover:bg-accent/10">
                <Plus className="mr-2 h-4 w-4" /> เพิ่มจุดส่ง
              </Button>
            </div>

            <div className="space-y-4">
              {stops.map((stop, index) => (
                <Card key={stop.id} className={cn(
                  "relative border-l-4 transition-colors overflow-hidden",
                  stop.customData ? "border-l-purple-600 bg-purple-900/5" : "border-l-primary bg-secondary/20"
                )}>
                  <CardContent className="p-3 md:p-4 flex gap-3 md:gap-4">
                    <div className="flex flex-col items-center justify-center text-muted-foreground shrink-0">
                      <span className={cn(
                        "text-xs font-bold text-white w-6 h-6 rounded-full flex items-center justify-center",
                        stop.customData ? "bg-purple-600" : "bg-primary"
                      )}>
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1">
                          {stop.customData ? (
                            <div className="h-11 px-3 flex items-center bg-background/50 rounded-md border text-sm font-bold text-purple-400">
                              <MapPin className="h-3 w-3 mr-2" /> {stop.customData.name}
                            </div>
                          ) : (
                            <Select value={stop.siteId} onValueChange={(val) => updateStop(stop.id, 'siteId', val)}>
                              <SelectTrigger className="h-11"><SelectValue placeholder="เลือกไซน์งาน" /></SelectTrigger>
                              <SelectContent>
                                {sites?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeStop(stop.id)} className="h-10 w-10 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                      <div className="relative">
                        <Textarea placeholder="รายละเอียดของที่ส่ง..." className="min-h-[80px] bg-background/50 resize-none border-dashed text-sm" value={stop.cargo} onChange={(e) => updateStop(stop.id, 'cargo', e.target.value)} />
                        <Button variant="ghost" size="icon" className="absolute right-2 bottom-2 text-accent h-8 w-8" onClick={() => handleAiDescription(stop.id, stop.cargo)} disabled={isLoadingAi === stop.id}>
                          <Sparkles className={cn("h-4 w-4", isLoadingAi === stop.id && "animate-pulse")} />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4 sticky bottom-0 bg-background/80 backdrop-blur pb-4 z-20">
            <Button className="flex-[2] bg-accent hover:bg-accent/90 shadow-lg shadow-accent/20 h-12" onClick={handleSaveTrip} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Navigation className="mr-2 h-4 w-4" />} บันทึกแผนเที่ยววิ่ง
            </Button>
            <Button variant="outline" className="flex-1 border-destructive text-destructive hover:bg-destructive/10 h-12" onClick={resetForm}>
              <RotateCcw className="mr-2 h-4 w-4" /> ล้างข้อมูล
            </Button>
          </div>
        </div>

        <div className="w-full lg:w-1/2 relative rounded-xl overflow-hidden border border-border shadow-2xl bg-card min-h-[350px] md:min-h-[500px] lg:min-h-0">
          <div className="absolute top-2 left-2 md:top-4 md:left-4 z-10 space-y-2 w-[calc(100%-16px)] sm:w-auto">
            <div className="bg-background/90 backdrop-blur p-3 md:p-4 rounded-lg border shadow-xl sm:max-w-xs">
              <h4 className="text-xs md:text-sm font-bold text-accent mb-2 flex items-center gap-2">
                <RouteIcon className="h-4 w-4" /> สรุปเส้นทาง
                {(isOptimizing || isAutoCalculating) && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
              </h4>
              <div className="space-y-1 md:space-y-2 text-[10px] md:text-xs">
                <div className="flex justify-between items-center py-1 border-b border-border/50">
                  <span className="text-muted-foreground">ระยะทางรวม:</span>
                  <span className="font-bold text-sm md:text-base text-white">{routeStats?.distance || "-- กม."}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-border/50">
                  <span className="text-muted-foreground">เวลาเดินทาง:</span>
                  <span className="font-bold text-white">{routeStats?.duration || "-- ชม. -- นาที"}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-3 md:mt-4">
                <Button size="sm" className="flex-1 h-9 text-[10px] md:text-[11px] bg-primary hover:bg-primary/90" onClick={() => calculateRoute(false)} disabled={isOptimizing || isAutoCalculating}>คำนวณ</Button>
                <Button size="sm" variant="outline" className="flex-1 h-9 text-[10px] md:text-[11px] border-accent text-accent" onClick={() => calculateRoute(true)} disabled={isOptimizing || isAutoCalculating}>สั้นที่สุด</Button>
              </div>
            </div>
          </div>
          <div className="absolute inset-0 z-0">
            <div ref={mapRef} className="w-full h-full bg-muted/20" />
          </div>
        </div>
      </div>
    </div>
  )
}
