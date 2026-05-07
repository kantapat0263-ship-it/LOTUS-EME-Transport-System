
"use client"

import * as React from "react"
import { RequestForm } from "@/components/requests/RequestForm"
import { RequestList } from "@/components/requests/RequestList"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ClipboardList, History } from "lucide-react"

export default function RequestsPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">ระบบขอใช้รถ</h2>
        <p className="text-sm md:text-base text-muted-foreground">ส่งคำขอเพื่อจัดสรรรถและพนักงานขับรถสำหรับงานก่อสร้างและขนส่ง</p>
      </div>

      <Tabs defaultValue="form" className="space-y-6">
        <TabsList className="bg-secondary/50 p-1 w-full sm:w-auto">
          <TabsTrigger value="form" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">
            <ClipboardList className="mr-2 h-4 w-4" /> ใบขอใช้รถ
          </TabsTrigger>
          <TabsTrigger value="list" className="data-[state=active]:bg-accent flex-1 sm:flex-none h-10 px-6">
            <History className="mr-2 h-4 w-4" /> คำขอของฉัน
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form" className="animate-in slide-in-from-left-2 duration-300">
          <RequestForm />
        </TabsContent>

        <TabsContent value="list" className="animate-in slide-in-from-right-2 duration-300">
          <RequestList />
        </TabsContent>
      </Tabs>
    </div>
  )
}
