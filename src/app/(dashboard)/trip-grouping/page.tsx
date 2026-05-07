"use client"

import * as React from "react"
import { useUser, useFirestore, useCollection, useMemoFirebase } from "@/firebase"
import { collection, query, where, orderBy, doc, serverTimestamp, setDoc, updateDoc, arrayUnion } from "firebase/firestore"
import { Vehicle, Driver, Site } from "@/types/models"
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

  const { data: vehicles, isLoading: loadingVehicles } = useCollection<Vehicle>(vRef)
  const { data: drivers, isLoading: loadingDrivers } = useCollection<Driver>(dRef)
  const { data: requests, isLoading: loadingRequests } = useCollection<any>(vrRef)

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

  const selectedDestinations = availableDestinations.filter(d => selectedIds.has(d.id))

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedIds(newSet)
  }

  const handleCreateTrip = async () => {
    if (selectedDestinations.length === 0) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาเลือกอย่างน้อย 1 จุดหมาย", variant: "destructive" })
      return
    }
    if (!vehicleId || !driverId) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาเลือกคนขับและรถที่จะใช้", variant: "destructive" })
      return
    }

    setIsConfirmOpen(true)
  }

  const confirmCreateTrip = async () => {
    setIsProcessing(true)
    try {
      const selectedVehicle = vehicles?.find(v => v.id === vehicleId)
      const selectedDriver = drivers?.find(d => d.id === driverId)
      const tripId = `T-${Math.floor(1000 + Math.random() * 9000)}`
      
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
    <div className="flex flex-col h-[calc(100vh-10rem)] animate-in fade-in duration-500 gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight text-white">จัดกลุ่มเที่ยววิ่ง</h2>
        <p className="text-lg text-muted-foreground font-medium">รวมจุดส่งจากใบขอใช้รถที่ค้างอยู่เป็นเที่ยววิ่งเดียว</p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden min-h-0">
        {/* Left: Destination List */}
        <div className="lg:col-span-5 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
          <div className="bg-secondary/30 p-4 rounded-xl border border-border/50 sticky top-0 z-10 backdrop-blur">
            <h3 className="text-xl font-bold flex items-center gap-2">
              <Inbox className="h-5 w-5 text-accent" /> งานที่ยังไม่ได้จัดรถ ({availableDestinations.length})
            </h3>
          </div>

          {availableDestinations.length > 0 ? (
            <div className="space-y-4 pb-20">
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
            <div className="text-center py-20 bg-secondary/10 rounded-2xl border border-dashed flex flex-col items-center gap-4">
              <AlertTriangle className="h-12 w-12 text-muted-foreground" />
              <p className="text-xl font-medium text-muted-foreground">ไม่มีงานค้างในระบบ</p>
            </div>
          )}
        </div>

        {/* Right: Map View */}
        <div className="lg:col-span-7 rounded-2xl overflow-hidden border border-border shadow-2xl bg-card h-full min-h-[400px]">
          <GroupingMap 
            destinations={availableDestinations} 
            selectedIds={selectedIds}
            onSelect={handleToggleSelect}
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
        <AlertDialogContent className="max-w-xl rounded-2xl border-accent/20 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl font-bold text-accent">ยืนยันสร้างเที่ยววิ่ง</AlertDialogTitle>
            <AlertDialogDescription className="text-lg py-4 text-foreground/90 space-y-4">
              <div className="p-4 bg-secondary/50 rounded-xl space-y-2 border border-border">
                <p>• จำนวนจุดหมาย: <span className="font-bold text-white text-xl">{selectedDestinations.length} จุด</span></p>
                <p>• ทะเบียนรถ: <span className="font-bold text-white text-xl">{vehicles?.find(v => v.id === vehicleId)?.licensePlate}</span></p>
                <p>• คนขับ: <span className="font-bold text-white text-xl">{drivers?.find(d => d.id === driverId)?.name}</span></p>
              </div>
              <p className="font-medium">ระบบจะสร้าง Trip และอัปเดตสถานะใบคำขอที่เกี่ยวข้องให้ทันที</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-4">
            <AlertDialogCancel className="h-14 text-lg font-bold flex-1">ยกเลิก</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmCreateTrip}
              className="h-14 text-lg font-bold flex-1 bg-accent hover:bg-accent/90"
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
