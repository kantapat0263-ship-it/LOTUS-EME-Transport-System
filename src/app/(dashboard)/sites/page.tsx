
"use client"

import * as React from "react"
import { Plus, Search, MapPin, Filter, MoreHorizontal, Edit, Trash2, Loader2, ExternalLink, Map as MapIcon, Check, AlertCircle, Building2, Globe, Store, Landmark, Briefcase } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
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
  FormDescription,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Site, ProjectType, UserProfile, CompanySetting } from "@/types/models"
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, doc, serverTimestamp } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useToast } from "@/hooks/use-toast"
import { Loader } from "@googlemaps/js-api-loader"
import { cn } from "@/lib/utils"

const siteSchema = z.object({
  name: z.string().min(2, "กรุณาระบุชื่อสถานที่"),
  address: z.string().optional().default(""),
  coordinates: z.string().min(1, "กรุณาระบุพิกัด").refine((val) => {
    if (!val) return true;
    const parts = val.split(',').map(s => s.trim());
    return parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]));
  }, "พิกัดต้องอยู่ในรูปแบบ lat, lng (เช่น 13.7563, 100.5018)"),
  projectTypeTag: z.string().min(1, "กรุณาเลือกประเภท"),
})

type SiteFormValues = z.infer<typeof siteSchema>

export default function SitesPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef)
  
  const settingsRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: companySettings } = useDoc<CompanySetting>(settingsRef)
  
  const isViewer = profile?.role === 'viewer'
  const isStaff = profile?.role === 'admin' || profile?.role === 'dispatcher'

  const [searchTerm, setSearchTerm] = React.useState("")
  const [filterType, setFilterType] = React.useState("ทั้งหมด")
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [isMapPickerOpen, setIsMapPickerOpen] = React.useState(false)
  const [editingSite, setEditingSite] = React.useState<Site | null>(null)
  const mapPickerRef = React.useRef<HTMLDivElement>(null)
  
  const sitesRef = useMemoFirebase(() => (db && user) ? collection(db, "sites") : null, [db, user])
  const { data: sites, isLoading } = useCollection<any>(sitesRef)

  const form = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
    defaultValues: {
      name: "",
      address: "",
      coordinates: "",
      projectTypeTag: "ไซต์งาน",
    },
  })

  React.useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || companySettings?.googleMapsApiKeyReference;
    
    if (!isMapPickerOpen || !apiKey) return

    // Wait for Dialog animation to complete before initializing map
    const timer = setTimeout(() => {
      if (!mapPickerRef.current) return

      const loader = new Loader({
        apiKey: apiKey,
        version: "weekly",
        libraries: ["places", "geometry"]
      })

      loader.load().then(() => {
        if (!mapPickerRef.current) return
        const coordsStr = form.getValues("coordinates")
        let center = { lat: 13.7563, lng: 100.5018 }
        
        if (coordsStr) {
          const parts = coordsStr.split(',').map(s => parseFloat(s.trim()))
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            center = { lat: parts[0], lng: parts[1] }
          }
        }
        
        const google = window.google
        const newMap = new google.maps.Map(mapPickerRef.current!, {
          center,
          zoom: 15,
          mapTypeControl: false,
          streetViewControl: false,
        })

        const newMarker = new google.maps.Marker({
          position: center,
          map: newMap,
          draggable: true,
          animation: google.maps.Animation.DROP,
        })

        newMap.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) {
            newMarker.setPosition(e.latLng)
            form.setValue("coordinates", `${e.latLng.lat()}, ${e.latLng.lng()}`)
          }
        })

        newMarker.addListener("dragend", () => {
          const pos = newMarker.getPosition()
          if (pos) {
            form.setValue("coordinates", `${pos.lat()}, ${pos.lng()}`)
          }
        })
      })
    }, 500) // Wait 500ms for Dialog animation

    return () => clearTimeout(timer)
  }, [isMapPickerOpen, companySettings, form])

  const filteredSites = sites?.filter(site => {
    const matchesSearch = site.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (site.address || "").toLowerCase().includes(searchTerm.toLowerCase());
    
    // Support legacy "ไซน์งาน" spelling in filtering
    const normalizedTag = site.projectTypeTag === 'ไซน์งาน' ? 'ไซต์งาน' : site.projectTypeTag;
    const matchesFilter = filterType === "ทั้งหมด" || normalizedTag === filterType;
    
    return matchesSearch && matchesFilter;
  }) || []

  function onSubmit(values: SiteFormValues) {
    if (!user) return

    let latitude: number | undefined = undefined
    let longitude: number | undefined = undefined

    if (values.coordinates) {
      const parts = values.coordinates.split(',').map(s => parseFloat(s.trim()))
      latitude = parts[0]
      longitude = parts[1]
    }

    const siteData = {
      name: values.name,
      address: values.address || "",
      projectTypeTag: values.projectTypeTag,
      latitude,
      longitude,
      status: 'Active' as const,
      updatedAt: serverTimestamp(),
    }

    if (editingSite) {
      const siteRef = doc(db, "sites", editingSite.id)
      updateDocumentNonBlocking(siteRef, siteData)
      toast({ title: "สำเร็จ", description: "แก้ไขข้อมูลเรียบร้อยแล้ว" })
    } else {
      const newSiteRef = doc(collection(db, "sites"))
      setDocumentNonBlocking(newSiteRef, {
        ...siteData,
        id: newSiteRef.id,
        createdAt: serverTimestamp(),
        isUserAdded: true,
        addedBy: user.email,
        addedByName: profile?.name || user.email
      }, { merge: true })
      toast({ title: "สำเร็จ", description: "เพิ่มสถานที่ใหม่เรียบร้อยแล้ว" })
    }
    setIsDialogOpen(false)
    setEditingSite(null)
    form.reset()
  }

  function handleEdit(site: Site) {
    if (!profile) return;
    
    const canEdit = isStaff || (site as any).addedBy === user?.email;
    if (!canEdit) {
      toast({ title: "ไม่มีสิทธิ์", description: "คุณสามารถแก้ไขได้เฉพาะสถานที่ที่คุณเพิ่มเองเท่านั้น", variant: "destructive" });
      return;
    }

    setEditingSite(site)
    form.reset({
      name: site.name,
      address: site.address,
      coordinates: site.latitude && site.longitude ? `${site.latitude}, ${site.longitude}` : "",
      projectTypeTag: site.projectTypeTag === 'ไซน์งาน' ? 'ไซต์งาน' : site.projectTypeTag,
    })
    
    setTimeout(() => {
      setIsDialogOpen(true)
    }, 100)
  }

  function handleDelete(site: any) {
    if (!profile || !user) return;
    
    const canDelete = isStaff || (site.addedBy === user.email);
    
    if (!canDelete) {
      toast({ title: "ไม่มีสิทธิ์", description: "เฉพาะแอดมินหรือผู้ที่เพิ่มสถานที่นี้เท่านั้นที่ลบได้", variant: "destructive" });
      return;
    }

    if (confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบ "${site.name}"?`)) {
      const siteRef = doc(db, "sites", site.id)
      deleteDocumentNonBlocking(siteRef)
      toast({ title: "สำเร็จ", description: "ลบข้อมูลเรียบร้อยแล้ว" })
    }
  }

  const handleOpenMap = (site: Site) => {
    if (site.latitude && site.longitude) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${site.latitude},${site.longitude}`, '_blank');
      return;
    }
    if (site.address) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}`, '_blank');
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'ไซต์งาน':
      case 'ไซน์งาน': return <Building2 className="h-4 w-4" />
      case 'ร้านค้า / ซัพพลายเออร์': return <Store className="h-4 w-4" />
      case 'ธนาคาร': return <Landmark className="h-4 w-4" />
      case 'บริษัท / หน่วยงานราชการ': return <Briefcase className="h-4 w-4" />
      default: return <Globe className="h-4 w-4" />
    }
  }

  const locationTypes = ["ทั้งหมด", "ไซต์งาน", "ร้านค้า / ซัพพลายเออร์", "ธนาคาร", "บริษัท / หน่วยงานราชการ", "อื่น ๆ", "LOTUS EME", "P-ADVANCED"]

  if (!user || isProfileLoading) return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-accent" /></div>

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">จัดการไซต์งาน</h2>
          <p className="text-sm md:text-base text-muted-foreground">เพิ่มและจัดการไซต์งาน ร้านค้า และจุดส่งของประจำ</p>
        </div>
        <Button 
          className="bg-accent hover:bg-accent/90 h-11 md:h-10 w-full sm:w-auto" 
          onClick={() => {
            setEditingSite(null)
            form.reset({ name: "", address: "", coordinates: "", projectTypeTag: "ไซต์งาน" })
            setIsDialogOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> {isStaff ? "เพิ่มไซต์งานใหม่" : "เพิ่มสถานที่ใหม่"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {locationTypes.slice(0, 6).map(type => (
          <Button 
            key={type}
            variant={filterType === type ? "default" : "outline"}
            size="sm"
            className={cn("h-8 text-xs transition-all", filterType === type && "bg-accent")}
            onClick={() => setFilterType(type)}
          >
            {type}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาชื่อสถานที่..." 
                className="pl-10 h-11 md:h-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อสถานที่ / ประเภท</TableHead>
                  <TableHead>ผู้เพิ่มข้อมูล</TableHead>
                  <TableHead>พิกัด/ที่อยู่</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-accent" /></TableCell></TableRow>
                ) : filteredSites.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">ไม่พบข้อมูล</TableCell></TableRow>
                ) : filteredSites.map((site) => {
                  const canManage = isStaff || (site.addedBy === user?.email);
                  const displayTag = site.projectTypeTag === 'ไซน์งาน' ? 'ไซต์งาน' : site.projectTypeTag;
                  return (
                    <TableRow key={site.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="font-bold flex items-center gap-2">
                            {site.name}
                            {site.isUserAdded && <Badge variant="outline" className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/20">เพิ่มโดยผู้ใช้</Badge>}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {getTypeIcon(site.projectTypeTag)} {displayTag}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-xs font-medium">{site.addedByName || "ระบบส่วนกลาง"}</span>
                          <span className="text-[10px] text-muted-foreground">{site.addedBy || "-"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="text-xs truncate max-w-[200px]">{site.latitude ? `${site.latitude.toFixed(4)}, ${site.longitude.toFixed(4)}` : site.address}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-accent" onClick={() => handleOpenMap(site)}><ExternalLink className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canManage && (
                              <>
                                <DropdownMenuItem onSelect={() => handleEdit(site)}><Edit className="mr-2 h-4 w-4" /> แก้ไข</DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive" onSelect={() => handleDelete(site)}><Trash2 className="mr-2 h-4 w-4" /> ลบ</DropdownMenuItem>
                              </>
                            )}
                            {!canManage && <div className="p-2 text-[10px] text-muted-foreground italic">ไม่มีสิทธิ์จัดการ</div>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          
          {/* Mobile view */}
          <div className="md:hidden divide-y">
            {filteredSites.map(site => {
              const canManage = isStaff || (site.addedBy === user?.email);
              const displayTag = site.projectTypeTag === 'ไซน์งาน' ? 'ไซต์งาน' : site.projectTypeTag;
              return (
                <div key={site.id} className="p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold">{site.name}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1">
                        {getTypeIcon(site.projectTypeTag)} {displayTag}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canManage && (
                          <>
                            <DropdownMenuItem onSelect={() => handleEdit(site)}>แก้ไข</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => handleDelete(site)} className="text-destructive">ลบ</DropdownMenuItem>
                          </>
                        )}
                        {!canManage && <div className="p-2 text-[10px] text-muted-foreground">อ่านอย่างเดียว</div>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex justify-between items-center text-[10px] bg-secondary/20 p-2 rounded">
                    <span className="truncate flex-1">{site.address || "มีข้อมูลพิกัด (GPS)"}</span>
                    <Button variant="ghost" size="sm" className="h-6 text-accent" onClick={() => handleOpenMap(site)}>เปิดแผนที่</Button>
                  </div>
                  {site.isUserAdded && <div className="text-[10px] text-muted-foreground">เพิ่มโดย: {site.addedByName}</div>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) {
          setEditingSite(null);
          form.reset();
        }
      }}>
        <DialogContent className="sm:max-w-[500px] w-[95%] rounded-lg">
          <DialogHeader>
            <DialogTitle>{editingSite ? "แก้ไขข้อมูลสถานที่" : "เพิ่มสถานที่ใหม่"}</DialogTitle>
            <DialogDescription>ระบุรายละเอียดและพิกัดที่แน่นอนเพื่อให้คนขับนำทางได้ถูกต้อง</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>ชื่อสถานที่</FormLabel><FormControl><Input placeholder="เช่น โครงการ ABC สุขุมวิท..." className="h-11" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              
              <FormField control={form.control} name="projectTypeTag" render={({ field }) => (
                <FormItem>
                  <FormLabel>ประเภทสถานที่</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger className="h-11"><SelectValue placeholder="เลือกประเภท" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {locationTypes.slice(1).map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="coordinates" render={({ field }) => (
                <FormItem>
                  <FormLabel>พิกัด (lat, lng)</FormLabel>
                  <FormControl><Input placeholder="เช่น 13.7563, 100.5018" className="h-11" {...field} /></FormControl>
                  <FormDescription className="text-[10px]">คัดลอกจาก Google Maps → คลิกขวาบนจุดที่ต้องการ → คัดลอกพิกัด</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <Button type="button" variant="outline" className="w-full border-accent text-accent h-11" onClick={() => setIsMapPickerOpen(true)}><MapIcon className="mr-2 h-4 w-4" /> ปักหมุดบนแผนที่แทน</Button>

              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                  <FormLabel>ที่อยู่ / หมายเหตุ (เลือกได้)</FormLabel>
                  <FormControl><Textarea placeholder="เช่น ซอย 24, ชั้น 3..." className="bg-background" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter className="pt-4">
                <Button type="submit" className="w-full bg-accent h-12">บันทึกข้อมูล</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isMapPickerOpen} onOpenChange={setIsMapPickerOpen}>
        <DialogContent className="sm:max-w-[700px] h-screen sm:h-[600px] flex flex-col p-0 overflow-hidden w-full">
          <DialogHeader className="p-4 border-b bg-background flex justify-between items-center space-y-0">
            <div className="flex flex-col"><DialogTitle className="font-bold">เลือกพิกัดบนแผนที่</DialogTitle><DialogDescription className="text-[10px]">คลิกบนแผนที่เพื่อระบุพิกัด</DialogDescription></div>
          </DialogHeader>
          <div ref={mapPickerRef} className="flex-1 w-full bg-muted" />
          <div className="p-4 border-t bg-background flex flex-col sm:flex-row gap-3 justify-between items-center">
            <div className="text-[10px]"><span className="font-bold">พิกัดที่เลือก:</span> {form.watch("coordinates") || "--"}</div>
            <Button onClick={() => setIsMapPickerOpen(false)} className="bg-accent w-full sm:w-auto">ยืนยันตำแหน่ง</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
