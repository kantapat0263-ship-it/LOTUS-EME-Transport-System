
"use client"

import * as React from "react"
import { useFirestore, useCollection, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore"
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
  Globe
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Site, UserProfile } from "@/types/models"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"

interface DestinationRequest {
  id: string;
  type: "site" | "other";
  siteId: string;
  siteName: string;
  customName: string;
  coordinates: string;
  jobDescription: string;
  saveAsSite: boolean;
  locationType: string;
}

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
    { id: "1", type: "site", siteId: "", siteName: "", customName: "", coordinates: "", jobDescription: "", saveAsSite: false, locationType: "ไซน์งาน" }
  ])

  const addDestination = () => {
    if (destinations.length >= 10) {
      toast({ title: "เต็มแล้ว", description: "เพิ่มจุดหมายได้สูงสุด 10 จุด", variant: "destructive" })
      return
    }
    setDestinations([...destinations, { 
      id: Date.now().toString(), 
      type: "site", 
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
      setDestinations(destinations.filter(d => d.id !== id))
    }
  }

  const updateDest = (id: string, field: keyof DestinationRequest, value: any) => {
    setDestinations(destinations.map(d => {
      if (d.id === id) {
        const updated = { ...d, [field]: value };
        if (field === "siteId" && d.type === "site") {
          const site = sites?.find(s => s.id === value);
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

  const toggleType = (id: string) => {
    setDestinations(destinations.map(d => 
      d.id === id ? { 
        ...d, 
        type: d.type === "site" ? "other" : "site",
        siteId: "",
        siteName: "",
        customName: "",
        coordinates: "",
        saveAsSite: false
      } : d
    ))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!requestedBy || !requestDate || !requestTime || !user) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อผู้ขอ วันที่ และเวลา", variant: "destructive" })
      return
    }

    const validDestinations = destinations.filter(d => 
      (d.type === "site" && d.siteId) || (d.type === "other" && d.customName && d.coordinates)
    )

    if (validDestinations.length === 0) {
      toast({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุจุดหมายอย่างน้อย 1 จุดพร้อมพิกัด", variant: "destructive" })
      return
    }

    setIsSubmitting(true)
    try {
      const requestId = `VR-${Math.floor(1000 + Math.random() * 9000)}`
      const requestRef = doc(db, "vehicleRequests", requestId)
      
      const parsedDestinations = []

      for (const d of validDestinations) {
        const [lat, lng] = d.coordinates.split(',').map(s => parseFloat(s.trim()))
        const latVal = isNaN(lat) ? 0 : lat
        const lngVal = isNaN(lng) ? 0 : lng
        const finalName = d.type === "site" ? d.siteName : d.customName

        parsedDestinations.push({
          type: d.type,
          siteId: d.siteId || null,
          siteName: finalName,
          customName: d.type === "other" ? d.customName : null,
          lat: latVal,
          lng: lngVal,
          jobDescription: d.jobDescription
        })

        // Handle "Save as site" feature
        if (d.type === "other" && d.saveAsSite && d.customName && d.coordinates) {
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
      
      // Reset form
      setRequestedBy(user?.displayName || "")
      setRequestDate(new Date().toISOString().split('T')[0])
      setRequestTime("08:30")
      setNote("")
      setDestinations([{ id: "1", type: "site", siteId: "", siteName: "", customName: "", coordinates: "", jobDescription: "", saveAsSite: false, locationType: "ไซน์งาน" }])
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
                        <div className="flex bg-background/50 p-1 rounded-md w-full sm:w-auto">
                          <Button 
                            type="button" 
                            variant={dest.type === "site" ? "default" : "ghost"} 
                            size="sm" 
                            className={cn("flex-1 sm:flex-none h-8 text-xs", dest.type === "site" && "bg-accent")}
                            onClick={() => dest.type !== "site" && toggleType(dest.id)}
                          >
                            <Building2 className="mr-2 h-3 w-3" /> ไซน์งาน / สถานที่ประจำ
                          </Button>
                          <Button 
                            type="button" 
                            variant={dest.type === "other" ? "default" : "ghost"} 
                            size="sm" 
                            className={cn("flex-1 sm:flex-none h-8 text-xs", dest.type === "other" && "bg-accent")}
                            onClick={() => dest.type !== "other" && toggleType(dest.id)}
                          >
                            <Globe className="mr-2 h-3 w-3" /> สถานที่ใหม่ (กำหนดเอง)
                          </Button>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive h-8 w-8 self-end sm:self-auto" onClick={() => removeDestination(dest.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {dest.type === "site" ? (
                          <div className="space-y-2">
                            <Label>เลือกสถานที่</Label>
                            <Select value={dest.siteId} onValueChange={(val) => updateDest(dest.id, "siteId", val)}>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder="ค้นหาไซน์งาน, ร้านค้า, ธนาคาร..." />
                              </SelectTrigger>
                              <SelectContent>
                                {sites?.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.projectTypeTag})</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <Label>ชื่อสถานที่</Label>
                            <Input 
                              placeholder="เช่น บริษัท TMT อยุธยา" 
                              className="h-11"
                              value={dest.customName}
                              onChange={(e) => updateDest(dest.id, "customName", e.target.value)}
                            />
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>พิกัด (lat, lng)</Label>
                            {dest.type === "other" && (
                              <Button 
                                type="button" 
                                variant="link" 
                                className="h-auto p-0 text-[10px] text-accent"
                                onClick={() => window.open('https://maps.google.com', '_blank')}
                              >
                                <ExternalLink className="mr-1 h-3 w-3" /> เปิด Google Maps
                              </Button>
                            )}
                          </div>
                          <Input 
                            placeholder="14.0815, 100.7129" 
                            className="h-11"
                            value={dest.coordinates}
                            onChange={(e) => updateDest(dest.id, "coordinates", e.target.value)}
                            readOnly={dest.type === "site"}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>ลักษณะงานที่ต้องทำ</Label>
                        <Textarea 
                          placeholder="รายละเอียดงาน เช่น ส่งอุปกรณ์ไฟฟ้า, รับตัวอย่างวัสดุ" 
                          className="min-h-[80px] bg-background/30"
                          value={dest.jobDescription}
                          onChange={(e) => updateDest(dest.id, "jobDescription", e.target.value)}
                        />
                      </div>

                      {dest.type === "other" && (
                        <div className="space-y-4 pt-4 border-t border-border/30">
                          <div className="flex items-center space-x-2">
                            <Checkbox 
                              id={`save-site-${dest.id}`} 
                              checked={dest.saveAsSite}
                              onCheckedChange={(checked) => updateDest(dest.id, "saveAsSite", checked)}
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
                                onValueChange={(val) => updateDest(dest.id, "locationType", val)}
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
