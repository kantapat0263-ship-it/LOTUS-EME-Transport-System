"use client"

import * as React from "react"
import { 
  Plus, 
  MapPin, 
  Navigation, 
  Trash2, 
  GripVertical, 
  Sparkles,
  Truck,
  User,
  Calendar as CalendarIcon,
  Search,
  Route as RouteIcon
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { intelligentCargoDescriptionAssistant } from "@/ai/flows/cargo-description-assistant-flow"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const MOCK_VEHICLES = [
  { id: 'v1', plate: '1กก 1234', type: 'Pickup', capacity: 1500 },
  { id: 'v2', plate: 'ผห 5678', type: '4-wheel truck', capacity: 3500 },
  { id: 'v3', plate: '7กก 9012', type: '6-wheel truck', capacity: 7000 },
]

const MOCK_DRIVERS = [
  { id: 'd1', name: 'นายสมชาย รักดี', phone: '081-234-5678' },
  { id: 'd2', name: 'นายวิชัย ใจตรง', phone: '089-876-5432' },
]

const MOCK_SITES = [
  { id: 's1', name: 'โครงการ ABC สุขุมวิท 50' },
  { id: 's2', name: 'อาคารสำนักงาน XYZ บางนา' },
  { id: 's3', name: 'The Base Park West' },
]

export default function TripPlanPage() {
  const { toast } = useToast()
  const [stops, setStops] = React.useState([
    { id: '1', siteId: '', cargo: '' }
  ])
  const [isLoadingAi, setIsLoadingAi] = React.useState<string | null>(null)

  const addStop = () => {
    if (stops.length < 10) {
      setStops([...stops, { id: Date.now().toString(), siteId: '', cargo: '' }])
    } else {
      toast({
        title: "จำกัดจำนวนจุดจอด",
        description: "สามารถระบุจุดจอดได้สูงสุด 10 จุดต่อหนึ่งเที่ยววิ่ง",
        variant: "destructive"
      })
    }
  }

  const removeStop = (id: string) => {
    if (stops.length > 1) {
      setStops(stops.filter(s => s.id !== id))
    }
  }

  const updateStop = (id: string, field: string, value: string) => {
    setStops(stops.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  const handleAiDescription = async (stopId: string, currentDescription: string) => {
    if (!currentDescription) {
      toast({
        title: "กรุณาระบุคำอธิบายเบื้องต้น",
        description: "ตัวอย่าง: อุปกรณ์ประปาสำหรับโครงการ ABC",
        variant: "destructive"
      })
      return
    }

    setIsLoadingAi(stopId)
    try {
      const result = await intelligentCargoDescriptionAssistant({ 
        highLevelDescription: currentDescription 
      })
      updateStop(stopId, 'cargo', result.detailedDescription)
    } catch (error) {
      toast({
        title: "AI Error",
        description: "ไม่สามารถสร้างรายการสินค้าได้ในขณะนี้",
        variant: "destructive"
      })
    } finally {
      setIsLoadingAi(null)
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-160px)] animate-in slide-in-from-bottom-4 duration-700">
      {/* Left Panel: Configuration */}
      <div className="w-full lg:w-1/2 flex flex-col gap-6 overflow-y-auto pr-2">
        <Card className="border-accent/20">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <RouteIcon className="text-accent" /> ข้อมูลทั่วไปของเที่ยววิ่ง
            </CardTitle>
            <CardDescription>ระบุยานพาหนะ คนขับ และวันที่ต้องการส่งของ</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground" /> รถขนส่ง
                </label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกยพาหนะ" />
                  </SelectTrigger>
                  <SelectContent>
                    {MOCK_VEHICLES.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.plate} ({v.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" /> คนขับรถ
                </label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกคนขับ" />
                  </SelectTrigger>
                  <SelectContent>
                    {MOCK_DRIVERS.map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-muted-foreground" /> วันที่ส่งของ
                </label>
                <Input type="date" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" /> จุดเริ่มต้น
                </label>
                <Select defaultValue="warehouse">
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกจุดเริ่มต้น" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warehouse">คลังสินค้า LOTUS EME (สำนักงานใหญ่)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Navigation className="text-accent" /> ลำดับจุดส่งของ ({stops.length}/10)
            </h3>
            <Button variant="outline" size="sm" onClick={addStop}>
              <Plus className="mr-2 h-4 w-4" /> เพิ่มจุดส่ง
            </Button>
          </div>

          <div className="space-y-4">
            {stops.map((stop, index) => (
              <Card key={stop.id} className="relative group overflow-hidden border-l-4 border-l-primary">
                <CardContent className="p-4 flex gap-4">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <GripVertical className="h-5 w-5 cursor-grab" />
                    <span className="text-xs font-bold mt-2 bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center">
                      {index + 1}
                    </span>
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <Select value={stop.siteId} onValueChange={(val) => updateStop(stop.id, 'siteId', val)}>
                          <SelectTrigger>
                            <SelectValue placeholder="เลือกไซน์งานปลายทาง" />
                          </SelectTrigger>
                          <SelectContent>
                            {MOCK_SITES.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeStop(stop.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="relative">
                      <Textarea 
                        placeholder="รายละเอียดของที่ส่ง (เช่น สายไฟ 3 ม้วน, ท่อ PVC 50 เมตร)"
                        className="min-h-[80px] resize-none pr-10"
                        value={stop.cargo}
                        onChange={(e) => updateStop(stop.id, 'cargo', e.target.value)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-2 bottom-2 text-accent hover:bg-accent/10"
                        title="AI ช่วยสร้างรายการสินค้า"
                        onClick={() => handleAiDescription(stop.id, stop.cargo)}
                        disabled={isLoadingAi === stop.id}
                      >
                        <Sparkles className={cn("h-4 w-4", isLoadingAi === stop.id && "animate-pulse")} />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="flex gap-4 pt-4 sticky bottom-0 bg-background/80 backdrop-blur pb-4">
          <Button className="flex-1 bg-accent hover:bg-accent/90">บันทึกแผนเที่ยววิ่ง</Button>
          <Button variant="outline" className="flex-1">พิมพ์ใบงานขนส่ง</Button>
        </div>
      </div>

      {/* Right Panel: Interactive Map */}
      <div className="w-full lg:w-1/2 relative rounded-xl overflow-hidden border border-border shadow-2xl bg-card">
        <div className="absolute top-4 left-4 z-10 space-y-2">
          <div className="bg-background/90 backdrop-blur p-3 rounded-lg border shadow-lg max-w-xs">
            <h4 className="text-sm font-bold text-accent mb-2">สรุปเส้นทาง</h4>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span>ระยะทางรวม:</span>
                <span className="font-bold text-primary-foreground">24.5 กม.</span>
              </div>
              <div className="flex justify-between">
                <span>เวลาเดินทางรวม:</span>
                <span className="font-bold text-primary-foreground">1 ชม. 15 นาที</span>
              </div>
            </div>
            <Button size="sm" className="w-full mt-3 h-8 text-xs bg-primary hover:bg-primary/90">
              <Navigation className="mr-2 h-3 w-3" /> Auto-Optimize Route
            </Button>
          </div>
        </div>

        <div className="map-container flex items-center justify-center bg-muted/20 relative">
          {/* Placeholder for Google Map */}
          <div className="absolute inset-0 flex items-center justify-center flex-col text-muted-foreground p-8 text-center">
            <MapPin className="h-12 w-12 mb-4 animate-bounce" />
            <p className="text-lg font-medium">Google Maps Interface</p>
            <p className="text-sm opacity-70">เส้นทางจะปรากฏที่นี่เมื่อคุณเลือกจุดส่งของ</p>
            <div className="mt-8 grid grid-cols-2 gap-4 w-full max-w-sm">
              <div className="p-4 rounded-lg bg-background/50 border flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold">W</div>
                <div className="text-left text-xs">Warehouse</div>
              </div>
              <div className="p-4 rounded-lg bg-background/50 border flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">1</div>
                <div className="text-left text-xs">Site Destination</div>
              </div>
            </div>
          </div>
          
          <div className="absolute bottom-4 right-4 z-10">
            <Badge variant="outline" className="bg-background/95 backdrop-blur px-3 py-1 text-xs">
              Live Map Preview
            </Badge>
          </div>
        </div>
      </div>
    </div>
  )
}
