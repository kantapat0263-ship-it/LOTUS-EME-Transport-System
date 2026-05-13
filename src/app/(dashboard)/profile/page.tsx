
"use client"

import * as React from "react"
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase"
import { doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { User, Phone, Mail, Save, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { UserProfile } from "@/types/models"

export default function ProfilePage() {
  const { user } = useUser()
  const db = useFirestore()
  const { toast } = useToast()
  
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading } = useDoc<UserProfile>(userProfileRef)

  const [formData, setFormData] = React.useState({
    name: "",
    phone: ""
  })
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name || "",
        phone: (profile as any).phone || ""
      })
    }
  }, [profile])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    setIsSaving(true)
    try {
      await updateDoc(doc(db, "users", user.uid), {
        name: formData.name,
        phone: formData.phone,
        updatedAt: serverTimestamp()
      })
      toast({ title: "บันทึกสำเร็จ", description: "อัปเดตข้อมูลส่วนตัวเรียบร้อยแล้ว" })
    } catch (error) {
      toast({ title: "เกิดข้อผิดพลาด", description: "ไม่สามารถบันทึกข้อมูลได้", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-accent" /></div>
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">ข้อมูลส่วนตัว</h2>
        <p className="text-muted-foreground">จัดการข้อมูลติดต่อของคุณสำหรับใช้ในใบงานขนส่ง</p>
      </div>

      <Card className="border-accent/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-accent" /> ข้อมูลสมาชิก
          </CardTitle>
          <CardDescription>เบอร์โทรศัพท์จะถูกนำไปแสดงในใบงานเพื่อให้คนขับติดต่อประสานงานได้</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">ชื่อ-นามสกุล</Label>
                <Input 
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="กรอกชื่อและนามสกุลจริง"
                  className="h-11"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">เบอร์โทรศัพท์ที่ติดต่อได้</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    placeholder="เช่น 081-XXX-XXXX"
                    className="h-11 pl-10"
                    required
                  />
                </div>
                <p className="text-[10px] text-muted-foreground italic">* เบอร์นี้จะแสดงในใบงานขนส่งเพื่อให้คนขับติดต่อเมื่อถึงที่หมาย</p>
              </div>

              <div className="space-y-2 opacity-60">
                <Label htmlFor="email">อีเมล (ไม่สามารถแก้ไขได้)</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    id="email"
                    value={user?.email || ""}
                    className="h-11 pl-10 bg-secondary/50"
                    disabled
                  />
                </div>
              </div>
            </div>

            <Button type="submit" className="w-full h-12 bg-accent hover:bg-accent/90" disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              บันทึกข้อมูลส่วนตัว
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
