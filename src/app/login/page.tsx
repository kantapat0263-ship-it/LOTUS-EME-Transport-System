"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useAuth, useFirestore, useUser } from "@/firebase"
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile 
} from "firebase/auth"
import { doc, setDoc, serverTimestamp, getDoc, updateDoc } from "firebase/firestore"
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

  const ADMIN_EMAIL = "ownchang@hotmail.com"

  React.useEffect(() => {
    if (!isUserLoading && user) {
      router.push("/dashboard")
    }
  }, [user, isUserLoading, router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password)
      const loggedUser = userCredential.user
      
      const userRef = doc(db, "users", loggedUser.uid)
      const userDoc = await getDoc(userRef)
      
      if (loggedUser.email === ADMIN_EMAIL) {
        if (userDoc.exists()) {
          await updateDoc(userRef, {
            role: "admin",
            active: true,
            updatedAt: serverTimestamp()
          })
        } else {
          await setDoc(userRef, {
            id: loggedUser.uid,
            email: loggedUser.email,
            name: loggedUser.displayName || "Admin",
            role: "admin",
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          })
        }
      } else {
        if (userDoc.exists() && userDoc.data().active === false) {
          await auth.signOut()
          toast({ 
            title: "เข้าสู่ระบบไม่สำเร็จ", 
            description: "บัญชีของคุณถูกระงับ กรุณาติดต่อ Admin", 
            variant: "destructive" 
          })
          setIsLoading(false)
          return
        }
        
        if (!userDoc.exists()) {
          await setDoc(userRef, {
            id: loggedUser.uid,
            email: loggedUser.email,
            name: loggedUser.displayName || "User",
            role: "viewer",
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          })
        }
      }

      toast({ title: "เข้าสู่ระบบสำเร็จ", description: "กำลังนำคุณไปยังหน้าแดชบอร์ด" })
      router.push("/dashboard")
    } catch (error: any) {
      toast({ 
        title: "เข้าสู่ระบบไม่สำเร็จ", 
        description: "กรุณาตรวจสอบอีเมลและรหัสผ่าน", 
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
      
      await updateProfile(newUser, { displayName: name })
      
      const role = email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "admin" : "viewer"
      
      await setDoc(doc(db, "users", newUser.uid), {
        id: newUser.uid,
        email: newUser.email,
        name: name,
        role: role,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })

      toast({ title: "ลงทะเบียนสำเร็จ", description: `สร้างบัญชีผู้ใช้งานบทบาท ${role} เรียบร้อยแล้ว` })
      router.push("/dashboard")
    } catch (error: any) {
      let errorMessage = "เกิดข้อผิดพลาดในการลงทะเบียน"
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "อีเมลนี้มีผู้ใช้งานแล้วในระบบ"
      } else if (error.code === 'auth/weak-password') {
        errorMessage = "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร"
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = "รูปแบบอีเมลไม่ถูกต้อง"
      }

      toast({ 
        title: "ลงทะเบียนไม่สำเร็จ", 
        description: errorMessage, 
        variant: "destructive" 
      })
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
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#1A1C23] px-4 py-8">
      <div className="w-full max-w-md space-y-6 md:space-y-8">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="bg-primary p-3 rounded-2xl">
              <Truck className="h-10 w-10 md:h-12 md:w-12 text-accent" />
            </div>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">LOTUS GROUP</h1>
          <p className="text-sm md:text-base text-muted-foreground">ระบบจัดการขนส่งและวัสดุก่อสร้าง</p>
        </div>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-secondary/50 h-11 md:h-10">
            <TabsTrigger value="login" className="text-xs md:text-sm">เข้าสู่ระบบ</TabsTrigger>
            <TabsTrigger value="signup" className="text-xs md:text-sm">สมัครสมาชิก</TabsTrigger>
          </TabsList>
          
          <TabsContent value="login" className="mt-4">
            <Card className="border-border/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">เข้าสู่ระบบ</CardTitle>
                <CardDescription className="text-xs">ระบุอีเมลและรหัสผ่านเพื่อเข้าใช้งาน</CardDescription>
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
                      className="h-11"
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
                      className="h-11"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full bg-accent hover:bg-accent/90 h-12" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} เข้าสู่ระบบ
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="signup" className="mt-4">
            <Card className="border-border/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">สมัครสมาชิกใหม่</CardTitle>
                <CardDescription className="text-xs">สร้างบัญชีเพื่อเริ่มต้นใช้งาน</CardDescription>
              </CardHeader>
              <form onSubmit={handleSignUp}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">ชื่อ-นามสกุล</Label>
                    <Input 
                      id="signup-name" 
                      placeholder="สมชาย ใจดี" 
                      required 
                      className="h-11"
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
                      className="h-11"
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
                      className="h-11"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full bg-primary hover:bg-primary/90 h-12" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} สร้างบัญชีผู้ใช้
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="text-center">
          <p className="text-[10px] md:text-xs text-muted-foreground flex items-center justify-center gap-1">
            <ShieldCheck className="h-3 w-3" /> ข้อมูลของคุณถูกรักษาอย่างปลอดภัยด้วย Firebase Auth
          </p>
        </div>
      </div>
    </div>
  )
}
