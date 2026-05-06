
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
  CheckCircle2
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { intelligentCargoDescriptionAssistant } from "@/ai/flows/cargo-description-assistant-flow"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { useCollection, useFirestore, useMemoFirebase, useDoc } from "@/firebase"
import { collection, serverTimestamp, doc, setDoc } from "firebase/firestore"
import { Site, Vehicle, Driver, CompanySetting } from "@/types/models"
import { setDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useRouter } from "next/navigation"
import { Loader } from "@googlemaps/js-api-loader"

const DEFAULT_WAREHOUSE_LAT = 14.094126450195006
const DEFAULT_WAREHOUSE_LNG = 100.6893810570115
const STORAGE_KEY = "lotus_trip_draft"

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
  const [departurePointId, setDeparturePointId] = React.useState("warehouse")
  const [stops, setStops] = React.useState([
    { id: '1', siteId: '', cargo: '' }
  ])
  
  // UI State
  const [isLoadingAi, setIsLoadingAi] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [showDraftBanner, setShowDraftBanner] = React.useState(false)
  const [draftTime, setDraftTime] = React.useState<number | null>(null)
  const [showSaveIndicator, setShowSaveIndicator] = React.useState(false)
  const [isApiLoaded, setIsApiLoaded] = React.useState(false)

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

  // Distance Matrix State
  const [distanceMatrix, setDistanceMatrix] = React.useState<Record<string, Record<string, number>>>({})
  const [isMatrixLoading, setIsMatrixLoading] = React.useState(false)
  const [isMatrixOpen, setIsMatrixOpen] = React.useState(false)
  
  // Persistence: Restore Draft on Mount
  React.useEffect(() => {
    const draftJson = localStorage.getItem(STORAGE_KEY)
    if (draftJson) {
      try {
        const draft = JSON.parse(draftJson)
        setDraftTime(draft.lastUpdated)
        setShowDraftBanner(true)
      } catch (e) {
        console.error("Failed to parse draft", e)
      }
    }
  }, [])

  // Persistence: Auto-save Effect
  React.useEffect(() => {
    if (isSaving) return;
    
    const draftData = {
      vehicleId,
      driverId,
      date: tripDate,
      departurePointId,
      stops,
      lastUpdated: Date.now()
    }
    
    const timeout = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draftData))
      setShowSaveIndicator(true)
      setTimeout(() => setShowSaveIndicator(false), 2000)
    }, 1000)

    return () => clearTimeout(timeout)
  }, [vehicleId, driverId, tripDate, departurePointId, stops, isSaving])

  const useDraftData = () => {
    const draftJson = localStorage.getItem(STORAGE_KEY)
    if (draftJson) {
      const draft = JSON.parse(draftJson)
      setVehicleId(draft.vehicleId || "")
      setDriverId(draft.driverId || "")
      setTripDate(draft.date || new Date().toISOString().split('T')[0])
      setDeparturePointId(draft.departurePointId || "warehouse")
      setStops(draft.stops || [{ id: '1', siteId: '', cargo: '' }])
      setShowDraftBanner(false)
      toast({ title: "กู้คืนข้อมูลสำเร็จ", description: "ข้อมูลร่างถูกนำมาใช้งานแล้ว" })
    }
  }

  const resetForm = () => {
    setVehicleId("")
    setDriverId("")
    setTripDate(new Date().toISOString().split('T')[0])
    setDeparturePointId("warehouse")
    setStops([{ id: '1', siteId: '', cargo: '' }])
    setRouteStats(null)
    localStorage.removeItem(STORAGE_KEY)
    setShowDraftBanner(false)
    if (directionsRenderer) directionsRenderer.setDirections({ routes: [] } as any)
    toast({ title: "ล้างข้อมูลเรียบร้อย", description: "เริ่มต้นเขียนแผนใหม่แล้ว" })
  }

  // Initialize Map with API Key fallback
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

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      distanceLinesRef.current.forEach(l => l.setMap(null))
      distanceLabelsRef.current.forEach(l => l.setMap(null))
    }
  }, [])

  // Calculate Distance Matrix (for the table) - Batch to avoid MAX_ELEMENTS error
  const fetchDistanceMatrix = React.useCallback(async () => {
    if (!sites || sites.length === 0 || !window.google || !isApiLoaded) return
    if (!google.maps.DistanceMatrixService) return

    setIsMatrixLoading(true)
    const validSites = sites.filter(s => s.latitude && s.longitude)
    const allPoints = [
      { lat: DEFAULT_WAREHOUSE_LAT, lng: DEFAULT_WAREHOUSE_LNG },
      ...validSites.map(s => ({ lat: s.latitude!, lng: s.longitude! }))
    ]
    const allIds = ["warehouse", ...validSites.map(s => s.id)]

    const matrixService = new google.maps.DistanceMatrixService()
    const newMatrix: Record<string, Record<string, number>> = {}

    try {
      for (let i = 0; i < allPoints.length; i++) {
        const originId = allIds[i]
        const originLatLng = allPoints[i]
        newMatrix[originId] = {}

        for (let j = 0; j < allPoints.length; j += 25) {
          const destinationBatch = allPoints.slice(j, j + 25)
          const destinationIdsBatch = allIds.slice(j, j + 25)

          const response = await new Promise<google.maps.DistanceMatrixResponse | null>((resolve) => {
            matrixService.getDistanceMatrix({
              origins: [originLatLng],
              destinations: destinationBatch,
              travelMode: google.maps.TravelMode.DRIVING,
              unitSystem: google.maps.UnitSystem.METRIC,
            }, (res, status) => {
              if (status === "OK" && res) {
                resolve(res)
              } else {
                console.warn(`Distance Matrix request failed for origin ${originId} batch ${j}: ${status}`)
                resolve(null)
              }
            })
          })

          if (response && response.rows[0]) {
            response.rows[0].elements.forEach((element, k) => {
              const destId = destinationIdsBatch[k]
              if (element.status === "OK") {
                newMatrix[originId][destId] = element.distance.value / 1000
              }
            })
          }
        }
      }

      setDistanceMatrix(newMatrix)
    } catch (error) {
      console.error("Distance Matrix Error:", error)
    } finally {
      setIsMatrixLoading(false)
    }
  }, [sites, isApiLoaded])

  React.useEffect(() => {
    if (sites && isApiLoaded && isMatrixOpen) {
      fetchDistanceMatrix()
    }
  }, [sites, isApiLoaded, isMatrixOpen, fetchDistanceMatrix])

  // Cell color helper logic
  const getCellColor = (originId: string, destId: string, value: number | undefined) => {
    if (!value || originId === destId || value === 0) return ''
    
    const row = distanceMatrix[originId]
    if (!row) return ''
    
    const validValues = Object.entries(row)
      .filter(([id, val]) => id !== originId && typeof val === 'number' && val > 0)
      .map(([_, val]) => val as number)
    
    if (validValues.length === 0) return ''
    
    const min = Math.min(...validValues)
    const max = Math.max(...validValues)
    
    if (value === min) return 'bg-green-900 text-green-300 font-bold ring-1 ring-green-500'
    if (value === max) return 'bg-red-900 text-red-300'
    return ''
  }

  // Column average analysis logic
  const bestColumnId = React.useMemo(() => {
    if (!distanceMatrix || Object.keys(distanceMatrix).length === 0) return null
    
    const allIds = ["warehouse", ...(sites?.filter(s => s.latitude).map(s => s.id) || [])]
    const columnStats: Record<string, { sum: number, count: number }> = {}
    
    allIds.forEach(destId => {
      columnStats[destId] = { sum: 0, count: 0 }
      allIds.forEach(originId => {
        const val = distanceMatrix[originId]?.[destId]
        if (typeof val === 'number' && val > 0 && originId !== destId) {
          columnStats[destId].sum += val
          columnStats[destId].count += 1
        }
      })
    })
    
    let minAvg = Infinity
    let bestId = null
    
    Object.entries(columnStats).forEach(([id, stat]) => {
      if (stat.count > 0) {
        const avg = stat.sum / stat.count
        if (avg < minAvg) {
          minAvg = avg
          bestId = id
        }
      }
    })
    
    return bestId
  }, [distanceMatrix, sites])

  // Draw Hover/Pinned Distance Lines with REAL ROAD DISTANCE
  React.useEffect(() => {
    if (!map || !sites || !window.google || !isApiLoaded) return
    const google = window.google

    distanceLinesRef.current.forEach(l => l.setMap(null))
    distanceLabelsRef.current.forEach(l => l.setMap(null))
    distanceLinesRef.current = []
    distanceLabelsRef.current = []

    const targetId = pinnedSiteId || hoveredSiteId
    if (!targetId) return

    const validSites = sites.filter(s => s.latitude && s.longitude)
    const originSite = targetId === "warehouse" 
      ? { id: "warehouse", latitude: DEFAULT_WAREHOUSE_LAT, longitude: DEFAULT_WAREHOUSE_LNG } 
      : sites.find(s => s.id === targetId)

    if (!originSite || !originSite.latitude || !originSite.longitude) return

    const originLatLng = new google.maps.LatLng(originSite.latitude, originSite.longitude)
    const matrixService = new google.maps.DistanceMatrixService()
    const labelMarkersMap = new Map<string, google.maps.Marker>()
    const destinationsToFetch: { id: string, latLng: google.maps.LatLng, site: Site | any }[] = []

    validSites.forEach(dest => {
      if (dest.id === targetId || !dest.latitude || !dest.longitude) return
      
      const destLatLng = new google.maps.LatLng(dest.latitude, dest.longitude)
      const path = [
        { lat: originSite.latitude!, lng: originSite.longitude! },
        { lat: dest.latitude!, lng: dest.longitude! }
      ]

      const line = new google.maps.Polyline({
        path,
        map,
        strokeColor: "#F0890D",
        strokeOpacity: 0,
        icons: [{
          icon: {
            path: 'M 0,-1 0,1',
            strokeOpacity: 1,
            scale: 2,
            strokeWeight: 2,
            strokeColor: '#F0890D'
          },
          offset: '0',
          repeat: '10px'
        }],
        geodesic: true
      })
      distanceLinesRef.current.push(line)

      const midPoint = google.maps.geometry.spherical.interpolate(originLatLng, destLatLng, 0.5)
      
      const cacheKey = `${originSite.latitude},${originSite.longitude}->${dest.latitude},${dest.longitude}`
      const cachedDist = distanceCache.current.get(cacheKey)

      const labelMarker = new google.maps.Marker({
        position: midPoint,
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0
        },
        label: {
          text: cachedDist !== undefined ? `${cachedDist.toFixed(1)} กม.` : "กำลังคำนวณ...",
          color: "#ffffff",
          fontSize: "10px",
          fontWeight: "bold",
          className: "bg-black/80 px-1.5 py-0.5 rounded-sm border border-white/20 whitespace-nowrap"
        }
      })
      distanceLabelsRef.current.push(labelMarker)
      labelMarkersMap.set(dest.id, labelMarker)

      if (cachedDist === undefined) {
        destinationsToFetch.push({ id: dest.id, latLng: destLatLng, site: dest })
      }
    })

    if (destinationsToFetch.length > 0) {
      for (let i = 0; i < destinationsToFetch.length; i += 25) {
        const batch = destinationsToFetch.slice(i, i + 25)
        
        matrixService.getDistanceMatrix({
          origins: [originLatLng],
          destinations: batch.map(b => b.latLng),
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.METRIC,
        }, (response, status) => {
          if (status === 'OK' && response) {
            const results = response.rows[0].elements
            results.forEach((element, idx) => {
              const destItem = batch[idx]
              const labelMarker = labelMarkersMap.get(destItem.id)
              const cacheKey = `${originSite.latitude},${originSite.longitude}->${destItem.site.latitude},${destItem.site.longitude}`
              
              let displayText = ""
              if (element.status === 'OK' && element.distance) {
                const roadDistKm = element.distance.value / 1000
                distanceCache.current.set(cacheKey, roadDistKm)
                displayText = `${roadDistKm.toFixed(1)} กม.`
              } else {
                const straightDistMeters = google.maps.geometry.spherical.computeDistanceBetween(originLatLng, destItem.latLng)
                const straightDistKm = straightDistMeters / 1000
                displayText = `${straightDistKm.toFixed(1)} กม. (เส้นตรง)`
              }

              if (labelMarker) {
                labelMarker.setLabel({
                  text: displayText,
                  color: "#ffffff",
                  fontSize: "10px",
                  fontWeight: "bold",
                  className: "bg-black/80 px-1.5 py-0.5 rounded-sm border border-white/20 whitespace-nowrap"
                })
              }
            })
          }
        })
      }
    }
  }, [map, hoveredSiteId, pinnedSiteId, sites, isApiLoaded])

  const addStopBySiteId = React.useCallback((siteId: string) => {
    setStops(prev => {
      const emptyStopIndex = prev.findIndex(s => !s.siteId)
      if (emptyStopIndex !== -1) {
        const newStops = [...prev]
        newStops[emptyStopIndex] = { ...newStops[emptyStopIndex], siteId }
        return newStops
      }
      if (prev.length < 10) {
        return [...prev, { id: Date.now().toString(), siteId, cargo: '' }]
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
      title: "จุดเริ่มต้น (คลังสินค้า LOTUS EME)",
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
          text: isSelected ? `${stopIndex + 1}: ${site.name}` : site.name,
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

    if (sites.length > 0) {
      map.fitBounds(bounds)
    }

    setMarkers(newMarkers)
  }, [map, sites, stops, infoWindow, addStopBySiteId, isApiLoaded])

  const calculateRoute = async (optimize: boolean = false) => {
    if (!map || !directionsRenderer || stops.some(s => !s.siteId) || !isApiLoaded) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุจุดส่งของให้ครบถ้วนก่อนคำนวณเส้นทาง", variant: "destructive" })
      return
    }

    setIsOptimizing(true)
    const google = window.google
    const directionsService = new google.maps.DirectionsService()
    
    try {
      const origin = { lat: DEFAULT_WAREHOUSE_LAT, lng: DEFAULT_WAREHOUSE_LNG }
      const waypointPromises = stops.map(async (s) => {
        const site = sites?.find(site => site.id === s.siteId)
        if (!site || !site.latitude || !site.longitude) throw new Error(`ไม่พบพิกัดของไซน์งาน: ${s.siteId}`)
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
    const hasValidStops = stops.some(s => s.siteId !== "");
    if (!vehicleId || !driverId || !tripDate || !hasValidStops) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณากรอกข้อมูลคนขับ รถ และจุดส่งอย่างน้อย 1 จุด", variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const selectedVehicle = vehicles?.find(v => v.id === vehicleId)
      const selectedDriver = drivers?.find(d => d.id === driverId)
      
      const tripRandomId = Math.floor(1000 + Math.random() * 9000).toString();
      const tripId = `T-${tripRandomId}`
      const tripRef = doc(db, "trips", tripId)

      const tripStops = stops
        .filter(s => s.siteId !== "")
        .map((s, index) => {
          const site = sites?.find(site => site.id === s.siteId)
          return {
            siteId: s.siteId,
            siteName: site?.name || "Unknown Site",
            order: index,
            cargoDetails: s.cargo
          }
        })
      
      await setDoc(tripRef, {
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
      })

      localStorage.removeItem(STORAGE_KEY)
      toast({ title: "สำเร็จ", description: "บันทึกแผนเที่ยววิ่งเรียบร้อยแล้ว" })
      router.push("/trips/history")
    } catch (error) {
      toast({ title: "Error", description: "เกิดข้อผิดพลาดในการบันทึก", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const activeSites = sites?.filter(s => s.latitude) || []

  return (
    <div className="space-y-6 animate-in fade-in duration-500 overflow-x-hidden no-print">
      {showDraftBanner && (
        <Alert className="bg-accent/10 border-accent/50 text-accent-foreground animate-in slide-in-from-top duration-300 mb-4">
          <RotateCcw className="h-4 w-4" />
          <AlertTitle className="font-bold flex items-center gap-2 text-sm">
            📋 พบข้อมูลค้างจากครั้งที่แล้ว
          </AlertTitle>
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between mt-2 gap-3">
            <span className="text-xs">คุณต้องการนำข้อมูลที่บันทึกไว้อัตโนมัติกลับมาใช้งานต่อหรือไม่?</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs border-accent text-accent hover:bg-accent/10 flex-1 sm:flex-none" onClick={useDraftData}>ใช้ข้อมูลเดิม</Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs flex-1 sm:flex-none" onClick={() => { localStorage.removeItem(STORAGE_KEY); setShowDraftBanner(false); }}>เริ่มใหม่</Button>
            </div>
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
              {showSaveIndicator && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground animate-pulse">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                </div>
              )}
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
                      <SelectItem value="warehouse">คลังสินค้า LOTUS EME</SelectItem>
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
                <Card key={stop.id} className="relative border-l-4 border-l-primary hover:border-accent transition-colors overflow-hidden">
                  <CardContent className="p-3 md:p-4 flex gap-3 md:gap-4 bg-secondary/20">
                    <div className="flex flex-col items-center justify-center text-muted-foreground shrink-0">
                      <span className="text-xs font-bold bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center">
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1">
                          <Select value={stop.siteId} onValueChange={(val) => updateStop(stop.id, 'siteId', val)}>
                            <SelectTrigger className="h-11"><SelectValue placeholder="เลือกไซน์งาน" /></SelectTrigger>
                            <SelectContent>
                              {sites?.map(s => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Navigation className="mr-2 h-4 w-4" />} บันทึกแผน
            </Button>
            <Button variant="outline" className="flex-1 border-destructive text-destructive hover:bg-destructive/10 h-12" onClick={resetForm}>
              <Trash2 className="mr-2 h-4 w-4" /> ล้างข้อมูล
            </Button>
          </div>
        </div>

        <div className="w-full lg:w-1/2 relative rounded-xl overflow-hidden border border-border shadow-2xl bg-card min-h-[350px] md:min-h-[500px] lg:min-h-0">
          <div className="absolute top-2 left-2 md:top-4 md:left-4 z-10 space-y-2 w-[calc(100%-16px)] sm:w-auto">
            <div className="bg-background/90 backdrop-blur p-3 md:p-4 rounded-lg border shadow-xl sm:max-w-xs">
              <h4 className="text-xs md:text-sm font-bold text-accent mb-2 flex items-center gap-2">
                <RouteIcon className="h-4 w-4" /> สรุปเส้นทาง
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
                <Button size="sm" className="flex-1 h-9 text-[10px] md:text-[11px] bg-primary hover:bg-primary/90" onClick={() => calculateRoute(false)} disabled={isOptimizing}>คำนวณ</Button>
                <Button size="sm" variant="outline" className="flex-1 h-9 text-[10px] md:text-[11px] border-accent text-accent" onClick={() => calculateRoute(true)} disabled={isOptimizing}>สั้นที่สุด</Button>
              </div>
            </div>
          </div>

          <div className="hidden sm:block absolute top-4 right-4 z-10 bg-background/90 backdrop-blur p-2 md:p-3 rounded-lg border shadow-lg text-[9px] md:text-[10px] space-y-2">
            <h5 className="font-bold border-b pb-1 mb-1">คำอธิบาย</h5>
            <div className="flex items-center gap-2"><div className="w-2 h-2 md:w-3 md:h-3 rounded-full bg-[#f59e0b] border border-white" /> ไซน์งาน</div>
            <div className="flex items-center gap-2"><div className="w-2 h-2 md:w-3 md:h-3 rounded-full bg-[#10b981] border border-white" /> จุดเริ่มต้น</div>
            <div className="flex items-center gap-2"><div className="w-2 h-2 md:w-3 md:h-3 rounded-full bg-[#3b82f6] border border-white" /> จุดส่งของ</div>
          </div>

          <div className="absolute inset-0 z-0">
            <div ref={mapRef} className="w-full h-full bg-muted/20" />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Collapsible open={isMatrixOpen} onOpenChange={setIsMatrixOpen} className="w-full border rounded-xl overflow-hidden bg-card">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full flex items-center justify-between p-4 h-14 hover:bg-secondary/50">
              <div className="flex items-center gap-2 font-bold text-sm md:text-base">
                <TableIcon className="h-5 w-5 text-accent" />
                <span>ตารางวิเคราะห์ระยะทาง (Distance Matrix)</span>
                {isMatrixLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
              {isMatrixOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col">
              <div className="p-2 md:p-4 overflow-x-auto">
                {isMatrixLoading ? (
                  <div className="flex flex-col items-center justify-center p-8 md:p-12 gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-accent" />
                    <p className="text-xs md:text-sm text-muted-foreground text-center">กำลังประมวลผลระยะทางจาก Google Maps...</p>
                  </div>
                ) : (
                  <Table className="min-w-[600px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="bg-muted/50 text-[10px] md:text-xs">ต้นทาง \ ปลายทาง</TableHead>
                        <TableHead className={cn(
                          "text-center font-bold text-accent text-[10px] md:text-xs",
                          bestColumnId === "warehouse" && "border-b-2 border-blue-500"
                        )}>คลังสินค้า</TableHead>
                        {activeSites.map(s => (
                          <TableHead 
                            key={s.id} 
                            className={cn(
                              "text-center min-w-[100px] text-[10px] md:text-xs",
                              bestColumnId === s.id && "border-b-2 border-blue-500"
                            )}
                          >
                            {s.name}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-[10px] md:text-xs">
                      <TableRow>
                        <TableCell className="font-bold text-accent">คลังสินค้า LOTUS</TableCell>
                        <TableCell className="text-center text-muted-foreground">-</TableCell>
                        {activeSites.map(dest => (
                          <TableCell 
                            key={dest.id} 
                            className={cn("text-center transition-colors duration-200", getCellColor("warehouse", dest.id, distanceMatrix["warehouse"]?.[dest.id]))}
                          >
                            {distanceMatrix["warehouse"]?.[dest.id]?.toFixed(1) || '--'} กม.
                          </TableCell>
                        ))}
                      </TableRow>
                      {activeSites.map(origin => (
                        <TableRow key={origin.id}>
                          <TableCell className="font-medium">{origin.name}</TableCell>
                          <TableCell 
                            className={cn("text-center transition-colors duration-200", getCellColor(origin.id, "warehouse", distanceMatrix[origin.id]?.["warehouse"]))}
                          >
                            {distanceMatrix[origin.id]?.["warehouse"]?.toFixed(1) || '--'} กม.
                          </TableCell>
                          {activeSites.map(dest => (
                            <TableCell 
                              key={dest.id} 
                              className={cn(
                                "text-center transition-colors duration-200",
                                origin.id === dest.id ? "text-muted-foreground" : getCellColor(origin.id, dest.id, distanceMatrix[origin.id]?.[dest.id])
                              )}
                            >
                              {origin.id === dest.id ? '-' : (distanceMatrix[origin.id]?.[dest.id]?.toFixed(1) || '--') + ' กม.'}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
              
              {!isMatrixLoading && Object.keys(distanceMatrix).length > 0 && (
                <div className="flex flex-wrap items-center gap-4 px-4 pb-4 text-[10px] md:text-xs border-t pt-4">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-green-900 ring-1 ring-green-500" />
                    <span className="text-muted-foreground">🟢 สีเขียว = ระยะทางใกล้ที่สุดในแต่ละแถว</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-red-900" />
                    <span className="text-muted-foreground">🔴 สีแดง = ระยะทางไกลที่สุดในแต่ละแถว</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-0.5 bg-blue-500" />
                    <span className="text-muted-foreground">🔵 ขอบฟ้า = จุดหมายปลายทางที่เฉลี่ยใกล้ที่สุด (แนะนำ)</span>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}
