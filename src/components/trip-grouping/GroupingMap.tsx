
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

export function GroupingMap({ destinations, selectedIds, onSelect }: GroupingMapProps) {
  const db = useFirestore()
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<google.maps.Map | null>(null)
  const markersRef = React.useRef<google.maps.Marker[]>([])
  
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

  const drawHoverDistances = React.useCallback((sourceMarker: google.maps.Marker) => {
    const google = window.google
    const map = mapRef.current
    if (!map || !google) return

    const sourcePos = sourceMarker.getPosition()
    if (!sourcePos) return

    const otherMarkers = markersRef.current.filter(m => m !== sourceMarker)
    if (otherMarkers.length === 0) return

    const service = new google.maps.DistanceMatrixService()
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

    // Fetch new ones if needed (max 25 per request)
    if (targetsToFetch.length > 0) {
      service.getDistanceMatrix({
        origins: [sourcePos],
        destinations: targetsToFetch.slice(0, 25),
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.METRIC,
      }, (response, status) => {
        if (status === 'OK' && response) {
          response.rows[0].elements.forEach((element, idx) => {
            if (element.status === 'OK') {
              const distKm = element.distance.value / 1000
              const targetPos = targetsToFetch[idx]
              const key = `${sourcePos.lat().toFixed(5)},${sourcePos.lng().toFixed(5)}->${targetPos.lat().toFixed(5)},${targetPos.lng().toFixed(5)}`
              const revKey = `${targetPos.lat().toFixed(5)},${targetPos.lng().toFixed(5)}->${sourcePos.lat().toFixed(5)},${sourcePos.lng().toFixed(5)}`
              
              distanceCache.current.set(key, distKm)
              distanceCache.current.set(revKey, distKm)
              
              drawLine(sourcePos, targetPos, distKm)
            }
          })
        }
      })
    }
  }, [])

  const updateMarkers = React.useCallback(() => {
    const map = mapRef.current
    if (!map || !window.google) return

    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []
    
    const google = window.google
    const newMarkers: google.maps.Marker[] = []
    const bounds = new google.maps.LatLngBounds()
    let hasValidPoints = false

    destinations.forEach((d, idx) => {
      if (d.lat && d.lng) {
        const isSelected = selectedIds.has(d.id)
        hasValidPoints = true
        const pos = { lat: d.lat, lng: d.lng }
        bounds.extend(pos)

        const marker = new google.maps.Marker({
          position: pos,
          map,
          title: d.siteName,
          label: {
            text: (idx + 1).toString(),
            color: "#ffffff",
            fontWeight: "bold",
            fontSize: "10px"
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

        marker.addListener("click", () => onSelect(d.id))
        marker.addListener("mouseover", () => drawHoverDistances(marker))
        marker.addListener("mouseout", () => clearHoverVisuals())
        
        newMarkers.push(marker)
      }
    })

    if (hasValidPoints) {
      map.fitBounds(bounds)
      if (destinations.length === 1) map.setZoom(15)
    }

    markersRef.current = newMarkers
  }, [destinations, selectedIds, onSelect, drawHoverDistances, clearHoverVisuals])

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
