"use client"

import * as React from "react"
import { Loader } from "@googlemaps/js-api-loader"
import { useDoc, useFirestore } from "@/firebase"
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
  const mapRef = React.useRef<HTMLDivElement>(null)
  const [map, setMap] = React.useState<google.maps.Map | null>(null)
  const [markers, setMarkers] = React.useState<google.maps.Marker[]>([])
  
  const settingRef = doc(db, "companySettings", "default")
  const { data: settings } = useDoc<CompanySetting>(settingRef)

  React.useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || settings?.googleMapsApiKeyReference
    if (!mapRef.current || !apiKey) return

    const loader = new Loader({
      apiKey: apiKey,
      version: "weekly",
      libraries: ["places", "geometry"]
    })

    loader.load().then(() => {
      const newMap = new google.maps.Map(mapRef.current!, {
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
      setMap(newMap)
    })
  }, [settings])

  React.useEffect(() => {
    if (!map || !window.google) return

    // Clear old markers
    markers.forEach(m => m.setMap(null))
    
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
            fontSize: "14px"
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: isSelected ? 18 : 14,
            fillColor: isSelected ? "#3b82f6" : (d.type === 'site' ? "#f59e0b" : "#9333ea"),
            fillOpacity: 1,
            strokeWeight: isSelected ? 4 : 2,
            strokeColor: isSelected ? "#ffffff" : "#ffffff"
          }
        })

        marker.addListener("click", () => onSelect(d.id))
        newMarkers.push(marker)
      }
    })

    if (hasValidPoints) {
      map.fitBounds(bounds)
      if (destinations.length === 1) map.setZoom(15)
    }

    setMarkers(newMarkers)
  }, [map, destinations, selectedIds])

  return <div ref={mapRef} className="w-full h-full" />
}
