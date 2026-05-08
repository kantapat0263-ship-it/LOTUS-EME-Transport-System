
"use client"

import { Loader2 } from "lucide-react"

export default function DriverTripLoading() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
      <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-4" />
      <p className="text-gray-500 font-medium animate-pulse">กำลังโหลดข้อมูลใบงาน...</p>
    </div>
  )
}
