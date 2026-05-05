
"use client"

import * as React from "react"
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Loader2, Menu, X } from "lucide-react"
import { useRouter, usePathname } from "next/navigation"
import { doc } from "firebase/firestore"
import { UserProfile } from "@/types/models"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading } = useUser()
  const db = useFirestore()
  const router = useRouter()
  const pathname = usePathname()
  
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading: isProfileLoading } = useDoc<UserProfile>(userProfileRef)

  const [currentDate, setCurrentDate] = React.useState<string | null>(null)
  const [isTimedOut, setIsTimedOut] = React.useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)

  React.useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString('th-TH', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }))

    const timer = setTimeout(() => {
      setIsTimedOut(true)
    }, 3000)

    return () => clearTimeout(timer)
  }, [])

  React.useEffect(() => {
    if (isUserLoading || isProfileLoading) return

    if (!user && !isTimedOut) {
      router.push("/login")
      return
    }

    if (profile) {
      if (!profile.active) {
        router.push("/login")
        return
      }

      const viewerRestrictedPaths = ["/trips/plan", "/sites", "/fleet", "/settings"]
      if (profile.role === "viewer") {
        const isRestricted = viewerRestrictedPaths.some(p => pathname.startsWith(p))
        if (isRestricted) {
          router.push("/trips/history")
        }
      }

      if (profile.role === "dispatcher" && pathname.startsWith("/settings/users")) {
        router.push("/dashboard")
      }
    }
  }, [user, isUserLoading, profile, isProfileLoading, router, pathname, isTimedOut])

  // Close mobile menu on route change
  React.useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [pathname])

  const showLoading = !isTimedOut && (isUserLoading || isProfileLoading || (user && !profile))

  if (showLoading) {
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
                  <AppSidebar userRole={profile?.role || 'viewer'} profileName={profile?.name} isMobile />
                </SheetContent>
              </Sheet>
            </div>
            <h1 className="text-base md:text-lg font-semibold text-accent truncate max-w-[150px] sm:max-w-none">
              LOTUS EME Transport
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
