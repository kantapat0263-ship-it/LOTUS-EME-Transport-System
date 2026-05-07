
"use client"

import * as React from "react"
import { Loader } from "@googlemaps/js-api-loader"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { doc } from "firebase/firestore"
import { CompanySetting } from "@/types/models"

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
  
  // Refs for hover visuals
  const hoverPolylinesRef = React.useRef<google.maps.Polyline[]>([])
  const hoverLabelsRef = React.useRef<google.maps.Marker[]>([])
  const distanceCache = React.useRef<Map<string, number>>(new Map())

  const settingRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: settings } = useDoc<CompanySetting>(settingRef)

  const clearHoverVisuals = React.useCallback(() => {
    hoverPolylinesRef.current.forEach(p => p.setMap(null))
    hoverLabelsRef.current.forEach(l => l.setMap(null))
    hoverPolylinesRef.current = []
    hoverLabelsRef.current = []
  }, [])

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
        strokeOpacity: 0, // invisible line, icons provide visibility
        strokeWeight: 2,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, scale: 3 },
          offset: '0',
          repeat: '20px'
        }],
        map
      })
      hoverPolylinesRef.current.push(polyline)

      // Calculate midpoint for label
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

    // Draw from cache immediately
    targetsWithCache.forEach(t => drawLine(sourcePos, t.pos, t.dist))

    // Fetch new ones if needed
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

    // Origin position
    const officePos = { 
      lat: settings?.warehouseLatitude || HEAD_OFFICE_DEFAULT.lat, 
      lng: settings?.warehouseLongitude || HEAD_OFFICE_DEFAULT.lng 
    }
    const officeLatLng = new google.maps.LatLng(officePos.lat, officePos.lng)

    // 1. Add LOTUS EME Marker (Origin)
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

    // 2. Add Destination Markers
    destinations.forEach((d) => {
      if (d.lat && d.lng) {
        const isSelected = selectedIds.has(d.id)
        const pos = { lat: d.lat, lng: d.lng }
        const destLatLng = new google.maps.LatLng(d.lat, d.lng)
        bounds.extend(pos)

        // Truncate name for label
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
          
          // Get distance from office for the InfoWindow
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

    if (hasValidPoints) {
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

  return <div ref={mapContainerRef} className="w-full h-full" />
}
