
"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Map, Save, Loader2, Building2, MapPin } from "lucide-react"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { doc, serverTimestamp } from "firebase/firestore"
import { setDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useToast } from "@/hooks/use-toast"

export default function SettingsPage() {
  const { toast } = useToast()
  const db = useFirestore()
  
  const settingRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: settings, isLoading } = useDoc(settingRef)
  
  const [isSaving, setIsSaving] = React.useState(false)
  const [formData, setFormData] = React.useState({
    companyName: "LOTUS EME",
    warehouseName: "คลังสินค้าหลัก",
    warehouseAddress: "",
    googleMapsApiKeyReference: ""
  })

  React.useEffect(() => {
    if (settings) {
      setFormData({
        companyName: settings.companyName || "LOTUS EME",
        warehouseName: settings.warehouseName || "คลังสินค้าหลัก",
        warehouseAddress: settings.warehouseAddress || "",
        googleMapsApiKeyReference: settings.googleMapsApiKeyReference || ""
      })
    }
  }, [settings])

  const handleSave = () => {
    setIsSaving(true)
    setDocumentNonBlocking(settingRef, {
      ...formData,
      id: "default",
      updatedAt: serverTimestamp(),
    }, { merge: true })
    
    setTimeout(() => {
      setIsSaving(false)
      toast({ title: "สำเร็จ", description: "บันทึกการตั้งค่าเรียบร้อยแล้ว" })
    }, 500)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">ตั้งค่าระบบ</h2>
        <p className="text-muted-foreground">จัดการข้อมูลบริษัทและกุญแจเชื่อมต่อบริการภายนอก</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-accent" /> ข้อมูลองค์กร
            </CardTitle>
            <CardDescription>ข้อมูลพื้นฐานสำหรับระบุในใบงานขนส่ง</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="companyName">ชื่อบริษัท</Label>
                <Input 
                  id="companyName" 
                  value={formData.companyName}
                  onChange={(e) => setFormData({...formData, companyName: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="warehouseName">ชื่อคลังสินค้า/สำนักงาน</Label>
                <Input 
                  id="warehouseName" 
                  value={formData.warehouseName}
                  onChange={(e) => setFormData({...formData, warehouseName: e.target.value})}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="warehouseAddress">ที่อยู่คลังสินค้า (จุดเริ่มต้นการเดินทาง)</Label>
              <Input 
                id="warehouseAddress" 
                placeholder="ระบุที่อยู่หรือพิกัด..."
                value={formData.warehouseAddress}
                onChange={(e) => setFormData({...formData, warehouseAddress: e.target.value})}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-accent/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Map className="h-5 w-5 text-accent" /> Google Maps API
            </CardTitle>
            <CardDescription>
              ใช้สำหรับการแสดงแผนที่แบบโต้ตอบ การคำนวณระยะทาง และการหาเส้นทางที่ดีที่สุด
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">Google Maps API Key</Label>
              <Input 
                id="apiKey" 
                type="password"
                placeholder="AIza..." 
                value={formData.googleMapsApiKeyReference}
                onChange={(e) => setFormData({...formData, googleMapsApiKeyReference: e.target.value})}
              />
              <p className="text-[10px] text-muted-foreground">
                * หากไม่มีคีย์นี้ ระบบจะแสดงผลแผนที่แบบจำลอง (Placeholder) เท่านั้น
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button 
            className="bg-accent hover:bg-accent/90 w-full md:w-auto" 
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            บันทึกการตั้งค่า
          </Button>
        </div>
      </div>
    </div>
  )
}
