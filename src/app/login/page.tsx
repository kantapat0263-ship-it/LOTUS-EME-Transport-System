"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useAuth, useFirestore, useUser } from "@/firebase"
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile 
} from "firebase/auth"
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { Loader2, Truck, ShieldCheck, Eye, EyeOff } from "lucide-react"

/** ตรงกับ validProfileText ใน firestore.rules */
const PROFILE_NAME_MAX = 200
const PROFILE_PHONE_MAX = 50

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
  const [phone, setPhone] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)

  // ระหว่างกดเข้าสู่ระบบ/สมัคร (isLoading) ให้ handler ตรวจ/ตั้งโปรไฟล์ให้เสร็จแล้วพาไปเอง
  // — ไม่งั้น dashboard อาจเห็นโปรไฟล์เดิม (ไม่มี/ยังไม่ active) ก่อน handler เขียนโปรไฟล์เสร็จ แล้วพาออกจากระบบ
  React.useEffect(() => {
    if (!isUserLoading && user && !isLoading) {
      router.push("/dashboard")
    }
  }, [user, isUserLoading, isLoading, router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password)
      const loggedUser = userCredential.user
      
      const userRef = doc(db, "users", loggedUser.uid)
      const userDoc = await getDoc(userRef)
      
      // ไม่มีอีเมลไหนได้สิทธิ์แอดมินอัตโนมัติแล้ว (เดิมฝังอีเมลเจ้าของไว้ ใครเข้าอีเมลนั้นได้ = แอดมิน)
      // แอดมินเดิมยังเป็นแอดมินตามโปรไฟล์ · กู้สิทธิ์แอดมินทำที่ Firebase Console (users/{uid}) เท่านั้น
      if (userDoc.exists() && userDoc.data().active === false) {
        await auth.signOut()
        toast({
          title: "เข้าสู่ระบบไม่สำเร็จ",
          description: "บัญชีของคุณยังไม่ได้รับอนุมัติ หรือถูกระงับ กรุณาติดต่อ Admin",
          variant: "destructive"
        })
        setIsLoading(false)
        return
      }

      if (!userDoc.exists()) {
        // ไม่มีโปรไฟล์ (เช่น admin ลบออก / สร้างบัญชีนอกหน้าสมัคร) → สร้างเป็นบัญชีรออนุมัติเหมือนตอนสมัคร
        // (firestore.rules ไม่ให้สร้างโปรไฟล์ตัวเองแบบ active: true แล้ว)
        await setDoc(userRef, {
          id: loggedUser.uid,
          email: loggedUser.email,
          name: (loggedUser.displayName || "User").slice(0, PROFILE_NAME_MAX),
          role: "viewer",
          active: false,
          pending: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
        await auth.signOut()
        toast({
          title: "บัญชีรอการอนุมัติ",
          description: "กรุณารอ Admin อนุมัติก่อนเข้าใช้งาน"
        })
        setIsLoading(false)
        return
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
    // ตรวจก่อนสร้างบัญชี — rules รับชื่อ ≤ 200 / เบอร์ ≤ 50 ตัว ถ้าเกินจะได้บัญชีที่ไม่มีโปรไฟล์
    if (name.trim().length > PROFILE_NAME_MAX || phone.trim().length > PROFILE_PHONE_MAX) {
      toast({ title: "ข้อมูลยาวเกินไป", description: `ชื่อไม่เกิน ${PROFILE_NAME_MAX} ตัวอักษร และเบอร์ไม่เกิน ${PROFILE_PHONE_MAX} ตัวอักษร`, variant: "destructive" })
      return
    }
    setIsLoading(true)
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password)
      const newUser = userCredential.user

      await updateProfile(newUser, { displayName: name })

      await setDoc(doc(db, "users", newUser.uid), {
        id: newUser.uid,
        email: newUser.email,
        name: name,
        phone: phone || "",
        role: "viewer",
        // ผู้สมัครใหม่ทุกคนต้องรอ Admin อนุมัติก่อน (admin เปิดสวิตช์ Active ที่หน้าจัดการผู้ใช้)
        active: false,
        // pending = รออนุมัติ (ใช้ขึ้น badge เตือน admin)
        pending: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })

      // ออกจากระบบทันที กันไม่ให้เข้าใช้งานก่อนได้รับอนุมัติ (และกัน useEffect เด้งเข้า dashboard)
      await auth.signOut()
      toast({
        title: "สมัครสมาชิกสำเร็จ — รอการอนุมัติ",
        description: "บัญชีถูกสร้างแล้ว กรุณารอ Admin อนุมัติก่อนเข้าใช้งาน"
      })
      setPassword("")
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
                    <div className="relative">
                      <Input 
                        id="password" 
                        type={showPassword ? "text" : "password"} 
                        placeholder="รหัสผ่าน" 
                        required 
                        className="h-11 pr-12"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
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
                      maxLength={PROFILE_NAME_MAX}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-phone">เบอร์โทรศัพท์ที่ติดต่อได้</Label>
                    <Input
                      id="signup-phone"
                      type="tel"
                      inputMode="tel"
                      placeholder="08X-XXX-XXXX"
                      required
                      className="h-11"
                      maxLength={PROFILE_PHONE_MAX}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground italic">* เบอร์นี้จะแสดงตอนขอรถ เพื่อให้คนจัดรถ/คนขับติดต่อกลับได้</p>
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
                    <div className="relative">
                      <Input 
                        id="signup-password" 
                        type={showPassword ? "text" : "password"} 
                        placeholder="รหัสผ่าน" 
                        required 
                        className="h-11 pr-12"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
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
