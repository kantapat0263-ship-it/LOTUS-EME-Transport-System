
"use client"

import * as React from "react"
import { useUser, useFirestore, useAuth } from "@/firebase"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Loader2, Menu, X } from "lucide-react"
import { useRouter, usePathname } from "next/navigation"
import { doc, onSnapshot } from "firebase/firestore"
import { UserProfile } from "@/types/models"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { VersionUpdateBanner } from "@/components/layout/version-update-banner"
import { useToast } from "@/hooks/use-toast"
import { clearPrivateApiCache } from "@/lib/privateCache"

/**
 * สถานะโปรไฟล์ของคนที่ล็อกอิน — แยก "ยังโหลดไม่เสร็จ" / "ไม่มีโปรไฟล์" / "โหลดไม่สำเร็จ" ให้ชัด
 * (useDoc ตอบ data=null ทั้งตอนยังไม่โหลดและตอนไม่มี doc และ error ของมันทำให้ทั้งแอป throw)
 */
type ProfileState =
  | { uid: string; status: "ready"; profile: UserProfile }
  | { uid: string; status: "missing" | "error"; profile: null }

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading } = useUser()
  const db = useFirestore()
  const auth = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useToast()

  const [profileState, setProfileState] = React.useState<ProfileState | null>(null)
  React.useEffect(() => {
    if (!user) return
    return onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        // ออฟไลน์แล้วไม่มีในแคช ≠ ไม่มีโปรไฟล์ — รอผลจาก server ก่อน (กันเด้งออกจากระบบตอนเน็ตหลุด)
        if (!snap.exists() && snap.metadata.fromCache) return
        setProfileState(snap.exists()
          ? { uid: user.uid, status: "ready", profile: { ...(snap.data() as UserProfile), id: snap.id } }
          : { uid: user.uid, status: "missing", profile: null })
      },
      () => setProfileState({ uid: user.uid, status: "error", profile: null }),
    )
  }, [db, user])
  const current = user && profileState?.uid === user.uid ? profileState : null
  const profile = current?.status === "ready" ? current.profile : null
  // ใช้งานได้เฉพาะบัญชีที่ admin อนุมัติแล้ว — ก่อนหน้านั้นไม่ render เมนู/หน้าลูก จึงไม่มี listener ข้อมูลธุรกิจเริ่มทำงาน
  const isApproved = profile?.active === true
  const isRejected = current?.status === "missing" || (current?.status === "ready" && !isApproved)

  const [currentDate, setCurrentDate] = React.useState<string | null>(null)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)

  React.useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString('th-TH', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    }))
  }, [])

  // บัญชีรออนุมัติ / ถูกระงับ / ไม่มีโปรไฟล์ → ออกจากระบบ (ล้างแคช API ส่วนตัว) แล้วกลับหน้า login
  // เดิม push ไป /login โดยไม่ signOut → หน้า login เด้งกลับ dashboard วนไปมา
  const rejectHandled = React.useRef(false)
  React.useEffect(() => {
    if (!isRejected || rejectHandled.current) return
    rejectHandled.current = true
    toast({
      title: "ยังเข้าใช้งานไม่ได้",
      description: "บัญชีของคุณยังไม่ได้รับอนุมัติ หรือถูกระงับ กรุณาติดต่อ Admin",
      variant: "destructive",
    })
    clearPrivateApiCache().finally(() => auth.signOut().finally(() => router.push("/login")))
  }, [isRejected, auth, router, toast])

  React.useEffect(() => {
    if (isUserLoading) return

    if (!user) {
      rejectHandled.current = false
      router.push("/login")
      return
    }

    if (profile && isApproved) {
      const viewerRestrictedPaths = ["/trips/plan", "/sites", "/fleet", "/settings", "/trip-grouping", "/daily-summary", "/report"]
      if (profile.role === "viewer") {
        const isRestricted = viewerRestrictedPaths.some(p => pathname.startsWith(p))
        if (isRestricted) {
          router.push("/requests")
        }
      }

      if (profile.role === "dispatcher" && pathname.startsWith("/settings/users")) {
        router.push("/dashboard")
      }
    }
  }, [user, isUserLoading, profile, isApproved, router, pathname])

  // Close mobile menu on route change
  React.useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [pathname])

  if (current?.status === "error") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm font-medium">ตรวจสอบสิทธิ์การใช้งานไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่</p>
          <Button onClick={() => window.location.reload()}>ลองใหม่</Button>
        </div>
      </div>
    )
  }

  if (!isApproved) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-accent" />
          <p className="text-sm font-medium animate-pulse">กำลังตรวจสอบสิทธิ์การใช้งาน...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <AppSidebar userRole={profile?.role || 'viewer'} profileName={profile?.name} />
      </div>

      <main className="flex-1 relative overflow-y-auto overflow-x-hidden">
        <VersionUpdateBanner />
        <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-background/95 px-4 md:px-8 backdrop-blur no-print">
          <div className="flex items-center gap-4">
            {/* Mobile Menu Trigger */}
            <div className="lg:hidden">
              <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10">
                    <Menu className="h-6 w-6" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-72 bg-sidebar border-r-0">
                  <SheetHeader className="sr-only">
                    <SheetTitle>เมนูนำทาง</SheetTitle>
                    <SheetDescription>เข้าถึงส่วนต่างๆ ของระบบบริหารการขนส่ง</SheetDescription>
                  </SheetHeader>
                  <AppSidebar userRole={profile?.role || 'viewer'} profileName={profile?.name} isMobile />
                </SheetContent>
              </Sheet>
            </div>
            <h1 className="text-base md:text-lg font-semibold text-accent truncate max-w-[150px] sm:max-w-none">
              LOTUS GROUP Transport
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs md:text-sm text-muted-foreground hidden sm:block">
              {currentDate}
            </div>
          </div>
        </header>
        <div className="p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
