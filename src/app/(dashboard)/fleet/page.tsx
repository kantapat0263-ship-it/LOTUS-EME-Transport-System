
"use client"

import * as React from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, Truck, User, Phone, Weight, MoreHorizontal, Edit, Trash2, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, doc, serverTimestamp } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useToast } from "@/hooks/use-toast"
import { Vehicle, Driver, UserProfile } from "@/types/models"

const vehicleSchema = z.object({
  licensePlate: z.string().min(2, "กรุณาระบุทะเบียนรถ"),
  type: z.enum(['Pickup', '4-wheel truck', '6-wheel truck']),
  maxLoadCapacityKg: z.coerce.number().min(1, "กรุณาระบุน้ำหนักบรรทุก"),
})

const driverSchema = z.object({
  name: z.string().min(2, "กรุณาระบุชื่อคนขับ"),
  phoneNumber: z.string().min(9, "กรุณาระบุเบอร์โทรศัพท์"),
})

export default function FleetPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile } = useDoc<UserProfile>(userProfileRef)
  
  const isViewer = profile?.role === 'viewer'

  // Vehicles State
  const [isVehicleDialogOpen, setIsVehicleDialogOpen] = React.useState(false)
  const [editingVehicle, setEditingVehicle] = React.useState<Vehicle | null>(null)
  const vehiclesRef = useMemoFirebase(() => collection(db, "vehicles"), [db])
  const { data: vehicles, isLoading: isLoadingVehicles } = useCollection<Vehicle>(vehiclesRef)
  
  const vehicleForm = useForm<z.infer<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { licensePlate: "", type: "Pickup", maxLoadCapacityKg: 1500 }
  })

  // Drivers State
  const [isDriverDialogOpen, setIsDriverDialogOpen] = React.useState(false)
  const [editingDriver, setEditingDriver] = React.useState<Driver | null>(null)
  const driversRef = useMemoFirebase(() => collection(db, "drivers"), [db])
  const { data: drivers, isLoading: isLoadingDrivers } = useCollection<Driver>(driversRef)

  const driverForm = useForm<z.infer<typeof driverSchema>>({
    resolver: zodResolver(driverSchema),
    defaultValues: { name: "", phoneNumber: "" }
  })

  // CRUD Handlers
  function onVehicleSubmit(values: z.infer<typeof vehicleSchema>) {
    if (isViewer) return
    if (editingVehicle) {
      updateDocumentNonBlocking(doc(db, "vehicles", editingVehicle.id), { ...values, updatedAt: serverTimestamp() })
      toast({ title: "สำเร็จ", description: "แก้ไขข้อมูลรถเรียบร้อยแล้ว" })
    } else {
      const newRef = doc(collection(db, "vehicles"))
      setDocumentNonBlocking(newRef, { 
        ...values, 
        id: newRef.id,
        createdAt: serverTimestamp(), 
        updatedAt: serverTimestamp() 
      }, { merge: true })
      toast({ title: "สำเร็จ", description: "เพิ่มรถใหม่เรียบร้อยแล้ว" })
    }
    setIsVehicleDialogOpen(false)
    setEditingVehicle(null)
    vehicleForm.reset()
  }

  function onDriverSubmit(values: z.infer<typeof driverSchema>) {
    if (isViewer) return
    if (editingDriver) {
      updateDocumentNonBlocking(doc(db, "drivers", editingDriver.id), { ...values, updatedAt: serverTimestamp() })
      toast({ title: "สำเร็จ", description: "แก้ไขข้อมูลคนขับเรียบร้อยแล้ว" })
    } else {
      const newRef = doc(collection(db, "drivers"))
      setDocumentNonBlocking(newRef, { 
        ...values, 
        id: newRef.id,
        createdAt: serverTimestamp(), 
        updatedAt: serverTimestamp() 
      }, { merge: true })
      toast({ title: "สำเร็จ", description: "เพิ่มคนขับใหม่เรียบร้อยแล้ว" })
    }
    setIsDriverDialogOpen(false)
    setEditingDriver(null)
    driverForm.reset()
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">ฟลีทรถและคนขับ</h2>
          <p className="text-muted-foreground">จัดการยานพาหนะและการมอบหมายงานให้คนขับ</p>
        </div>
      </div>

      <Tabs defaultValue="vehicles" className="space-y-4">
        <TabsList className="bg-secondary/50 p-1">
          <TabsTrigger value="vehicles" className="data-[state=active]:bg-accent">ยานพาหนะ (Vehicles)</TabsTrigger>
          <TabsTrigger value="drivers" className="data-[state=active]:bg-accent">คนขับ (Drivers)</TabsTrigger>
        </TabsList>

        <TabsContent value="vehicles" className="space-y-4">
          {!isViewer && (
            <div className="flex justify-end">
              <Button className="bg-primary hover:bg-primary/90" onClick={() => { setEditingVehicle(null); vehicleForm.reset(); setIsVehicleDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> เพิ่มรถยนต์ใหม่
              </Button>
            </div>
          )}
          {isLoadingVehicles ? <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {vehicles?.map((v) => (
                <Card key={v.id} className="relative overflow-hidden group hover:border-accent/50 transition-all">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <Badge variant="outline" className="mb-2 uppercase tracking-wider text-[10px]">{v.type}</Badge>
                      {!isViewer && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setEditingVehicle(v); vehicleForm.reset({ licensePlate: v.licensePlate, type: v.type, maxLoadCapacityKg: v.maxLoadCapacityKg }); setIsVehicleDialogOpen(true); }}><Edit className="mr-2 h-4 w-4" /> แก้ไข</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => { if(confirm("ลบรถคันนี้?")) deleteDocumentNonBlocking(doc(db, "vehicles", v.id)) }}><Trash2 className="mr-2 h-4 w-4" /> ลบ</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <CardTitle className="text-2xl font-bold text-accent">{v.licensePlate}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-0">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Weight className="h-4 w-4" />
                      <span>น้ำหนักบรรทุกสูงสุด: <strong>{v.maxLoadCapacityKg.toLocaleString()} kg</strong></span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="drivers" className="space-y-4">
          {!isViewer && (
            <div className="flex justify-end">
              <Button className="bg-primary hover:bg-primary/90" onClick={() => { setEditingDriver(null); driverForm.reset(); setIsDriverDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> เพิ่มคนขับใหม่
              </Button>
            </div>
          )}
          {isLoadingDrivers ? <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {drivers?.map((d) => (
                <Card key={d.id} className="relative overflow-hidden group hover:border-accent/50 transition-all">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-xl font-bold text-accent">
                        {d.name.charAt(0)}
                      </div>
                      {!isViewer && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setEditingDriver(d); driverForm.reset({ name: d.name, phoneNumber: d.phoneNumber }); setIsDriverDialogOpen(true); }}><Edit className="mr-2 h-4 w-4" /> แก้ไข</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => { if(confirm("ลบคนขับคนนี้?")) deleteDocumentNonBlocking(doc(db, "drivers", d.id)) }}><Trash2 className="mr-2 h-4 w-4" /> ลบ</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <CardTitle className="text-xl font-bold mt-2">{d.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Phone className="h-4 w-4 text-accent" />
                      <span>เบอร์โทรศัพท์: <strong>{d.phoneNumber}</strong></span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Vehicle Dialog */}
      <Dialog open={isVehicleDialogOpen} onOpenChange={setIsVehicleDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingVehicle ? "แก้ไขข้อมูลรถ" : "เพิ่มรถใหม่"}</DialogTitle></DialogHeader>
          <Form {...vehicleForm}>
            <form onSubmit={vehicleForm.handleSubmit(onVehicleSubmit)} className="space-y-4">
              <FormField control={vehicleForm.control} name="licensePlate" render={({ field }) => (
                <FormItem><FormLabel>ทะเบียนรถ</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={vehicleForm.control} name="type" render={({ field }) => (
                <FormItem><FormLabel>ประเภทรถ</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="Pickup">Pickup</SelectItem><SelectItem value="4-wheel truck">4-wheel truck</SelectItem><SelectItem value="6-wheel truck">6-wheel truck</SelectItem></SelectContent></Select><FormMessage /></FormItem>
              )} />
              <FormField control={vehicleForm.control} name="maxLoadCapacityKg" render={({ field }) => (
                <FormItem><FormLabel>น้ำหนักบรรทุกสูงสุด (kg)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <Button type="submit" className="w-full bg-accent">บันทึก</Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Driver Dialog */}
      <Dialog open={isDriverDialogOpen} onOpenChange={setIsDriverDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingDriver ? "แก้ไขข้อมูลคนขับ" : "เพิ่มคนขับใหม่"}</DialogTitle></DialogHeader>
          <Form {...driverForm}>
            <form onSubmit={driverForm.handleSubmit(onDriverSubmit)} className="space-y-4">
              <FormField control={driverForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>ชื่อคนขับ</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={driverForm.control} name="phoneNumber" render={({ field }) => (
                <FormItem><FormLabel>เบอร์โทรศัพท์</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <Button type="submit" className="w-full bg-accent">บันทึก</Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
