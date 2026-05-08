
"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Map, Save, Loader2, Building2, Fuel, Clock } from "lucide-react"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { doc, serverTimestamp } from "firebase/firestore"
import { setDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useToast } from "@/hooks/use-toast"
import { CompanySetting } from "@/types/models"
import { format } from "date-fns"
import { th } from "date-fns/locale"

export default function SettingsPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()
  
  const settingRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: settings, isLoading } = useDoc<CompanySetting>(settingRef)
  
  const [isSaving, setIsSaving] = React.useState(false)
  const [formData, setFormData] = React.useState({
    companyName: "LOTUS GROUP",
    warehouseName: "คลังสินค้าหลัก LOTUS GROUP",
    warehouseAddress: "14.094126450195006, 100.6893810570115",
    googleMapsApiKeyReference: "",
    dieselPrice: 32.50,
    defaultFuelRate: 10
  })

  React.useEffect(() => {
    if (settings) {
      setFormData({
        companyName: settings.companyName || "LOTUS GROUP",
        warehouseName: settings.warehouseName || "คลังสินค้าหลัก LOTUS GROUP",
        warehouseAddress: settings.warehouseAddress || "14.094126450195006, 100.6893810570115",
        googleMapsApiKeyReference: settings.googleMapsApiKeyReference || "",
        dieselPrice: settings.dieselPrice || 32.50,
        defaultFuelRate: settings.defaultFuelRate || 10
      })
    }
  }, [settings])

  const handleSave = () => {
    setIsSaving(true)
    
    const [lat, lng] = formData.warehouseAddress.split(',').map(s => parseFloat(s.trim()))

    const updateData: any = {
      ...formData,
      id: "default",
      warehouseLatitude: isNaN(lat) ? 14.094126450195006 : lat,
      warehouseLongitude: isNaN(lng) ? 100.6893810570115 : lng,
      updatedAt: serverTimestamp(),
    }

    // Detect if fuel settings changed
    const fuelChanged = settings?.dieselPrice !== formData.dieselPrice || settings?.defaultFuelRate !== formData.defaultFuelRate;
    if (fuelChanged) {
      updateData.fuelSettingsUpdatedAt = serverTimestamp();
      updateData.fuelSettingsUpdatedBy = user?.email || "Unknown";
    }

    setDocumentNonBlocking(settingRef, updateData, { merge: true })
    
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
              <Label htmlFor="warehouseAddress">พิกัดคลังสินค้า (lat, lng)</Label>
              <Input 
                id="warehouseAddress" 
                placeholder="เช่น 14.094126, 100.689381"
                value={formData.warehouseAddress}
                onChange={(e) => setFormData({...formData, warehouseAddress: e.target.value})}
              />
              <p className="text-[10px] text-muted-foreground">
                * พิกัดจุดเริ่มต้นถูกกำหนดไว้ที่: 14.094126450195006, 100.6893810570115 (สำนักงาน LOTUS)
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Fuel Settings Section */}
        <Card className="border-accent/20">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Fuel className="h-5 w-5 text-accent" /> ตั้งค่าน้ำมัน
                </CardTitle>
                <CardDescription>ใช้สำหรับการคำนวณค่าน้ำมันในระบบจัดการเที่ยววิ่ง</CardDescription>
              </div>
              {settings?.fuelSettingsUpdatedAt && (
                <div className="text-right text-[10px] text-muted-foreground space-y-1">
                  <p className="flex items-center gap-1 justify-end"><Clock className="h-3 w-3" /> อัปเดตล่าสุด: {format(settings.fuelSettingsUpdatedAt.toDate(), "dd/MM/yyyy HH:mm", { locale: th })}</p>
                  <p>โดย: {settings.fuelSettingsUpdatedBy}</p>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dieselPrice">ราคาดีเซลปัจจุบัน (บาท/ลิตร)</Label>
                <Input 
                  id="dieselPrice" 
                  type="number"
                  step="0.01"
                  value={formData.dieselPrice}
                  onChange={(e) => setFormData({...formData, dieselPrice: parseFloat(e.target.value) || 0})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultFuelRate">อัตราสิ้นเปลืองมาตรฐาน (กม./ลิตร)</Label>
                <Input 
                  id="defaultFuelRate" 
                  type="number"
                  step="0.1"
                  value={formData.defaultFuelRate}
                  onChange={(e) => setFormData({...formData, defaultFuelRate: parseFloat(e.target.value) || 0})}
                />
              </div>
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
