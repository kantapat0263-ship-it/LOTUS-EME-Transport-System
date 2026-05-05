
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useAuth, useFirestore, useUser } from "@/firebase"
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInAnonymously,
  updateProfile 
} from "firebase/auth"
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { Loader2, Truck, ShieldCheck } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const auth = useAuth()
  const db = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  
  const [isLoading, setIsLoading] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [name, setName] = React.useState("")

  // Redirect if already logged in
  React.useEffect(() => {
    if (!isUserLoading && user) {
      router.push("/dashboard")
    }
  }, [user, isUserLoading, router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      toast({ title: "เข้าสู่ระบบสำเร็จ", description: "กำลังนำคุณไปยังหน้าแดชบอร์ด" })
      router.push("/dashboard")
    } catch (error: any) {
      toast({ 
        title: "เข้าสู่ระบบไม่สำเร็จ", 
        description: error.message || "กรุณาตรวจสอบอีเมลและรหัสผ่าน", 
        variant: "destructive" 
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password)
      const newUser = userCredential.user
      
      // Update Auth Profile
      await updateProfile(newUser, { displayName: name })
      
      // Create User Profile in Firestore
      await setDoc(doc(db, "userProfiles", newUser.uid), {
        id: newUser.uid,
        email: newUser.email,
        name: name,
        role: "Admin", // Default role for prototype
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })

      toast({ title: "ลงทะเบียนสำเร็จ", description: "สร้างบัญชีผู้ใช้งานเรียบร้อยแล้ว" })
      router.push("/dashboard")
    } catch (error: any) {
      toast({ 
        title: "ลงทะเบียนไม่สำเร็จ", 
        description: error.message, 
        variant: "destructive" 
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleAnonymousLogin = async () => {
    setIsLoading(true)
    try {
      const userCredential = await signInAnonymously(auth)
      const anonUser = userCredential.user
      
      // Check if profile exists, if not create one
      const profileRef = doc(db, "userProfiles", anonUser.uid)
      const profileSnap = await getDoc(profileRef)
      
      if (!profileSnap.exists()) {
        await setDoc(profileRef, {
          id: anonUser.uid,
          email: "anonymous@lotuseme.com",
          name: "Anonymous User",
          role: "Viewer",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      }
      
      router.push("/dashboard")
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  if (isUserLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#1A1C23] px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="bg-primary p-3 rounded-2xl">
              <Truck className="h-10 w-10 text-accent" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">LOTUS EME</h1>
          <p className="text-muted-foreground">ระบบจัดการขนส่งและวัสดุก่อสร้าง</p>
        </div>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-secondary/50">
            <TabsTrigger value="login">เข้าสู่ระบบ</TabsTrigger>
            <TabsTrigger value="signup">สมัครสมาชิก</TabsTrigger>
          </TabsList>
          
          <TabsContent value="login">
            <Card>
              <CardHeader>
                <CardTitle>เข้าสู่ระบบ</CardTitle>
                <CardDescription>ระบุอีเมลและรหัสผ่านเพื่อเข้าใช้งานระบบ</CardDescription>
              </CardHeader>
              <form onSubmit={handleLogin}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">อีเมล</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="name@example.com" 
                      required 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">รหัสผ่าน</Label>
                    <Input 
                      id="password" 
                      type="password" 
                      required 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-4">
                  <Button type="submit" className="w-full bg-accent hover:bg-accent/90" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} เข้าสู่ระบบ
                  </Button>
                  <div className="relative w-full">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-muted" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">หรือ</span>
                    </div>
                  </div>
                  <Button variant="outline" type="button" className="w-full" onClick={handleAnonymousLogin} disabled={isLoading}>
                    เข้าใช้งานแบบทดลอง (Anonymous)
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="signup">
            <Card>
              <CardHeader>
                <CardTitle>สมัครสมาชิกใหม่</CardTitle>
                <CardDescription>สร้างบัญชีเพื่อเริ่มต้นจัดการระบบขนส่ง</CardDescription>
              </CardHeader>
              <form onSubmit={handleSignUp}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">ชื่อ-นามสกุล</Label>
                    <Input 
                      id="signup-name" 
                      placeholder="สมชาย ใจดี" 
                      required 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">อีเมล</Label>
                    <Input 
                      id="signup-email" 
                      type="email" 
                      placeholder="name@example.com" 
                      required 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">รหัสผ่าน</Label>
                    <Input 
                      id="signup-password" 
                      type="password" 
                      required 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} สร้างบัญชีผู้ใช้
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="text-center">
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
            <ShieldCheck className="h-3 w-3" /> ข้อมูลของคุณถูกรักษาอย่างปลอดภัยด้วย Firebase Auth
          </p>
        </div>
      </div>
    </div>
  )
}
