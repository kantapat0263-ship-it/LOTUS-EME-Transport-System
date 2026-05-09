
"use client"

import * as React from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, Truck, User, Phone, Weight, MoreHorizontal, Edit, Trash2, Loader2, Fuel } from "lucide-react"
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
import { collection, doc, serverTimestamp, setDoc, updateDoc, deleteDoc } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useToast } from "@/hooks/use-toast"
import { Vehicle, Driver, UserProfile } from "@/types/models"

const vehicleSchema = z.object({
  licensePlate: z.string().min(2, "กรุณาระบุทะเบียนรถ"),
  type: z.enum(['Pickup', '4-wheel truck', '6-wheel truck']),
  maxLoadCapacityKg: z.coerce.number().min(1, "กรุณาระบุน้ำหนักบรรทุก"),
  fuelRate: z.coerce.number().optional(),
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

  const [isVehicleDialogOpen, setIsVehicleDialogOpen] = React.useState(false)
  const [isSavingVehicle, setIsSavingVehicle] = React.useState(false)
  const [editingVehicle, setEditingVehicle] = React.useState<Vehicle | null>(null)
  const vehiclesRef = useMemoFirebase(() => collection(db, "vehicles"), [db])
  const { data: vehicles, isLoading: isLoadingVehicles } = useCollection<Vehicle>(vehiclesRef)
  
  const vehicleForm = useForm<z.infer<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { licensePlate: "", type: "Pickup", maxLoadCapacityKg: 1500, fuelRate: undefined }
  })

  const [isDriverDialogOpen, setIsDriverDialogOpen] = React.useState(false)
  const [isSavingDriver, setIsSavingDriver] = React.useState(false)
  const [editingDriver, setEditingDriver] = React.useState<Driver | null>(null)
  const driversRef = useMemoFirebase(() => collection(db, "drivers"), [db])
  const { data: drivers, isLoading: isLoadingDrivers } = useCollection<Driver>(driversRef)

  const driverForm = useForm<z.infer<typeof driverSchema>>({
    resolver: zodResolver(driverSchema),
    defaultValues: { name: "", phoneNumber: "" }
  })

  async function onVehicleSubmit(values: z.infer<typeof vehicleSchema>) {
    if (isViewer) return
    setIsSavingVehicle(true)
    try {
      if (editingVehicle) {
        const vRef = doc(db, "vehicles", editingVehicle.id)
        await updateDoc(vRef, { ...values, updatedAt: serverTimestamp() })
        toast({ title: "สำเร็จ", description: "แก้ไขข้อมูลรถเรียบร้อยแล้ว" })
      } else {
        const newRef = doc(collection(db, "vehicles"))
        await setDoc(newRef, { 
          ...values, 
          id: newRef.id,
          createdAt: serverTimestamp(), 
          updatedAt: serverTimestamp() 
        })
        toast({ title: "สำเร็จ", description: "เพิ่มรถใหม่เรียบร้อยแล้ว" })
      }
      setIsVehicleDialogOpen(false)
      setEditingVehicle(null)
      vehicleForm.reset()
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถบันทึกข้อมูลได้", variant: "destructive" })
    } finally {
      setIsSavingVehicle(false)
    }
  }

  async function onDriverSubmit(values: z.infer<typeof driverSchema>) {
    if (isViewer) return
    setIsSavingDriver(true)
    try {
      if (editingDriver) {
        const dRef = doc(db, "drivers", editingDriver.id)
        await updateDoc(dRef, { ...values, updatedAt: serverTimestamp() })
        toast({ title: "สำเร็จ", description: "แก้ไขข้อมูลคนขับเรียบร้อยแล้ว" })
      } else {
        const newRef = doc(collection(db, "drivers"))
        await setDoc(newRef, { 
          ...values, 
          id: newRef.id,
          createdAt: serverTimestamp(), 
          updatedAt: serverTimestamp() 
        })
        toast({ title: "สำเร็จ", description: "เพิ่มคนขับใหม่เรียบร้อยแล้ว" })
      }
      setIsDriverDialogOpen(false)
      setEditingDriver(null)
      driverForm.reset()
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถบันทึกข้อมูลได้", variant: "destructive" })
    } finally {
      setIsSavingDriver(false)
    }
  }

  const handleDeleteVehicle = async (id: string) => {
    if (isViewer) return
    if (!confirm("ลบรถคันนี้?")) return
    try {
      await deleteDoc(doc(db, "vehicles", id))
      toast({ title: "สำเร็จ", description: "ลบข้อมูลรถเรียบร้อยแล้ว" })
    } catch (e) {
      toast({ title: "ผิดพลาด", description: "ไม่สามารถลบข้อมูลได้", variant: "destructive" })
    }
  }

  const handleDeleteDriver = async (id: string) => {
    if (isViewer) return
    if (!confirm("ลบคนขับคนนี้?")) return
    try {
      await deleteDoc(doc(db, "drivers", id))
      toast({ title: "สำเร็จ", description: "ลบข้อมูลคนขับเรียบร้อยแล้ว" })
    } catch (e) {
      toast({ title: "ผิดพลาด", description: "ไม่สามารถลบข้อมูลได้", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">ฟลีทรถและคนขับ</h2>
        <p className="text-sm md:text-base text-muted-foreground">จัดการยานพาหนะและการมอบหมายงานให้คนขับ</p>
      </div>

      <Tabs defaultValue="vehicles" className="space-y-4">
        <TabsList className="bg-secondary/50 p-1 w-full sm:w-auto overflow-x-auto justify-start">
          <TabsTrigger value="vehicles" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">ยานพาหนะ</TabsTrigger>
          <TabsTrigger value="drivers" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">คนขับรถ</TabsTrigger>
        </TabsList>

        <TabsContent value="vehicles" className="space-y-4">
          {!isViewer && (
            <div className="flex justify-end">
              <Button 
                className="bg-primary hover:bg-primary/90 w-full sm:w-auto h-11 md:h-10" 
                onClick={() => { 
                  setEditingVehicle(null); 
                  vehicleForm.reset({ licensePlate: "", type: "Pickup", maxLoadCapacityKg: 1500, fuelRate: undefined }); 
                  setIsVehicleDialogOpen(true); 
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> เพิ่มรถยนต์ใหม่
              </Button>
            </div>
          )}
          {isLoadingVehicles ? <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div> : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
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
                            <DropdownMenuItem onSelect={() => { 
                              setEditingVehicle(v); 
                              vehicleForm.reset({ 
                                licensePlate: v.licensePlate, 
                                type: v.type, 
                                maxLoadCapacityKg: v.maxLoadCapacityKg, 
                                fuelRate: v.fuelRate 
                              }); 
                              setIsVehicleDialogOpen(true); 
                            }}>
                              <Edit className="mr-2 h-4 w-4" /> แก้ไข
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onSelect={() => handleDeleteVehicle(v.id)}>
                              <Trash2 className="mr-2 h-4 w-4" /> ลบ
                            </DropdownMenuItem>
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
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Fuel className="h-4 w-4 text-accent" />
                      <span>อัตราสิ้นเปลือง: <strong>{v.fuelRate ? `${v.fuelRate} กม./ลิตร` : "ใช้ค่ามาตรฐาน"}</strong></span>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {vehicles?.length === 0 && <div className="col-span-full py-12 text-center text-muted-foreground">ไม่มีข้อมูลรถในระบบ</div>}
            </div>
          )}
        </TabsContent>

        <TabsContent value="drivers" className="space-y-4">
          {!isViewer && (
            <div className="flex justify-end">
              <Button 
                className="bg-primary hover:bg-primary/90 w-full sm:w-auto h-11 md:h-10" 
                onClick={() => { 
                  setEditingDriver(null); 
                  driverForm.reset({ name: "", phoneNumber: "" }); 
                  setIsDriverDialogOpen(true); 
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> เพิ่มคนขับใหม่
              </Button>
            </div>
          )}
          {isLoadingDrivers ? <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div> : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
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
                            <DropdownMenuItem onSelect={() => { 
                              setEditingDriver(d); 
                              driverForm.reset({ name: d.name, phoneNumber: d.phoneNumber }); 
                              setIsDriverDialogOpen(true); 
                            }}>
                              <Edit className="mr-2 h-4 w-4" /> แก้ไข
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onSelect={() => handleDeleteDriver(d.id)}>
                              <Trash2 className="mr-2 h-4 w-4" /> ลบ
                            </DropdownMenuItem>
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
              {drivers?.length === 0 && <div className="col-span-full py-12 text-center text-muted-foreground">ไม่มีข้อมูลคนขับในระบบ</div>}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Vehicle Dialog */}
      <Dialog 
        open={isVehicleDialogOpen} 
        onOpenChange={(open) => {
          setIsVehicleDialogOpen(open);
          if (!open) {
            setEditingVehicle(null);
            vehicleForm.reset();
          }
        }}
      >
        <DialogContent className="w-[95%] rounded-lg">
          <DialogHeader>
            <DialogTitle>{editingVehicle ? "แก้ไขข้อมูลรถ" : "เพิ่มรถใหม่"}</DialogTitle>
            <DialogDescription>ระบุรายละเอียดของยานพาหนะให้ครบถ้วน</DialogDescription>
          </DialogHeader>
          <Form {...vehicleForm}>
            <form onSubmit={vehicleForm.handleSubmit(onVehicleSubmit)} className="space-y-4">
              <FormField control={vehicleForm.control} name="licensePlate" render={({ field }) => (
                <FormItem><FormLabel>ทะเบียนรถ</FormLabel><FormControl><Input className="h-11" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={vehicleForm.control} name="type" render={({ field }) => (
                <FormItem><FormLabel>ประเภทรถ</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="h-11"><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="Pickup">Pickup</SelectItem><SelectItem value="4-wheel truck">4-wheel truck</SelectItem><SelectItem value="6-wheel truck">6-wheel truck</SelectItem></SelectContent></Select><FormMessage /></FormItem>
              )} />
              <FormField control={vehicleForm.control} name="maxLoadCapacityKg" render={({ field }) => (
                <FormItem><FormLabel>น้ำหนักบรรทุกสูงสุด (kg)</FormLabel><FormControl><Input className="h-11" type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={vehicleForm.control} name="fuelRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>อัตราสิ้นเปลือง (กม./ลิตร)</FormLabel>
                  <FormControl>
                    <Input className="h-11" type="number" step="0.1" placeholder="ถ้าไม่กรอก ใช้ค่ามาตรฐานจาก Settings" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full bg-accent h-12" disabled={isSavingVehicle}>
                {isSavingVehicle ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} บันทึก
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Driver Dialog */}
      <Dialog 
        open={isDriverDialogOpen} 
        onOpenChange={(open) => {
          setIsDriverDialogOpen(open);
          if (!open) {
            setEditingDriver(null);
            driverForm.reset();
          }
        }}
      >
        <DialogContent className="w-[95%] rounded-lg">
          <DialogHeader>
            <DialogTitle>{editingDriver ? "แก้ไขข้อมูลคนขับ" : "เพิ่มคนขับใหม่"}</DialogTitle>
            <DialogDescription>ระบุชื่อและเบอร์โทรศัพท์สำหรับติดต่อคนขับ</DialogDescription>
          </DialogHeader>
          <Form {...driverForm}>
            <form onSubmit={driverForm.handleSubmit(onDriverSubmit)} className="space-y-4">
              <FormField control={driverForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>ชื่อคนขับ</FormLabel><FormControl><Input className="h-11" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={driverForm.control} name="phoneNumber" render={({ field }) => (
                <FormItem><FormLabel>เบอร์โทรศัพท์</FormLabel><FormControl><Input className="h-11" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <Button type="submit" className="w-full bg-accent h-12" disabled={isSavingDriver}>
                {isSavingDriver ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} บันทึก
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
