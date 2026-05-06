
"use client"

import * as React from "react"
import { Plus, Search, MapPin, Filter, MoreHorizontal, Edit, Trash2, Loader2, ExternalLink, Map as MapIcon, Check, AlertCircle } from "lucide-react"
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
  FormDescription,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Site, ProjectType, UserProfile } from "@/types/models"
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from "@/firebase"
import { collection, doc, serverTimestamp } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useToast } from "@/hooks/use-toast"
import { Loader } from "@googlemaps/js-api-loader"
import { cn } from "@/lib/utils"

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""

const siteSchema = z.object({
  name: z.string().min(2, "กรุณาระบุชื่อไซน์งาน"),
  address: z.string().min(2, "กรุณาระบุที่อยู่สำหรับแสดงผล"),
  coordinates: z.string().optional().refine((val) => {
    if (!val) return true;
    const parts = val.split(',').map(s => s.trim());
    return parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]));
  }, "พิกัดต้องอยู่ในรูปแบบ lat, lng (เช่น 13.7563, 100.5018)"),
  projectTypeTag: z.enum(['LOTUS EME', 'P-ADVANCED']),
})

type SiteFormValues = z.infer<typeof siteSchema>

export default function SitesPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile } = useDoc<UserProfile>(userProfileRef)
  
  const isViewer = profile?.role === 'viewer'

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
      coordinates: "",
      projectTypeTag: "LOTUS EME",
    },
  })

  React.useEffect(() => {
    if (isMapPickerOpen && mapPickerRef.current && GOOGLE_MAPS_API_KEY) {
      const loader = new Loader({
        apiKey: GOOGLE_MAPS_API_KEY,
        version: "weekly"
      })

      loader.load().then(() => {
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
    if (isViewer) return

    let latitude: number | undefined = undefined
    let longitude: number | undefined = undefined

    if (values.coordinates) {
      const parts = values.coordinates.split(',').map(s => parseFloat(s.trim()))
      latitude = parts[0]
      longitude = parts[1]
    }

    const siteData = {
      name: values.name,
      address: values.address,
      projectTypeTag: values.projectTypeTag,
      latitude,
      longitude,
      status: 'Active' as const,
      updatedAt: serverTimestamp(),
    }

    if (editingSite) {
      const siteRef = doc(db, "sites", editingSite.id)
      updateDocumentNonBlocking(siteRef, siteData)
      toast({ title: "สำเร็จ", description: "แก้ไขข้อมูลไซน์งานเรียบร้อยแล้ว" })
    } else {
      const newSiteRef = doc(collection(db, "sites"))
      setDocumentNonBlocking(newSiteRef, {
        ...siteData,
        id: newSiteRef.id,
        createdAt: serverTimestamp(),
      }, { merge: true })
      toast({ title: "สำเร็จ", description: "เพิ่มไซน์งานใหม่เรียบร้อยแล้ว" })
    }
    setIsDialogOpen(false)
    setEditingSite(null)
    form.reset()
  }

  function handleEdit(site: Site) {
    if (isViewer) return
    setEditingSite(site)
    form.reset({
      name: site.name,
      address: site.address,
      coordinates: site.latitude && site.longitude ? `${site.latitude}, ${site.longitude}` : "",
      projectTypeTag: site.projectTypeTag as ProjectType,
    })
    setIsDialogOpen(true)
  }

  function handleDelete(siteId: string) {
    if (isViewer) return
    if (confirm("คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลไซน์งานนี้?")) {
      const siteRef = doc(db, "sites", siteId)
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
      const url = site.address.startsWith('http') ? site.address : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
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
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">จัดการไซน์งาน</h2>
          <p className="text-sm md:text-base text-muted-foreground">เพิ่ม แก้ไข และจัดการข้อมูลไซน์งานทั้งหมด</p>
        </div>
        {!isViewer && (
          <Button 
            className="bg-accent hover:bg-accent/90 h-11 md:h-10 w-full sm:w-auto" 
            onClick={() => {
              setEditingSite(null)
              form.reset({
                name: "",
                address: "",
                coordinates: "",
                projectTypeTag: "LOTUS EME",
              })
              setIsDialogOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> เพิ่มไซน์งานใหม่
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 border-b">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาชื่อไซน์งาน หรือ ที่อยู่..." 
                className="pl-10 h-11 md:h-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อไซน์งาน</TableHead>
                  <TableHead>บริษัทที่รับผิดชอบ</TableHead>
                  <TableHead>ที่อยู่/พิกัด</TableHead>
                  <TableHead className="text-right">{!isViewer && "จัดการ"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-accent" />
                    </TableCell>
                  </TableRow>
                ) : filteredSites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      ไม่พบข้อมูลไซน์งาน
                    </TableCell>
                  </TableRow>
                ) : filteredSites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {site.name}
                        {site.latitude && site.longitude ? (
                          <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-500 border-green-500/20">
                            <Check className="h-2 w-2 mr-1" /> ปักหมุดแล้ว
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                            <AlertCircle className="h-2 w-2 mr-1" /> ยังไม่ปักหมุด
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
                          onClick={() => handleOpenMap(site)}
                          title="ดูใน Google Maps"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {!isViewer && (
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
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden">
            {isLoading ? (
              <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
            ) : filteredSites.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">ไม่พบข้อมูลไซน์งาน</div>
            ) : (
              <div className="divide-y">
                {filteredSites.map((site) => (
                  <div key={site.id} className="p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="font-bold">{site.name}</div>
                        <Badge variant="outline" className={cn("text-[10px]", getTagColor(site.projectTypeTag as ProjectType))}>
                          {site.projectTypeTag}
                        </Badge>
                      </div>
                      {!isViewer && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(site)}>
                              <Edit className="mr-2 h-4 w-4" /> แก้ไข
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(site.id)}>
                              <Trash2 className="mr-2 h-4 w-4" /> ลบ
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground bg-secondary/20 p-2 rounded">
                      <span className="truncate flex-1 pr-4">{site.address}</span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 w-7 p-0 text-accent" 
                        onClick={() => handleOpenMap(site)}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      {site.latitude && site.longitude ? (
                        <Badge variant="outline" className="text-[9px] bg-green-500/10 text-green-500 border-green-500/20">
                          ปักหมุดแล้ว
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] bg-muted text-muted-foreground">
                          ยังไม่ปักหมุด
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px] w-[95%] rounded-lg">
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
                      <Input placeholder="เช่น โครงการ ABC สุขุมวิท..." className="h-11" {...field} />
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
                      <Input placeholder="เช่น ซอยสุขุมวิท 24, กรุงเทพฯ..." className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="coordinates"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>พิกัด (lat, lng)</FormLabel>
                    <FormControl>
                      <Input placeholder="เช่น 13.7563, 100.5018" className="h-11" {...field} />
                    </FormControl>
                    <FormDescription className="text-[10px]">
                      คัดลอกจาก Google Maps → คลิกขวาบนแผนที่ → คัดลอกพิกัด
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="relative flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] text-muted-foreground uppercase">หรือ</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <Button 
                type="button" 
                variant="outline" 
                className="w-full border-accent text-accent hover:bg-accent/10 h-11"
                onClick={() => setIsMapPickerOpen(true)}
              >
                <MapIcon className="mr-2 h-4 w-4" /> ปักหมุดบนแผนที่แทน
              </Button>

              <FormField
                control={form.control}
                name="projectTypeTag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>บริษัทที่รับผิดชอบ</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-11">
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
                <Button type="submit" className="w-full bg-accent h-12">
                  {editingSite ? "บันทึกการแก้ไข" : "เพิ่มไซน์งาน"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Map Picker Modal */}
      <Dialog open={isMapPickerOpen} onOpenChange={setIsMapPickerOpen}>
        <DialogContent className="sm:max-w-[700px] h-screen sm:h-[600px] flex flex-col p-0 overflow-hidden w-full sm:w-auto">
          <DialogHeader className="p-4 border-b bg-background flex justify-between items-center space-y-0">
            <div className="flex flex-col">
              <DialogTitle className="font-bold text-sm md:text-base">เลือกพิกัดไซน์งาน</DialogTitle>
              <DialogDescription className="text-[10px] md:text-xs text-muted-foreground">คลิกบนแผนที่เพื่อปักหมุด</DialogDescription>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setIsMapPickerOpen(false)} className="h-8 w-8 p-0">
               <AlertCircle className="h-5 w-5" />
            </Button>
          </DialogHeader>
          <div ref={mapPickerRef} className="flex-1 w-full bg-muted" />
          <div className="p-4 border-t bg-background flex flex-col sm:flex-row gap-3 justify-between items-center">
            <div className="text-[10px] md:text-xs text-center sm:text-left">
              <span className="font-bold">พิกัดที่เลือก:</span> {form.watch("coordinates") || "--"}
            </div>
            <Button onClick={() => setIsMapPickerOpen(false)} className="bg-accent w-full sm:w-auto h-11 sm:h-9">
              ยืนยันตำแหน่ง
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
