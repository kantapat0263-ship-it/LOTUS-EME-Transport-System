"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Map, Save, Loader2, Building2, Fuel, Clock, Timer, Database, Download, Upload, AlertTriangle } from "lucide-react"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { doc, serverTimestamp, collection, getDocs, setDoc } from "firebase/firestore"
import { setDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { useToast } from "@/hooks/use-toast"
import { CompanySetting } from "@/types/models"
import { format } from "date-fns"
import { th } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"

export default function SettingsPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const { user } = useUser()
  
  const settingRef = useMemoFirebase(() => doc(db, "companySettings", "default"), [db])
  const { data: settings, isLoading } = useDoc<CompanySetting>(settingRef)

  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile } = useDoc<any>(userProfileRef)
  
  const isAdmin = profile?.role === 'admin'
  
  const [isSaving, setIsSaving] = React.useState(false)
  const [isBackingUp, setIsBackingUp] = React.useState(false)
  const [isRestoring, setIsRestoring] = React.useState(false)

  const [formData, setFormData] = React.useState({
    companyName: "LOTUS GROUP",
    warehouseName: "คลังสินค้าหลัก LOTUS GROUP",
    warehouseAddress: "14.094126450195006, 100.6893810570115",
    googleMapsApiKeyReference: "",
    dieselPrice: 32.50,
    defaultFuelRate: 10,
    requestOpenTime: "08:00",
    requestCloseTime: "17:00"
  })

  React.useEffect(() => {
    if (settings) {
      setFormData({
        companyName: settings.companyName || "LOTUS GROUP",
        warehouseName: settings.warehouseName || "คลังสินค้าหลัก LOTUS GROUP",
        warehouseAddress: settings.warehouseAddress || "14.094126450195006, 100.6893810570115",
        googleMapsApiKeyReference: settings.googleMapsApiKeyReference || "",
        dieselPrice: settings.dieselPrice || 32.50,
        defaultFuelRate: settings.defaultFuelRate || 10,
        requestOpenTime: (settings as any).requestOpenTime || "08:00",
        requestCloseTime: (settings as any).requestCloseTime || "17:00"
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

  const handleBackup = async () => {
    if (!isAdmin || !user) return
    setIsBackingUp(true)
    try {
      const collectionsToBackup = ['users', 'sites', 'drivers', 'vehicles', 'companySettings']
      const backupData: Record<string, any[]> = {}

      for (const colName of collectionsToBackup) {
        const snapshot = await getDocs(collection(db, colName))
        backupData[colName] = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data()
        }))
      }

      const backup = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        exportedBy: user.email,
        data: backupData
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const date = format(new Date(), "dd-MM-yyyy")
      link.download = `LOTUS-backup-${date}.json`
      link.href = url
      link.click()
      URL.revokeObjectURL(url)
      toast({ title: "Backup สำเร็จ", description: "ไฟล์สำรองข้อมูลถูกดาวน์โหลดแล้ว" })
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถ Backup ข้อมูลได้", variant: "destructive" })
    } finally {
      setIsBackingUp(false)
    }
  }

  const handleRestore = async (file: File) => {
    if (!isAdmin) return
    if (!confirm('⚠️ การ Restore จะเขียนทับข้อมูลที่มีอยู่ (Merge) ต้องการดำเนินการต่อไหม?')) return
    
    setIsRestoring(true)
    try {
      const text = await file.text()
      const backup = JSON.parse(text)

      if (!backup.version || !backup.data) {
        toast({ title: "ไฟล์ไม่ถูกต้อง", description: "โครงสร้างข้อมูล Backup ไม่ถูกต้อง", variant: "destructive" })
        return
      }

      for (const [colName, docs] of Object.entries(backup.data)) {
        for (const docData of docs as any[]) {
          const { id, ...data } = docData
          // Using setDoc to restore specific document IDs
          await setDoc(doc(db, colName, id), data, { merge: true })
        }
      }

      toast({ 
        title: "Restore สำเร็จ", 
        description: `นำเข้าข้อมูลจากวันที่ ${format(new Date(backup.exportedAt), "dd/MM/yyyy HH:mm")}` 
      })
    } catch (error) {
      console.error(error)
      toast({ title: "เกิดข้อผิดพลาด", description: "ไฟล์อาจไม่ถูกต้องหรือไม่มีสิทธิ์เข้าถึงฐานข้อมูล", variant: "destructive" })
    } finally {
      setIsRestoring(false)
    }
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

        <Card className="border-accent/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-accent" /> ตั้งค่าเวลาส่งคำขอรถ
            </CardTitle>
            <CardDescription>กำหนดช่วงเวลาที่พนักงาน (Viewer) สามารถส่งใบขอใช้รถได้</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="requestOpenTime">เวลาเปิดรับคำขอรถ</Label>
                <Input 
                  id="requestOpenTime" 
                  type="time"
                  value={formData.requestOpenTime}
                  onChange={(e) => setFormData({...formData, requestOpenTime: e.target.value})}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="requestCloseTime">เวลาปิดรับคำขอรถ</Label>
                <Input 
                  id="requestCloseTime" 
                  type="time"
                  value={formData.requestCloseTime}
                  onChange={(e) => setFormData({...formData, requestCloseTime: e.target.value})}
                  className="h-11"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground italic">
              * ผู้ดูแลระบบ (Admin/Dispatcher) จะไม่ถูกจำกัดโดยช่วงเวลานี้
            </p>
          </CardContent>
        </Card>

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

        {/* Backup & Restore Section - Admin Only */}
        {isAdmin && (
          <Card className="border-blue-500/20 bg-blue-500/5 mt-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-400">
                <Database className="h-5 w-5" /> สำรองและกู้คืนข้อมูล (Admin Only)
              </CardTitle>
              <CardDescription>
                สำรองข้อมูลหลัก: ผู้ใช้, ไซต์งาน, คนขับ, ทะเบียนรถ และตั้งค่าระบบ
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  variant="outline" 
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white border-transparent h-11"
                  onClick={handleBackup}
                  disabled={isBackingUp}
                >
                  {isBackingUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  {isBackingUp ? "กำลังสำรองข้อมูล..." : "Backup ข้อมูลหลัก"}
                </Button>

                <div className="flex-1">
                  <Label htmlFor="restore-upload" className="cursor-pointer">
                    <div className={cn(
                      "flex items-center justify-center gap-2 h-11 px-4 rounded-md border border-orange-500/50 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-all font-medium text-sm",
                      isRestoring && "opacity-50 pointer-events-none"
                    )}>
                      {isRestoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {isRestoring ? "กำลังกู้คืนข้อมูล..." : "Restore จากไฟล์ JSON"}
                    </div>
                  </Label>
                  <input 
                    id="restore-upload" 
                    type="file" 
                    accept=".json" 
                    className="hidden" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleRestore(file);
                    }}
                  />
                </div>
              </div>
              
              <Alert variant="destructive" className="bg-red-500/5 border-red-500/20 text-red-400">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-xs font-bold uppercase tracking-wider">คำเตือนด้านความปลอดภัย</AlertTitle>
                <AlertDescription className="text-[11px] leading-relaxed">
                  การ Restore ข้อมูลจะทำการเขียนทับข้อมูลเดิมที่มีอยู่ในฐานข้อมูล (Merge) กรุณาตรวจสอบไฟล์ให้แน่ใจก่อนดำเนินการ และควร Backup ข้อมูลปัจจุบันไว้เสมอ
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
