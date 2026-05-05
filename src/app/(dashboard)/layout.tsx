
"use client"

import * as React from "react"
import { useUser, useAuth, useFirestore, useDoc, useMemoFirebase } from "@/firebase"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Loader2 } from "lucide-react"
import { useRouter, usePathname } from "next/navigation"
import { doc } from "firebase/firestore"
import { UserProfile } from "@/types/models"

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

  React.useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString('th-TH', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }))
  }, [])

  // Auth & Role Protection
  React.useEffect(() => {
    if (isUserLoading || isProfileLoading) return

    if (!user) {
      router.push("/login")
      return
    }

    if (profile) {
      if (!profile.active) {
        router.push("/login")
        return
      }

      // Viewer restrictions
      const viewerRestrictedPaths = ["/trips/plan", "/sites", "/fleet", "/settings"]
      if (profile.role === "viewer" && viewerRestrictedPaths.some(p => pathname.startsWith(p))) {
        router.push("/trips/history")
      }

      // Dispatcher restrictions
      if (profile.role === "dispatcher" && pathname.startsWith("/settings/users")) {
        router.push("/dashboard")
      }
    }
  }, [user, isUserLoading, profile, isProfileLoading, router, pathname])

  if (isUserLoading || isProfileLoading || (user && !profile)) {
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
      <AppSidebar userRole={profile?.role || 'viewer'} profileName={profile?.name} />
      <main className="flex-1 relative overflow-y-auto overflow-x-hidden">
        <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-background/95 px-8 backdrop-blur no-print">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-accent">LOTUS EME Transport System</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground hidden sm:block">
              {currentDate}
            </div>
          </div>
        </header>
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
