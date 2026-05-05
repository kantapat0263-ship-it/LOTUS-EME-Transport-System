
"use client"

import * as React from "react"
import { Plus, Search, MapPin, Filter, MoreHorizontal, Edit, Trash2, Loader2, ExternalLink, Map as MapIcon, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Site, ProjectType } from "@/types/models"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { collection, doc, serverTimestamp } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useToast } from "@/hooks/use-toast"
import { Loader } from "@googlemaps/js-api-loader"

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""

const siteSchema = z.object({
  name: z.string().min(2, "กรุณาระบุชื่อไซน์งาน"),
  address: z.string().min(5, "กรุณาระบุที่อยู่"),
  projectTypeTag: z.enum(['LOTUS EME', 'P-ADVANCED']),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
})

type SiteFormValues = z.infer<typeof siteSchema>

export default function SitesPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const [searchTerm, setSearchTerm] = React.useState("")
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [isMapPickerOpen, setIsMapPickerOpen] = React.useState(false)
  const [editingSite, setEditingSite] = React.useState<Site | null>(null)
  const mapPickerRef = React.useRef<HTMLDivElement>(null)
  const [map, setMap] = React.useState<google.maps.Map | null>(null)
  const [marker, setMarker] = React.useState<google.maps.Marker | null>(null)

  const sitesRef = useMemoFirebase(() => collection(db, "sites"), [db])
  const { data: sites, isLoading } = useCollection<Site>(sitesRef)

  const form = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
    defaultValues: {
      name: "",
      address: "",
      projectTypeTag: "LOTUS EME",
      latitude: undefined,
      longitude: undefined,
    },
  })

  // Initialize Map Picker
  React.useEffect(() => {
    if (isMapPickerOpen && mapPickerRef.current && GOOGLE_MAPS_API_KEY) {
      const loader = new Loader({
        apiKey: GOOGLE_MAPS_API_KEY,
        version: "weekly"
      })

      loader.load().then(() => {
        const center = { 
          lat: form.getValues("latitude") || 13.7563, 
          lng: form.getValues("longitude") || 100.5018 
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
            form.setValue("latitude", e.latLng.lat())
            form.setValue("longitude", e.latLng.lng())
          }
        })

        newMarker.addListener("dragend", () => {
          const pos = newMarker.getPosition()
          if (pos) {
            form.setValue("latitude", pos.lat())
            form.setValue("longitude", pos.lng())
          }
        })

        setMap(newMap)
        setMarker(newMarker)
      })
    }
  }, [isMapPickerOpen, GOOGLE_MAPS_API_KEY, form])

  const filteredSites = sites?.filter(site => 
    site.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    site.address.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  function onSubmit(values: SiteFormValues) {
    if (editingSite) {
      const siteRef = doc(db, "sites", editingSite.id)
      updateDocumentNonBlocking(siteRef, {
        ...values,
        updatedAt: serverTimestamp(),
      })
      toast({ title: "สำเร็จ", description: "แก้ไขข้อมูลไซน์งานเรียบร้อยแล้ว" })
    } else {
      const newSiteRef = doc(collection(db, "sites"))
      setDocumentNonBlocking(newSiteRef, {
        ...values,
        id: newSiteRef.id,
        status: 'Active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })
      toast({ title: "สำเร็จ", description: "เพิ่มไซน์งานใหม่เรียบร้อยแล้ว" })
    }
    setIsDialogOpen(false)
    setEditingSite(null)
    form.reset()
  }

  function handleEdit(site: Site) {
    setEditingSite(site)
    form.reset({
      name: site.name,
      address: site.address,
      projectTypeTag: site.projectTypeTag as ProjectType,
      latitude: site.latitude,
      longitude: site.longitude,
    })
    setIsDialogOpen(true)
  }

  function handleDelete(siteId: string) {
    if (confirm("คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลไซน์งานนี้?")) {
      const siteRef = doc(db, "sites", siteId)
      deleteDocumentNonBlocking(siteRef)
      toast({ title: "สำเร็จ", description: "ลบข้อมูลเรียบร้อยแล้ว" })
    }
  }

  const handleOpenMap = (address: string) => {
    if (!address) return;
    const url = address.startsWith('http') ? address : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const getTagColor = (type: ProjectType) => {
    switch (type) {
      case 'LOTUS EME': return 'bg-primary/20 text-primary border-primary/30';
      case 'P-ADVANCED': return 'bg-accent/20 text-accent border-accent/30';
      default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">จัดการไซน์งาน</h2>
          <p className="text-muted-foreground">เพิ่ม แก้ไข และจัดการข้อมูลไซน์งานทั้งหมด</p>
        </div>
        <Button 
          className="bg-accent hover:bg-accent/90" 
          onClick={() => {
            setEditingSite(null)
            form.reset({
              name: "",
              address: "",
              projectTypeTag: "LOTUS EME",
              latitude: undefined,
              longitude: undefined,
            })
            setIsDialogOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> เพิ่มไซน์งานใหม่
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 border-b">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาชื่อไซน์งาน หรือ ที่อยู่..." 
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อไซน์งาน</TableHead>
                <TableHead>บริษัทที่รับผิดชอบ</TableHead>
                <TableHead>พิกัด/ที่อยู่</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filteredSites.map((site) => (
                <TableRow key={site.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {site.name}
                      {site.latitude && site.longitude && (
                        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-500 border-green-500/20">
                          <Check className="h-2 w-2 mr-1" /> ปักหมุดแล้ว
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={getTagColor(site.projectTypeTag as ProjectType)}>
                      {site.projectTypeTag}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{site.address}</span>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 shrink-0 hover:bg-accent/10 hover:text-accent" 
                        onClick={() => handleOpenMap(site.address)}
                        title="ดูใน Google Maps"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(site)}>
                          <Edit className="mr-2 h-4 w-4" /> แก้ไขข้อมูล
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(site.id)}>
                          <Trash2 className="mr-2 h-4 w-4" /> ลบข้อมูล
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingSite ? "แก้ไขข้อมูลไซน์งาน" : "เพิ่มไซน์งานใหม่"}</DialogTitle>
            <DialogDescription>
              ระบุรายละเอียดโครงการและพิกัดที่แน่นอนบนแผนที่
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ชื่อโครงการ</FormLabel>
                    <FormControl>
                      <Input placeholder="เช่น โครงการ ABC สุขุมวิท..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ที่อยู่ (สำหรับแสดงผล)</FormLabel>
                    <FormControl>
                      <Input placeholder="ระบุที่อยู่หรือลิงก์พิกัด..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="latitude"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Latitude</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" placeholder="0.0000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="longitude"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Longitude</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" placeholder="0.0000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button 
                type="button" 
                variant="outline" 
                className="w-full border-accent text-accent hover:bg-accent/10"
                onClick={() => setIsMapPickerOpen(true)}
              >
                <MapIcon className="mr-2 h-4 w-4" /> ปักหมุดบนแผนที่
              </Button>

              <FormField
                control={form.control}
                name="projectTypeTag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>บริษัทที่รับผิดชอบ</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="เลือกบริษัท" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="LOTUS EME">LOTUS EME</SelectItem>
                        <SelectItem value="P-ADVANCED">P-ADVANCED</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="pt-4">
                <Button type="submit" className="w-full bg-accent">
                  {editingSite ? "บันทึกการแก้ไข" : "เพิ่มไซน์งาน"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Map Picker Modal */}
      <Dialog open={isMapPickerOpen} onOpenChange={setIsMapPickerOpen}>
        <DialogContent className="sm:max-w-[700px] h-[600px] flex flex-col p-0 overflow-hidden">
          <div className="p-4 border-b bg-background">
            <h3 className="font-bold">คลิกบนแผนที่เพื่อเลือกพิกัดไซน์งาน</h3>
            <p className="text-xs text-muted-foreground">คุณสามารถคลิกหรือลากหมุดเพื่อเปลี่ยนตำแหน่งได้</p>
          </div>
          <div ref={mapPickerRef} className="flex-1 w-full bg-muted" />
          <div className="p-4 border-t bg-background flex justify-between items-center">
            <div className="text-xs">
              <span className="font-bold">พิกัดที่เลือก:</span> {form.watch("latitude")?.toFixed(6)}, {form.watch("longitude")?.toFixed(6)}
            </div>
            <Button onClick={() => setIsMapPickerOpen(false)} className="bg-accent">
              ยืนยันตำแหน่ง
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
