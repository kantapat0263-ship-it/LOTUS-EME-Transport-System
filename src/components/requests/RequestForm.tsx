
"use client"

import * as React from "react"
import { useFirestore, useCollection, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, setDoc, serverTimestamp, getDocs, query, where } from "firebase/firestore"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { 
  Plus, 
  Trash2, 
  MapPin, 
  ExternalLink, 
  Loader2, 
  Send,
  Building2,
  Store,
  Landmark,
  Briefcase,
  Search
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Site, UserProfile } from "@/types/models"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"

interface DestinationRequest {
  id: string;
  category: "site" | "store" | "bank" | "company" | "custom";
  searchTerm: string;
  siteId: string;
  siteName: string;
  customName: string;
  coordinates: string;
  jobDescription: string;
  saveAsSite: boolean;
  locationType: string;
}

const CATEGORIES = [
  { id: 'site', label: 'ไซน์งาน', icon: Building2, types: ['ไซน์งาน', 'Electrical', 'Plumbing', 'HVAC', 'Mixed'] },
  { id: 'store', label: 'ร้านค้า', icon: Store, types: ['ร้านค้า / ซัพพลายเออร์'] },
  { id: 'bank', label: 'ธนาคาร', icon: Landmark, types: ['ธนาคาร'] },
  { id: 'company', label: 'บริษัท', icon: Briefcase, types: ['บริษัท / หน่วยงานราชการ'] },
  { id: 'custom', label: 'กำหนดเอง', icon: MapPin, types: [] },
] as const;

export function RequestForm() {
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()
  
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile } = useDoc<UserProfile>(userProfileRef)

  const sitesRef = useMemoFirebase(() => db ? collection(db, "sites") : null, [db])
  const { data: sites } = useCollection<Site>(sitesRef)

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [requestedBy, setRequestedBy] = React.useState(user?.displayName || "")
  const [requestDate, setRequestDate] = React.useState(new Date().toISOString().split('T')[0])
  const [requestTime, setRequestTime] = React.useState("08:30")
  const [note, setNote] = React.useState("")
  const [destinations, setDestinations] = React.useState<DestinationRequest[]>([
    { id: "1", category: "site", searchTerm: "", siteId: "", siteName: "", customName: "", coordinates: "", jobDescription: "", saveAsSite: false, locationType: "ไซน์งาน" }
  ])

  const addDestination = () => {
    if (destinations.length >= 10) {
      toast({ title: "เต็มแล้ว", description: "เพิ่มจุดหมายได้สูงสุด 10 จุด", variant: "destructive" })
      return
    }
    setDestinations(prev => [...prev, { 
      id: Date.now().toString(), 
      category: "site",
      searchTerm: "",
      siteId: "", 
      siteName: "", 
      customName: "", 
      coordinates: "", 
      jobDescription: "",
      saveAsSite: false,
      locationType: "ไซน์งาน"
    }])
  }

  const removeDestination = (id: string) => {
    if (destinations.length > 1) {
      setDestinations(prev => prev.filter(d => d.id !== id))
    }
  }

  // Combined update function to avoid race conditions
  const updateDest = (id: string, updates: Partial<DestinationRequest>) => {
    setDestinations(prev => prev.map(d => {
      if (d.id === id) {
        let updated = { ...d, ...updates };
        
        // Auto-fill coordinates if siteId changes
        if (updates.siteId !== undefined && updated.category !== "custom") {
          const site = sites?.find(s => s.id === updates.siteId);
          if (site) {
            updated.siteName = site.name;
            updated.coordinates = site.latitude && site.longitude ? `${site.latitude}, ${site.longitude}` : "";
          }
        }
        return updated;
      }
      return d;
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!requestedBy || !requestDate || !requestTime || !user) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อผู้ขอ วันที่ และเวลา", variant: "destructive" })
      return
    }

    const validDestinations = destinations.filter(d => 
      (d.category !== "custom" && d.siteId) || (d.category === "custom" && d.customName && d.coordinates)
    )

    if (validDestinations.length === 0) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุจุดหมายอย่างน้อย 1 จุดพร้อมพิกัด", variant: "destructive" })
      return
    }

    setIsSubmitting(true)
    try {
      // Sequential VR ID generation: VR-DDMM-XXX
      const [year, month, day] = requestDate.split('-');
      const datePrefix = `VR-${day}${month}`;
      const qRequests = query(collection(db, "vehicleRequests"), where("requestDate", "==", requestDate));
      const snapRequests = await getDocs(qRequests);
      const sequence = String(snapRequests.size + 1).padStart(3, '0');
      const safety = Math.floor(Math.random() * 10);
      const requestId = `${datePrefix}-${sequence}${safety}`;

      const requestRef = doc(db, "vehicleRequests", requestId)
      
      const parsedDestinations = []

      for (const d of validDestinations) {
        const [lat, lng] = d.coordinates.split(',').map(s => parseFloat(s.trim()))
        const latVal = isNaN(lat) ? 0 : lat
        const lngVal = isNaN(lng) ? 0 : lng
        const finalName = d.category === "custom" ? d.customName : d.siteName

        parsedDestinations.push({
          type: d.category === "custom" ? "other" : "site",
          siteId: d.siteId || null,
          siteName: finalName,
          customName: d.category === "custom" ? d.customName : null,
          lat: latVal,
          lng: lngVal,
          jobDescription: d.jobDescription
        })

        if (d.category === "custom" && d.saveAsSite && d.customName && d.coordinates) {
          const newSiteRef = doc(collection(db, "sites"))
          await setDoc(newSiteRef, {
            id: newSiteRef.id,
            name: d.customName,
            address: "",
            latitude: latVal,
            longitude: lngVal,
            projectTypeTag: d.locationType,
            status: "Active",
            isUserAdded: true,
            addedBy: user.email,
            addedByName: profile?.name || user.email,
            createdAt: serverTimestamp()
          })
          toast({ title: "บันทึกสถานที่แล้ว", description: `บันทึก ${d.customName} เข้าสู่รายการโปรดแล้ว` })
        }
      }

      const requestData = {
        id: requestId,
        requestId,
        requestDate,
        requestTime,
        requestedBy,
        requestedByEmail: user.email,
        userId: user.uid,
        userEmail: user.email,
        destinations: parsedDestinations,
        note,
        status: "pending",
        createdAt: serverTimestamp(),
      }

      await setDoc(requestRef, requestData)
      toast({ title: "ส่งคำขอรถสำเร็จ", description: `รหัสอ้างอิง: ${requestId}` })
      
      setRequestDate(new Date().toISOString().split('T')[0])
      setRequestTime("08:30")
      setNote("")
      setDestinations([{ id: "1", category: "site", searchTerm: "", siteId: "", siteName: "", customName: "", coordinates: "", jobDescription: "", saveAsSite: false, locationType: "ไซน์งาน" }])
    } catch (error) {
      console.error("Error saving request:", error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถส่งคำขอได้ในขณะนี้", variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card className="border-accent/20 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-accent" /> ข้อมูลการขอใช้รถ
          </CardTitle>
          <CardDescription>กรอกรายละเอียดเพื่อขอรับบริการรถรับ-ส่งหรืองานขนส่ง</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="requestedBy">ชื่อผู้ขอใช้รถ</Label>
                <Input 
                  id="requestedBy" 
                  placeholder="ชื่อ-นามสกุล" 
                  className="h-11"
                  value={requestedBy}
                  onChange={(e) => setRequestedBy(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="requestDate">วันที่ต้องการรถ</Label>
                <Input 
                  id="requestDate" 
                  type="date" 
                  className="h-11"
                  value={requestDate}
                  onChange={(e) => setRequestDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="requestTime">เวลาที่ต้องการ</Label>
                <Input 
                  id="requestTime" 
                  type="time" 
                  className="h-11"
                  value={requestTime}
                  onChange={(e) => setRequestTime(e.target.value)}
                  required
                  step="60"
                  lang="en-GB"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-bold">จุดหมายปลายทาง ({destinations.length}/10)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addDestination} className="border-accent text-accent">
                  <Plus className="mr-2 h-4 w-4" /> เพิ่มจุดหมาย
                </Button>
              </div>

              <div className="space-y-4">
                {destinations.map((dest, index) => (
                  <Card key={dest.id} className="bg-secondary/20 border-border/50 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-accent" />
                    <CardContent className="p-4 md:p-6 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex flex-wrap gap-1.5 p-1 bg-background/50 rounded-lg">
                          {CATEGORIES.map(cat => (
                            <Button 
                              key={cat.id}
                              type="button"
                              variant={dest.category === cat.id ? "default" : "ghost"}
                              size="sm"
                              className={cn(
                                "h-8 text-[10px] px-2.5 flex items-center gap-1.5 transition-all",
                                dest.category === cat.id ? "bg-accent text-white shadow-sm" : "text-muted-foreground hover:bg-secondary/60"
                              )}
                              onClick={() => {
                                updateDest(dest.id, {
                                  category: cat.id,
                                  siteId: "",
                                  siteName: "",
                                  customName: "",
                                  coordinates: "",
                                  searchTerm: ""
                                });
                              }}
                            >
                              <cat.icon className="h-3.5 w-3.5" />
                              {cat.label}
                            </Button>
                          ))}
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive h-8 w-8 self-end sm:self-auto" onClick={() => removeDestination(dest.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {dest.category !== "custom" ? (
                        <div className="space-y-4">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                              placeholder="พิมพ์เพื่อค้นหา..." 
                              className="h-10 pl-10 text-xs bg-background/30"
                              value={dest.searchTerm}
                              onChange={(e) => updateDest(dest.id, { searchTerm: e.target.value })}
                            />
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>เลือก{CATEGORIES.find(c => c.id === dest.category)?.label}</Label>
                              <Select value={dest.siteId} onValueChange={(val) => updateDest(dest.id, { siteId: val })}>
                                <SelectTrigger className="h-11">
                                  <SelectValue placeholder={`ค้นหา${CATEGORIES.find(c => c.id === dest.category)?.label}...`} />
                                </SelectTrigger>
                                <SelectContent>
                                  {sites?.filter(s => {
                                    const cat = CATEGORIES.find(c => c.id === dest.category);
                                    const matchesType = cat?.types.includes(s.projectTypeTag);
                                    const matchesSearch = s.name.toLowerCase().includes(dest.searchTerm.toLowerCase());
                                    return matchesType && matchesSearch;
                                  }).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>พิกัด (ดึงข้อมูลอัตโนมัติ)</Label>
                              <Input className="h-11 bg-muted/30" value={dest.coordinates} readOnly />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>ชื่อสถานที่</Label>
                            <Input 
                              placeholder="เช่น บริษัท TMT อยุธยา" 
                              className="h-11"
                              value={dest.customName}
                              onChange={(e) => updateDest(dest.id, { customName: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>พิกัด (lat, lng)</Label>
                              <Button 
                                type="button" 
                                variant="link" 
                                className="h-auto p-0 text-[10px] text-accent"
                                onClick={() => window.open('https://maps.google.com', '_blank')}
                              >
                                <ExternalLink className="mr-1 h-3 w-3" /> เปิด Google Maps
                              </Button>
                            </div>
                            <Input 
                              placeholder="14.0815, 100.7129" 
                              className="h-11"
                              value={dest.coordinates}
                              onChange={(e) => updateDest(dest.id, { coordinates: e.target.value })}
                            />
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label>ลักษณะงานที่ต้องทำ</Label>
                        <Input 
                          placeholder="รายละเอียดงาน เช่น ส่งอุปกรณ์ไฟฟ้า, รับตัวอย่างวัสดุ" 
                          className="h-11 bg-background/30"
                          value={dest.jobDescription}
                          onChange={(e) => updateDest(dest.id, { jobDescription: e.target.value })}
                        />
                      </div>

                      {dest.category === "custom" && (
                        <div className="space-y-4 pt-4 border-t border-border/30">
                          <div className="flex items-center space-x-2">
                            <Checkbox 
                              id={`save-site-${dest.id}`} 
                              checked={dest.saveAsSite}
                              onCheckedChange={(checked) => updateDest(dest.id, { saveAsSite: !!checked })}
                            />
                            <Label htmlFor={`save-site-${dest.id}`} className="text-sm font-bold text-accent cursor-pointer">
                              บันทึกสถานที่นี้เพื่อใช้ครั้งต่อไป
                            </Label>
                          </div>

                          {dest.saveAsSite && (
                            <div className="space-y-2 animate-in slide-in-from-top-1">
                              <Label>ประเภทสถานที่</Label>
                              <Select 
                                value={dest.locationType} 
                                onValueChange={(val) => updateDest(dest.id, { locationType: val })}
                              >
                                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ไซน์งาน">ไซน์งาน</SelectItem>
                                  <SelectItem value="ร้านค้า / ซัพพลายเออร์">ร้านค้า / ซัพพลายเออร์</SelectItem>
                                  <SelectItem value="ธนาคาร">ธนาคาร</SelectItem>
                                  <SelectItem value="บริษัท / หน่วยงานราชการ">บริษัท / หน่วยงานราชการ</SelectItem>
                                  <SelectItem value="อื่น ๆ">อื่น ๆ</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">หมายเหตุเพิ่มเติม</Label>
              <Textarea 
                id="note"
                placeholder="ข้อมูลเพิ่มเติมสำหรับคนจัดรถ เช่น ต้องใช้รถ 4 ล้อเท่านั้น, ต้องมีคนช่วยยกของ" 
                className="min-h-[100px] bg-background/30"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full h-12 bg-accent hover:bg-accent/90 shadow-lg shadow-accent/20" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              ส่งคำขอรถ
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
