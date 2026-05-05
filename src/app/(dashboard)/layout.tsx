
"use client"

import * as React from "react"
import { useUser, useAuth, useFirestore } from "@/firebase"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Loader2 } from "lucide-react"
import { signInAnonymously } from "firebase/auth"
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading } = useUser()
  const auth = useAuth()
  const db = useFirestore()
  const [isInitializing, setIsInitializing] = React.useState(true)
  const [currentDate, setCurrentDate] = React.useState<string | null>(null)

  // Fix hydration mismatch for date
  React.useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString('th-TH', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }))
  }, [])

  // Automatic Anonymous Auth & Profile Creation
  React.useEffect(() => {
    async function initAuth() {
      if (isUserLoading) return

      if (!user) {
        try {
          const userCredential = await signInAnonymously(auth)
          const anonUser = userCredential.user
          
          const profileRef = doc(db, "userProfiles", anonUser.uid)
          const profileSnap = await getDoc(profileRef)
          
          if (!profileSnap.exists()) {
            await setDoc(profileRef, {
              id: anonUser.uid,
              email: "guest@lotuseme.com",
              name: "Guest User",
              role: "Admin", // Default to Admin for full access in prototype
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            })
          }
        } catch (error) {
          console.error("Silent auth failed", error)
        }
      }
      setIsInitializing(false)
    }

    initAuth()
  }, [user, isUserLoading, auth, db])

  if (isUserLoading || isInitializing || !user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-accent" />
          <p className="text-sm font-medium animate-pulse">กำลังเตรียมความพร้อมของระบบ...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />
      <main className="flex-1 relative overflow-y-auto overflow-x-hidden">
        <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-background/95 px-8 backdrop-blur">
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
