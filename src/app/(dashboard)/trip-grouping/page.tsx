
"use client"

import * as React from "react"
import { useUser, useFirestore, useCollection, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, orderBy, doc, serverTimestamp, setDoc, updateDoc, arrayUnion } from "firebase/firestore"
import { Vehicle, Driver, Site, CompanySetting } from "@/types/models"
import { GroupingMap } from "@/components/trip-grouping/GroupingMap"
import { DestinationCard } from "@/components/trip-grouping/DestinationCard"
import { TripControlPanel } from "@/components/trip-grouping/TripControlPanel"
import { Loader2, Inbox, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export default function TripGroupingPage() {
  const { user } = useUser()
  const db = useFirestore()
  const { toast } = useToast()

  // Data Fetching
  const vRef = useMemoFirebase(() => collection(db, "vehicles"), [db])
  const dRef = useMemoFirebase(() => collection(db, "drivers"), [db])
  const vrRef = useMemoFirebase(() => query(collection(db, "vehicleRequests"), where("status", "in", ["pending", "partial"])), [db])
  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])

  const { data: vehicles, isLoading: loadingVehicles } = useCollection<Vehicle>(vRef)
  const { data: drivers, isLoading: loadingDrivers } = useCollection<Driver>(dRef)
  const { data: requests, isLoading: loadingRequests } = useCollection<any>(vrRef)
  const { data: settings } = useDoc<CompanySetting>(settingsRef)

  // States
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [vehicleId, setVehicleId] = React.useState("")
  const [driverId, setDriverId] = React.useState("")
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false)
  const [isProcessing, setIsProcessing] = React.useState(false)

  // Flatten destinations from VRs
  const availableDestinations = React.useMemo(() => {
    if (!requests) return []
    const list: any[] = []
    requests.forEach(req => {
      const assigned = req.assignedDestinations || []
      req.destinations.forEach((dest: any, idx: number) => {
        if (!assigned.includes(idx)) {
          list.push({
            ...dest,
            id: `${req.id}-${idx}`,
            vrId: req.requestId,
            vrDocId: req.id,
            destIndex: idx,
            requestedBy: req.requestedBy,
            requestDate: req.requestDate
          })
        }
      })
    })
    return list
  }, [requests])

  const selectedDestinations = React.useMemo(() => 
    availableDestinations.filter(d => selectedIds.has(d.id)),
    [availableDestinations, selectedIds]
  )

  const selectedVehicle = React.useMemo(() => 
    vehicles?.find(v => v.id === vehicleId), 
    [vehicles, vehicleId]
  )

  // Stable callbacks for children
  const handleToggleSelect = React.useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) newSet.delete(id)
      else newSet.add(id)
      return newSet
    })
  }, [])

  const handleCreateTrip = React.useCallback(() => {
    if (selectedIds.size === 0) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาเลือกอย่างน้อย 1 จุดหมาย", variant: "destructive" })
      return
    }
    if (!vehicleId || !driverId) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาเลือกคนขับและรถที่จะใช้", variant: "destructive" })
      return
    }

    setIsConfirmOpen(true)
  }, [selectedIds.size, vehicleId, driverId, toast])

  const confirmCreateTrip = async () => {
    setIsProcessing(true)
    try {
      const selectedDriver = drivers?.find(d => d.id === driverId)
      const tripId = `T-${Math.floor(1000 + Math.random() * 9000)}`
      
      const lastStats = (window as any).__lastTripStats || { distance: 0, fuelCost: 0 }

      // 1. Create Trip
      const tripRef = doc(db, "trips", tripId)
      const sourceVRIds = Array.from(new Set(selectedDestinations.map(d => d.vrId)))
      
      await setDoc(tripRef, {
        id: tripId,
        tripId,
        tripDate: new Date().toISOString().split('T')[0],
        vehicleId,
        vehiclePlate: selectedVehicle?.licensePlate || "",
        driverId,
        driverName: selectedDriver?.name || "",
        status: "Planned",
        sourceVRIds,
        totalDistanceKm: lastStats.distance || 0,
        fuelCost: lastStats.fuelCost || 0,
        createdAt: serverTimestamp(),
        stops: selectedDestinations.map((d, idx) => ({
          siteId: d.siteId || d.id,
          siteName: d.siteName,
          cargoDetails: d.jobDescription,
          order: idx
        }))
      })

      // 2. Update VRs
      const vrGroups: Record<string, number[]> = {}
      selectedDestinations.forEach(d => {
        if (!vrGroups[d.vrDocId]) vrGroups[d.vrDocId] = []
        vrGroups[d.vrDocId].push(d.destIndex)
      })

      for (const [docId, indexes] of Object.entries(vrGroups)) {
        const vr = requests?.find(r => r.id === docId)
        if (vr) {
          const newAssigned = [...(vr.assignedDestinations || []), ...indexes]
          const isComplete = newAssigned.length === vr.destinations.length
          
          await updateDoc(doc(db, "vehicleRequests", docId), {
            assignedDestinations: arrayUnion(...indexes),
            status: isComplete ? "approved" : "partial",
            tripId: isComplete ? tripId : vr.tripId || null,
            updatedAt: serverTimestamp()
          })
        }
      }

      toast({ title: "สำเร็จ", description: `สร้างเที่ยววิ่ง ${tripId} เรียบร้อยแล้ว` })
      
      // Reset
      setSelectedIds(new Set())
      setVehicleId("")
      setDriverId("")
      setIsConfirmOpen(false)
    } catch (e) {
      console.error(e)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถสร้างเที่ยววิ่งได้", variant: "destructive" })
    } finally {
      setIsProcessing(false)
    }
  }

  if (loadingRequests) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-in fade-in duration-500 gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight text-white">จัดกลุ่มเที่ยววิ่ง</h2>
        <p className="text-sm text-muted-foreground">รวมจุดส่งจากใบขอใช้รถที่ค้างอยู่เป็นเที่ยววิ่งเดียว</p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden min-h-0">
        {/* Left: Destination List */}
        <div className="lg:col-span-5 flex flex-col gap-3 overflow-y-auto pr-2 custom-scrollbar">
          <div className="bg-secondary/30 p-3 rounded-xl border border-border/50 sticky top-0 z-10 backdrop-blur">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Inbox className="h-4 w-4 text-accent" /> งานที่ยังไม่ได้จัดรถ ({availableDestinations.length})
            </h3>
          </div>

          {availableDestinations.length > 0 ? (
            <div className="space-y-3 pb-24">
              {availableDestinations.map(dest => (
                <DestinationCard 
                  key={dest.id} 
                  dest={dest} 
                  isSelected={selectedIds.has(dest.id)}
                  onToggle={() => handleToggleSelect(dest.id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-secondary/10 rounded-2xl border border-dashed flex flex-col items-center gap-3">
              <AlertTriangle className="h-10 w-10 text-muted-foreground opacity-50" />
              <p className="text-sm font-medium text-muted-foreground">ไม่มีงานค้างในระบบ</p>
            </div>
          )}
        </div>

        {/* Right: Map View */}
        <div className="lg:col-span-7 rounded-xl overflow-hidden border border-border bg-card h-full min-h-[300px]">
          <GroupingMap 
            destinations={availableDestinations} 
            selectedIds={selectedIds}
            onSelect={handleToggleSelect}
            selectedVehicleRate={selectedVehicle?.fuelRate}
          />
        </div>
      </div>

      {/* Sticky Bottom Control Panel */}
      <TripControlPanel 
        selectedCount={selectedIds.size}
        vehicles={vehicles || []}
        drivers={drivers || []}
        vehicleId={vehicleId}
        driverId={driverId}
        setVehicleId={setVehicleId}
        setDriverId={setDriverId}
        onCreate={handleCreateTrip}
        isProcessing={isProcessing}
      />

      {/* Confirmation Dialog */}
      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent className="max-w-md rounded-xl border-accent/20 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold text-accent">ยืนยันสร้างเที่ยววิ่ง</AlertDialogTitle>
            <AlertDialogDescription className="text-sm py-2 text-foreground/90 space-y-3">
              <div className="p-3 bg-secondary/50 rounded-lg space-y-1 border border-border">
                <p>• จำนวนจุดหมาย: <span className="font-bold text-white">{selectedDestinations.length} จุด</span></p>
                <p>• ทะเบียนรถ: <span className="font-bold text-white">{selectedVehicle?.licensePlate}</span></p>
                <p>• คนขับ: <span className="font-bold text-white">{drivers?.find(d => d.id === driverId)?.name}</span></p>
              </div>
              <p className="text-xs text-muted-foreground">ระบบจะสร้าง Trip และอัปเดตสถานะใบคำขอที่เกี่ยวข้องให้ทันที</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-10 text-sm flex-1">ยกเลิก</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmCreateTrip}
              className="h-10 text-sm flex-1 bg-accent hover:bg-accent/90"
              disabled={isProcessing}
            >
              {isProcessing ? "กำลังประมวลผล..." : "ยืนยันสร้างงาน"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
