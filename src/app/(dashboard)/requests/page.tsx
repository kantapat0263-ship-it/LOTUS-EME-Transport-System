
"use client"

import * as React from "react"
import { RequestForm } from "@/components/requests/RequestForm"
import { RequestList } from "@/components/requests/RequestList"
import { RequestManager } from "@/components/requests/RequestManager"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ClipboardList, History, Settings2, Loader2 } from "lucide-react"
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase"
import { doc } from "firebase/firestore"
import { UserProfile } from "@/types/models"

export default function RequestsPage() {
  const { user } = useUser()
  const db = useFirestore()
  const userProfileRef = useMemoFirebase(() => user ? doc(db, "users", user.uid) : null, [db, user])
  const { data: profile, isLoading } = useDoc<UserProfile>(userProfileRef)

  if (isLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-accent" />
      </div>
    )
  }

  const isStaff = profile?.role === 'admin' || profile?.role === 'dispatcher'

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">ระบบขอใช้รถ</h2>
        <p className="text-sm md:text-base text-muted-foreground">ส่งคำขอและจัดการการขอใช้รถสำหรับงานขนส่งและก่อสร้าง</p>
      </div>

      <Tabs defaultValue={isStaff ? "manage" : "form"} className="space-y-6">
        <TabsList className="bg-secondary/50 p-1 w-full sm:w-auto">
          <TabsTrigger value="form" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">
            <ClipboardList className="mr-2 h-4 w-4" /> ใบขอใช้รถ
          </TabsTrigger>
          <TabsTrigger value="list" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">
            <History className="mr-2 h-4 w-4" /> คำขอของฉัน
          </TabsTrigger>
          {isStaff && (
            <TabsTrigger value="manage" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">
              <Settings2 className="mr-2 h-4 w-4" /> จัดการคำขอ
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="form" className="animate-in slide-in-from-left-2 duration-300">
          <RequestForm />
        </TabsContent>

        <TabsContent value="list" className="animate-in slide-in-from-right-2 duration-300">
          <RequestList />
        </TabsContent>

        {isStaff && (
          <TabsContent value="manage" className="animate-in slide-in-from-bottom-2 duration-300">
            <RequestManager />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
