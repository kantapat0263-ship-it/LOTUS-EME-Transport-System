
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/firebase"
import { Loader2 } from "lucide-react"

export default function Home() {
  const { user, isUserLoading } = useUser()
  const router = useRouter()

  React.useEffect(() => {
    if (!isUserLoading) {
      if (user) {
        router.push("/dashboard")
      } else {
        router.push("/login")
      }
    }
  }, [user, isUserLoading, router])

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-accent" />
        <p className="text-sm font-medium text-muted-foreground">กำลังเตรียมความพร้อม...</p>
      </div>
    </div>
  )
}
