"use client"

import * as React from "react"
import { Loader } from "@googlemaps/js-api-loader"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { doc } from "firebase/firestore"
import { CompanySetting } from "@/types/models"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Route, Zap, RefreshCcw, Fuel, MousePointer2, Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

interface GroupingMapProps {
  destinations: any[];
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  selectedVehicleRate?: number;
  mode: 'auto' | 'manual';
  setMode: (mode: 'auto' | 'manual') => void;
  manualOrder: string[];
  onOptimizedOrderChange?: (ids: string[]) => void;
  hoveredId?: string | null;
}

const DEFAULT_LAT = 13.7563
const DEFAULT_LNG = 100.5018
const HEAD_OFFICE_DEFAULT = { lat: 14.0815, lng: 100.7129 }

export function GroupingMap({ 
  destinations, 
  selectedIds, 
  onSelect, 
  selectedVehicleRate,
  mode,
  setMode,
  manualOrder,
  onOptimizedOrderChange,
  hoveredId
}: GroupingMapProps) {
  const db = useFirestore()
  const { toast } = useToast()
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<google.maps.Map | null>(null)
  const markersRef = React.useRef<google.maps.Marker[]>([])
  
  const directionsServiceRef = React.useRef<google.maps.DirectionsService | null>(null)
  const directionsRendererRef = React.useRef<google.maps.DirectionsRenderer | null>(null)
  // Identifies the inputs of the last successfully rendered route so we can
  // skip redundant Google Directions API calls when nothing relevant changed.
  const lastRouteKeyRef = React.useRef<string | null>(null)

  const [routeStats, setRouteStats] = React.useState<{ 
    distance: string, 
    duration: string,
    returnDistance: string,
    totalDistance: string,
    fuelCost: string
  } | null>(null)
  
  const [isCalculating, setIsCalculating] = React.useState(false)
  const [optimizeMode, setOptimizeMode] = React.useState(true) // Default true for Auto mode

  const settingRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: settings } = useDoc<CompanySetting>(settingRef)

  const calculateRoute = React.useCallback(async (optimize: boolean = true, force: boolean = false) => {
    if (!directionsServiceRef.current || !directionsRendererRef.current) return;

    const count = mode === 'manual' ? manualOrder.length : selectedIds.size
    if (count === 0) {
      setRouteStats(null)
      directionsRendererRef.current?.setDirections({ routes: [] } as any)
      lastRouteKeyRef.current = null
      return
    }

    const google = window.google

    // Waypoints source
    const selectedDests = mode === 'manual'
      ? manualOrder.map(id => destinations.find(d => d.id === id)).filter(Boolean)
      : destinations.filter(d => selectedIds.has(d.id))

    if (selectedDests.length === 0) {
      return
    }

    const warehousePos = {
      lat: settings?.warehouseLatitude || HEAD_OFFICE_DEFAULT.lat,
      lng: settings?.warehouseLongitude || HEAD_OFFICE_DEFAULT.lng
    }

    // Skip the API round-trip when the exact same inputs were already routed
    // (e.g. unrelated re-renders). The refresh button passes force=true.
    const routeKey = JSON.stringify({
      mode,
      optimize: mode === 'auto' ? optimize : false,
      origin: [warehousePos.lat, warehousePos.lng],
      stops: selectedDests.map(d => `${d.id}@${d.lat},${d.lng}`)
    })
    if (!force && routeKey === lastRouteKeyRef.current) {
      return
    }

    setIsCalculating(true)
    const origin = new google.maps.LatLng(warehousePos.lat, warehousePos.lng)

    // For TRUE road optimization, we must use origin=warehouse and destination=warehouse
    // so Google knows it's a round trip and finds the best loop.
    const waypoints = selectedDests.map(d => ({
      location: new google.maps.LatLng(d.lat, d.lng),
      stopover: true
    }))

    directionsServiceRef.current.route({
      origin: origin,
      destination: origin, // Return to office for round trip optimization
      waypoints: waypoints,
      optimizeWaypoints: mode === 'auto' ? optimize : false,
      travelMode: google.maps.TravelMode.DRIVING,
      region: 'TH'
    }, (result, status) => {
      setIsCalculating(false)
      if (status === 'OK' && result) {
        lastRouteKeyRef.current = routeKey
        directionsRendererRef.current?.setDirections(result)

        const route = result.routes[0]
        
        // Handle Optimized Order callback
        if (mode === 'auto' && optimize && onOptimizedOrderChange) {
          const optimizedIndices = route.waypoint_order; // [2, 0, 1] means go to waypoints[2] first
          const optimizedIds = optimizedIndices.map(idx => selectedDests[idx].id);
          onOptimizedOrderChange(optimizedIds);
        }

        let totalDist = 0
        let totalTime = 0
        route.legs.forEach(leg => {
          totalDist += leg.distance?.value || 0
          totalTime += leg.duration?.value || 0
        })

        // Split out-bound and return for display
        // The last leg is always the return to office in our round-trip config
        const returnLeg = route.legs[route.legs.length - 1];
        const returnDistValue = returnLeg.distance?.value || 0;
        const outboundDistValue = totalDist - returnDistValue;

        const totalDistKm = totalDist / 1000
        const fuelRate = selectedVehicleRate || settings?.defaultFuelRate || 10
        const dieselPrice = settings?.dieselPrice || 32.5
        const fuelCost = (totalDistKm / fuelRate) * dieselPrice

        setRouteStats({ 
          distance: (outboundDistValue / 1000).toFixed(1) + " กม.",
          duration: Math.round(totalTime / 60) + " นาที",
          returnDistance: (returnDistValue / 1000).toFixed(1) + " กม.",
          totalDistance: totalDistKm.toFixed(1) + " กม.",
          fuelCost: fuelCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " บาท"
        })

        if (typeof window !== 'undefined') {
          (window as any).__lastTripStats = {
            distance: totalDistKm,
            duration: Math.round(totalTime / 60),
            fuelCost: fuelCost
          }
        }
      } else {
        // Allow the same inputs to be retried after a failure.
        lastRouteKeyRef.current = null
        toast({
          title: "การคำนวณล้มเหลว",
          description: "ไม่สามารถคำนวณเส้นทางถนนจริงได้ กรุณาลองใหม่",
          variant: "destructive"
        })
      }
    })
  }, [destinations, selectedIds, settings, selectedVehicleRate, mode, manualOrder, onOptimizedOrderChange, toast])

  React.useEffect(() => {
    const timer = setTimeout(() => {
      calculateRoute(optimizeMode)
    }, 800)
    return () => clearTimeout(timer)
  }, [selectedIds, manualOrder, optimizeMode, calculateRoute])

  const updateMarkers = React.useCallback(() => {
    const map = mapRef.current
    if (!map || !window.google) return

    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []
    
    const google = window.google
    const newMarkers: google.maps.Marker[] = []
    const bounds = new google.maps.LatLngBounds()
    let hasValidPoints = false

    const officePos = { 
      lat: settings?.warehouseLatitude || HEAD_OFFICE_DEFAULT.lat, 
      lng: settings?.warehouseLongitude || HEAD_OFFICE_DEFAULT.lng 
    }

    const officeMarker = new google.maps.Marker({
      position: officePos,
      map,
      title: settings?.warehouseName || "คลังสินค้า LOTUS EME",
      icon: {
        path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
        scale: 8,
        fillColor: "#10b981", 
        fillOpacity: 1,
        strokeWeight: 2,
        strokeColor: "#ffffff"
      },
      label: {
        text: "OFFICE",
        color: "#10b981",
        fontWeight: "bold",
        fontSize: "11px",
        className: "bg-white/90 px-1.5 py-0.5 rounded border border-green-500 translate-y-[-40px] shadow-sm"
      }
    })

    newMarkers.push(officeMarker)
    bounds.extend(officePos)
    hasValidPoints = true

    destinations.forEach((d) => {
      if (d.lat && d.lng) {
        let isSelected = false
        let labelText = ""
        let fillColor = ""

        if (mode === 'manual') {
          const orderIdx = manualOrder.indexOf(d.id)
          isSelected = orderIdx !== -1
          labelText = isSelected ? (orderIdx + 1).toString() : ""
          fillColor = isSelected ? "#2563eb" : "#6b7280"
        } else {
          isSelected = selectedIds.has(d.id)
          fillColor = isSelected ? "#3b82f6" : (d.type === 'site' ? "#f59e0b" : "#9333ea")
        }
        
        const pos = { lat: d.lat, lng: d.lng }
        bounds.extend(pos)

        // 1. Main Marker (Icon + Step Number if optimized/selected)
        const marker = new google.maps.Marker({
          position: pos,
          map,
          title: d.siteName,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: isSelected ? 15 : 11,
            fillColor: fillColor,
            fillOpacity: 1,
            strokeWeight: isSelected ? 3 : 2,
            strokeColor: "#ffffff"
          },
          label: labelText ? {
            text: labelText,
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: "bold"
          } : undefined
        })
        marker.addListener("click", () => onSelect(d.id))
        newMarkers.push(marker)

        // 2. Name Label Marker (Always Visible below icon)
        const truncatedName = d.siteName.length > 10 ? d.siteName.substring(0, 10) + "..." : d.siteName
        const nameLabelMarker = new google.maps.Marker({
          position: pos,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 0 // Invisible icon
          },
          clickable: false,
          label: {
            text: truncatedName,
            color: "#ffffff",
            fontSize: "10px",
            fontWeight: "bold",
            className: "bg-black/60 px-1.5 py-0.5 rounded border border-white/10 translate-y-[24px] whitespace-nowrap shadow-sm pointer-events-none"
          }
        })
        newMarkers.push(nameLabelMarker)
      }
    })

    if (hasValidPoints && (mode === 'manual' ? manualOrder.length === 0 : selectedIds.size === 0)) {
      map.fitBounds(bounds)
    }

    markersRef.current = newMarkers
  }, [destinations, selectedIds, manualOrder, onSelect, settings, mode])

  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || settings?.googleMapsApiKeyReference
    if (!apiKey) return

    const loader = new Loader({
      apiKey: apiKey,
      version: "weekly",
      libraries: ["places", "geometry"]
    })

    loader.load().then(() => {
      if (!mapContainerRef.current || mapRef.current) return

      const newMap = new google.maps.Map(mapContainerRef.current, {
        center: { lat: DEFAULT_LAT, lng: DEFAULT_LNG },
        zoom: 11,
        styles: [
          { featureType: "landscape", elementType: "all", color: "#2d3139" },
          { featureType: "road", elementType: "all", color: "#1a1c23" },
          { featureType: "water", elementType: "all", color: "#172899" }
        ] as unknown as google.maps.MapTypeStyle[],
        mapTypeControl: false,
        streetViewControl: false
      })
      
      directionsServiceRef.current = new google.maps.DirectionsService()
      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        map: newMap,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: "#F0890D",
          strokeWeight: 5,
          strokeOpacity: 0.8
        }
      })

      mapRef.current = newMap
      updateMarkers()
    })
  }, [settings?.googleMapsApiKeyReference, updateMarkers])

  React.useEffect(() => {
    if (mapRef.current) updateMarkers()
  }, [destinations, selectedIds, manualOrder, mode, updateMarkers])

  // Bounce animation on hover
  React.useEffect(() => {
    if (!window.google) return
    markersRef.current.forEach((marker, idx) => {
      // Find the main marker for this destination.
      // Every destination has 2 markers: the main circle and the name label.
      // Indexing logic: 0 = office, 1 = main dest 1, 2 = name dest 1, 3 = main dest 2, 4 = name dest 2...
      const destIndex = Math.floor((idx - 1) / 2);
      const isMainMarker = (idx - 1) % 2 === 0;
      
      const dest = destinations[destIndex];
      if (!dest || !isMainMarker) return;

      if (dest.id === hoveredId) {
        marker.setAnimation(google.maps.Animation.BOUNCE)
      } else {
        marker.setAnimation(null)
      }
    })
  }, [hoveredId, destinations])

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
      
      {/* Mode Switcher */}
      <div className="absolute top-4 right-4 z-20 flex bg-background/90 backdrop-blur p-1 rounded-lg border border-border shadow-xl">
        <Button 
          variant={mode === 'auto' ? "default" : "ghost"} 
          size="sm"
          className={cn("h-8 text-[10px] font-bold px-3", mode === 'auto' && "bg-accent")}
          onClick={() => {
            setMode('auto')
            setOptimizeMode(true)
          }}
        >
          <Wand2 className="h-3.5 w-3.5 mr-1.5" /> ⚡ อัตโนมัติ
        </Button>
        <Button 
          variant={mode === 'manual' ? "default" : "ghost"} 
          size="sm"
          className={cn("h-8 text-[10px] font-bold px-3", mode === 'manual' && "bg-accent")}
          onClick={() => setMode('manual')}
        >
          <MousePointer2 className="h-3.5 w-3.5 mr-1.5" /> ✋ จัดลำดับเอง
        </Button>
      </div>

      {/* Instruction Banner */}
      {mode === 'manual' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 w-auto px-4 py-2 bg-blue-600/90 text-white rounded-full border border-blue-400 shadow-xl text-[11px] font-bold animate-bounce">
          👆 กดเลือกจุดที่จะไปตามลำดับ — แตะซ้ำเพื่อยกเลิก
        </div>
      )}
      
      {(mode === 'manual' ? manualOrder.length > 0 : selectedIds.size > 0) && (
        <Card className="absolute top-4 left-4 z-10 w-72 bg-background/90 backdrop-blur border-accent/30 shadow-2xl animate-in fade-in slide-in-from-left-4 duration-300">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-accent flex items-center gap-2 uppercase tracking-wider">
                <Route className="h-4 w-4" /> สรุปเส้นทาง
              </h4>
              {isCalculating && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
            </div>

            <div className="space-y-2 border-y border-border/50 py-3">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">จุดหมายที่เลือก:</span>
                <span className="font-bold text-white">{(mode === 'manual' ? manualOrder.length : selectedIds.size)} จุด</span>
              </div>
              
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground">ระยะทางไป:</span>
                  <span className="font-medium text-white">{routeStats?.distance || "-- กม."}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground">ขากลับออฟฟิศ:</span>
                  <span className="font-medium text-white">+{routeStats?.returnDistance || "-- กม."}</span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-dashed border-border/50">
                  <span className="text-[11px] font-bold text-accent">รวมระยะทาง:</span>
                  <span className="text-sm font-bold text-white">{routeStats?.totalDistance || "-- กม."}</span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-border/50">
                <div className="flex justify-between items-center bg-accent/5 p-2 rounded-lg border border-accent/20">
                  <div className="flex items-center gap-2">
                    <Fuel className="h-4 w-4 text-accent" />
                    <span className="text-[10px] font-bold text-accent uppercase">ค่าน้ำมัน:</span>
                  </div>
                  <span className="text-sm font-bold text-white">{routeStats?.fuelCost || "-- บาท"}</span>
                </div>
                <p className="text-[9px] text-muted-foreground mt-1 text-center italic">
                  * คิดจาก {selectedVehicleRate || settings?.defaultFuelRate || 10} กม./ลิตร | {settings?.dieselPrice || 32.5} บ./ล.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              {mode === 'auto' && (
                <Button 
                  size="sm" 
                  variant={optimizeMode ? "default" : "outline"}
                  className={cn(
                    "flex-1 h-9 text-[10px] font-bold transition-all",
                    optimizeMode ? "bg-accent hover:bg-accent/80" : "border-accent/40 text-accent hover:bg-accent/5"
                  )}
                  onClick={() => setOptimizeMode(!optimizeMode)}
                  disabled={isCalculating}
                >
                  <Zap className={cn("h-3 w-3 mr-1.5", optimizeMode && "fill-white")} />
                  {optimizeMode ? "โหมดสั้นที่สุด" : "จัดลำดับใหม่"}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-9 p-0 border-border hover:bg-secondary flex-1"
                onClick={() => calculateRoute(mode === 'auto' ? optimizeMode : false, true)}
                disabled={isCalculating}
              >
                <RefreshCcw className={cn("h-3.5 w-3.5 mr-1", isCalculating && "animate-spin")} />
                <span className="text-[10px]">รีเฟรช</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
