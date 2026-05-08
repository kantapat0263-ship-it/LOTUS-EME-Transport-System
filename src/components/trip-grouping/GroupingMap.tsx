
"use client"

import * as React from "react"
import { Loader } from "@googlemaps/js-api-loader"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { doc } from "firebase/firestore"
import { CompanySetting } from "@/types/models"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Route, Zap, RefreshCcw, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"

interface GroupingMapProps {
  destinations: any[];
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
}

const DEFAULT_LAT = 13.7563
const DEFAULT_LNG = 100.5018
const HEAD_OFFICE_DEFAULT = { lat: 14.0815, lng: 100.7129 }

export function GroupingMap({ destinations, selectedIds, onSelect }: GroupingMapProps) {
  const db = useFirestore()
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<google.maps.Map | null>(null)
  const markersRef = React.useRef<google.maps.Marker[]>([])
  const infoWindowRef = React.useRef<google.maps.InfoWindow | null>(null)
  
  // Directions refs
  const directionsServiceRef = React.useRef<google.maps.DirectionsService | null>(null)
  const directionsRendererRef = React.useRef<google.maps.DirectionsRenderer | null>(null)
  
  // Refs for hover visuals
  const hoverPolylinesRef = React.useRef<google.maps.Polyline[]>([])
  const hoverLabelsRef = React.useRef<google.maps.Marker[]>([])
  const distanceCache = React.useRef<Map<string, number>>(new Map())

  // Route calculation state
  const [routeStats, setRouteStats] = React.useState<{ distance: string, duration: string } | null>(null)
  const [isCalculating, setIsCalculating] = React.useState(false)
  const [optimizeMode, setOptimizeMode] = React.useState(false)

  const settingRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: settings } = useDoc<CompanySetting>(settingRef)

  const clearHoverVisuals = React.useCallback(() => {
    hoverPolylinesRef.current.forEach(p => p.setMap(null))
    hoverLabelsRef.current.forEach(l => l.setMap(null))
    hoverPolylinesRef.current = []
    hoverLabelsRef.current = []
  }, [])

  const calculateRoute = React.useCallback(async (optimize: boolean = false) => {
    if (!directionsServiceRef.current || !directionsRendererRef.current || selectedIds.size === 0) {
      setRouteStats(null)
      directionsRendererRef.current?.setDirections({ routes: [] } as any)
      return
    }

    setIsCalculating(true)
    const google = window.google
    const selectedDests = destinations.filter(d => selectedIds.has(d.id))
    
    const origin = { 
      lat: settings?.warehouseLatitude || HEAD_OFFICE_DEFAULT.lat, 
      lng: settings?.warehouseLongitude || HEAD_OFFICE_DEFAULT.lng 
    }

    // Sort waypoints based on current list order or optimized
    const waypointList = [...selectedDests]
    const destination = waypointList.pop()
    const waypoints = waypointList.map(d => ({
      location: new google.maps.LatLng(d.lat, d.lng),
      stopover: true
    }))

    directionsServiceRef.current.route({
      origin: new google.maps.LatLng(origin.lat, origin.lng),
      destination: new google.maps.LatLng(destination.lat, destination.lng),
      waypoints: waypoints,
      optimizeWaypoints: optimize,
      travelMode: google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      setIsCalculating(false)
      if (status === 'OK' && result) {
        directionsRendererRef.current?.setDirections(result)
        
        let totalDist = 0
        let totalTime = 0
        const route = result.routes[0]
        
        route.legs.forEach(leg => {
          totalDist += leg.distance?.value || 0
          totalTime += leg.duration?.value || 0
        })

        const distanceText = (totalDist / 1000).toFixed(1) + " กม."
        const hours = Math.floor(totalTime / 3600)
        const mins = Math.round((totalTime % 3600) / 60)
        const durationText = hours > 0 ? `${hours} ชม. ${mins} นาที` : `${mins} นาที`

        setRouteStats({ distance: distanceText, duration: durationText })

        // Expose stats to window so parent can read it on "Create Trip"
        if (typeof window !== 'undefined') {
          (window as any).__lastTripStats = {
            distance: totalDist / 1000,
            duration: totalTime / 60
          }
        }
      }
    })
  }, [destinations, selectedIds, settings])

  // Debounced auto-calculate
  React.useEffect(() => {
    const timer = setTimeout(() => {
      calculateRoute(optimizeMode)
    }, 800)
    return () => clearTimeout(timer)
  }, [selectedIds, optimizeMode, calculateRoute])

  const getDistanceMatrix = React.useCallback((origin: google.maps.LatLng, targets: google.maps.LatLng[]): Promise<number[]> => {
    return new Promise((resolve) => {
      const service = new google.maps.DistanceMatrixService()
      service.getDistanceMatrix({
        origins: [origin],
        destinations: targets,
        travelMode: window.google.maps.TravelMode.DRIVING,
        unitSystem: window.google.maps.UnitSystem.METRIC,
      }, (response, status) => {
        if (status === 'OK' && response) {
          const distances = response.rows[0].elements.map(e => e.status === 'OK' ? e.distance.value / 1000 : 0)
          resolve(distances)
        } else {
          resolve(targets.map(() => 0))
        }
      })
    })
  }, [])

  const drawHoverDistances = React.useCallback((sourceMarker: google.maps.Marker) => {
    const google = window.google
    const map = mapRef.current
    if (!map || !google) return

    const sourcePos = sourceMarker.getPosition()
    if (!sourcePos) return

    const otherMarkers = markersRef.current.filter(m => m !== sourceMarker)
    if (otherMarkers.length === 0) return

    const targetsToFetch: google.maps.LatLng[] = []
    const targetsWithCache: { pos: google.maps.LatLng, dist: number }[] = []

    otherMarkers.forEach(m => {
      const pos = m.getPosition()
      if (!pos) return
      const key = `${sourcePos.lat().toFixed(5)},${sourcePos.lng().toFixed(5)}->${pos.lat().toFixed(5)},${pos.lng().toFixed(5)}`
      const cached = distanceCache.current.get(key)
      if (cached !== undefined) {
        targetsWithCache.push({ pos, dist: cached })
      } else {
        targetsToFetch.push(pos)
      }
    })

    const drawLine = (start: google.maps.LatLng, end: google.maps.LatLng, distanceKm: number) => {
      const polyline = new google.maps.Polyline({
        path: [start, end],
        geodesic: true,
        strokeColor: "#F0890D",
        strokeOpacity: 0,
        strokeWeight: 2,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, scale: 3 },
          offset: '0',
          repeat: '20px'
        }],
        map
      })
      hoverPolylinesRef.current.push(polyline)

      const midPoint = google.maps.geometry.spherical.computeOffset(
        start,
        google.maps.geometry.spherical.computeDistanceBetween(start, end) / 2,
        google.maps.geometry.spherical.computeHeading(start, end)
      )

      const label = new google.maps.Marker({
        position: midPoint,
        map,
        label: {
          text: `${distanceKm.toFixed(1)} กม.`,
          color: "#ffffff",
          fontSize: "10px",
          fontWeight: "bold",
          className: "bg-accent px-1.5 py-0.5 rounded border border-white/20 whitespace-nowrap shadow-md"
        },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 }
      })
      hoverLabelsRef.current.push(label)
    }

    targetsWithCache.forEach(t => drawLine(sourcePos, t.pos, t.dist))

    if (targetsToFetch.length > 0) {
      getDistanceMatrix(sourcePos, targetsToFetch).then(distances => {
        distances.forEach((distKm, idx) => {
          if (distKm > 0) {
            const targetPos = targetsToFetch[idx]
            const key = `${sourcePos.lat().toFixed(5)},${sourcePos.lng().toFixed(5)}->${targetPos.lat().toFixed(5)},${targetPos.lng().toFixed(5)}`
            const revKey = `${targetPos.lat().toFixed(5)},${targetPos.lng().toFixed(5)}->${sourcePos.lat().toFixed(5)},${sourcePos.lng().toFixed(5)}`
            distanceCache.current.set(key, distKm)
            distanceCache.current.set(revKey, distKm)
            drawLine(sourcePos, targetPos, distKm)
          }
        })
      })
    }
  }, [getDistanceMatrix])

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
    const officeLatLng = new google.maps.LatLng(officePos.lat, officePos.lng)

    const officeMarker = new google.maps.Marker({
      position: officePos,
      map,
      title: "คลังสินค้า LOTUS EME",
      icon: {
        path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
        scale: 8,
        fillColor: "#10b981", 
        fillOpacity: 1,
        strokeWeight: 2,
        strokeColor: "#ffffff"
      },
      label: {
        text: "LOTUS EME",
        color: "#10b981",
        fontWeight: "bold",
        fontSize: "11px",
        className: "bg-white/90 px-1.5 py-0.5 rounded border border-green-500 translate-y-[-40px] shadow-sm"
      }
    })

    officeMarker.addListener("click", () => {
      if (infoWindowRef.current) infoWindowRef.current.close()
      const iw = new google.maps.InfoWindow({
        content: `
          <div class="p-2 min-w-[180px] text-foreground">
            <p class="font-bold text-green-600 mb-1 text-sm">คลังสินค้า LOTUS EME</p>
            <p class="text-[10px] text-muted-foreground border-t border-border pt-1 mt-1">จุดเริ่มต้น - สำนักงานใหญ่นครนายก</p>
          </div>
        `
      })
      iw.open(map, officeMarker)
      infoWindowRef.current = iw
    })
    
    officeMarker.addListener("mouseover", () => drawHoverDistances(officeMarker))
    officeMarker.addListener("mouseout", () => clearHoverVisuals())

    newMarkers.push(officeMarker)
    bounds.extend(officePos)
    hasValidPoints = true

    destinations.forEach((d) => {
      if (d.lat && d.lng) {
        const isSelected = selectedIds.has(d.id)
        const pos = { lat: d.lat, lng: d.lng }
        const destLatLng = new google.maps.LatLng(d.lat, d.lng)
        bounds.extend(pos)

        const truncatedName = d.siteName.length > 15 ? d.siteName.substring(0, 12) + "..." : d.siteName

        const marker = new google.maps.Marker({
          position: pos,
          map,
          title: d.siteName,
          label: {
            text: truncatedName,
            color: "#ffffff",
            fontWeight: "bold",
            fontSize: "11px",
            className: "bg-black/60 px-1.5 py-0.5 rounded border border-white/20 translate-y-[32px] whitespace-nowrap shadow-sm"
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: isSelected ? 14 : 11,
            fillColor: isSelected ? "#3b82f6" : (d.type === 'site' ? "#f59e0b" : "#9333ea"),
            fillOpacity: 1,
            strokeWeight: isSelected ? 3 : 2,
            strokeColor: "#ffffff"
          }
        })

        marker.addListener("click", () => {
          if (infoWindowRef.current) infoWindowRef.current.close()
          const cacheKey = `${officePos.lat.toFixed(5)},${officePos.lng.toFixed(5)}->${d.lat.toFixed(5)},${d.lng.toFixed(5)}`
          const cachedDist = distanceCache.current.get(cacheKey)

          const updateInfoWindowContent = (distText: string) => {
            const iw = new google.maps.InfoWindow({
              content: `
                <div class="p-3 min-w-[220px] text-foreground space-y-2">
                  <div class="border-b pb-1.5">
                    <p class="font-bold text-accent text-sm">${d.siteName}</p>
                    <p class="text-[10px] text-muted-foreground">${d.vrId} • โดย ${d.requestedBy}</p>
                  </div>
                  <div class="space-y-1">
                    <p class="text-[10px] text-muted-foreground font-bold uppercase">ลักษณะงาน:</p>
                    <p class="text-[11px] leading-tight">${d.jobDescription || "ไม่ได้ระบุ"}</p>
                  </div>
                  <div class="pt-1.5 border-t flex justify-between items-center">
                    <span class="text-[10px] font-bold text-green-600">ระยะจากคลัง:</span>
                    <span class="text-[11px] font-bold">${distText}</span>
                  </div>
                  <button id="iw-btn-select-${d.id}" class="w-full mt-2 bg-primary text-white text-[10px] font-bold py-2 rounded hover:bg-primary/80 transition-all">
                    ${isSelected ? "ยกเลิกการเลือก" : "เลือกเข้า Trip"}
                  </button>
                </div>
              `
            })
            iw.open(map, marker)
            infoWindowRef.current = iw

            setTimeout(() => {
              const btn = document.getElementById(`iw-btn-select-${d.id}`)
              if (btn) btn.onclick = () => {
                onSelect(d.id)
                iw.close()
              }
            }, 100)
          }

          if (cachedDist) {
            updateInfoWindowContent(`${cachedDist.toFixed(1)} กม.`)
          } else {
            updateInfoWindowContent("กำลังคำนวณ...")
            getDistanceMatrix(officeLatLng, [destLatLng]).then(dists => {
              const dist = dists[0]
              if (dist > 0) {
                distanceCache.current.set(cacheKey, dist)
                updateInfoWindowContent(`${dist.toFixed(1)} กม.`)
              }
            })
          }
        })

        marker.addListener("mouseover", () => drawHoverDistances(marker))
        marker.addListener("mouseout", () => clearHoverVisuals())
        
        newMarkers.push(marker)
      }
    })

    if (hasValidPoints && selectedIds.size === 0) {
      map.fitBounds(bounds)
      if (destinations.length === 0) map.setZoom(12)
    }

    markersRef.current = newMarkers
  }, [destinations, selectedIds, onSelect, drawHoverDistances, clearHoverVisuals, settings, getDistanceMatrix])

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
        ],
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

    return () => {
      clearHoverVisuals()
    }
  }, [settings?.googleMapsApiKeyReference, updateMarkers, clearHoverVisuals])

  const destinationsHash = React.useMemo(() => 
    destinations.map(d => `${d.id}-${d.lat}-${d.lng}`).join('|'), 
    [destinations]
  )
  const selectionHash = React.useMemo(() => 
    Array.from(selectedIds).sort().join(','), 
    [selectedIds]
  )

  React.useEffect(() => {
    if (mapRef.current) {
      updateMarkers()
    }
  }, [destinationsHash, selectionHash, updateMarkers])

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
      
      {/* Route Summary Panel */}
      {selectedIds.size > 0 && (
        <Card className="absolute top-4 left-4 z-10 w-64 bg-background/90 backdrop-blur border-accent/30 shadow-2xl animate-in fade-in slide-in-from-left-4 duration-300">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-accent flex items-center gap-2 uppercase tracking-wider">
                <Route className="h-4 w-4" /> สรุปเส้นทาง
              </h4>
              {isCalculating && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
            </div>

            <div className="space-y-2 border-y border-border/50 py-3">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">จุดหมายที่เลือก:</span>
                <span className="font-bold text-white">{selectedIds.size} จุด</span>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-[10px] text-muted-foreground mb-0.5">ระยะทางรวม:</span>
                <span className="text-lg font-bold text-white">{routeStats?.distance || "-- กม."}</span>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-[10px] text-muted-foreground mb-0.5">เวลาเดินทาง:</span>
                <span className="text-sm font-bold text-white">{routeStats?.duration || "-- ชม. -- นาที"}</span>
              </div>
              {isCalculating && (
                <p className="text-[10px] text-accent animate-pulse text-center pt-1 font-medium">กำลังคำนวณเส้นทางที่ดีที่สุด...</p>
              )}
            </div>

            <div className="flex gap-2">
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
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-9 p-0 border-border hover:bg-secondary"
                onClick={() => calculateRoute(optimizeMode)}
                disabled={isCalculating}
                title="คำนวณใหม่"
              >
                <RefreshCcw className={cn("h-3.5 w-3.5", isCalculating && "animate-spin")} />
              </Button>
            </div>
            
            <p className="text-[9px] text-muted-foreground italic text-center leading-tight">
              * คำนวณจากสำนักงานใหญ่ไปยังจุดหมายตามลำดับ
            </p>
          </CardContent>
        </Card>
      )}

      {/* Origin Legend (Fixed Bottom Left) */}
      <div className="absolute bottom-4 left-4 z-10 bg-background/80 backdrop-blur p-2 rounded-lg border border-border/50 flex items-center gap-2 shadow-md">
        <div className="w-3 h-3 bg-[#10b981] rounded-sm transform rotate-45" />
        <span className="text-[10px] font-bold text-white uppercase tracking-tighter">จุดเริ่มต้น: คลังสินค้า LOTUS</span>
      </div>
    </div>
  )
}
