
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

export default function Home() {
  const router = useRouter()

  React.useEffect(() => {
    router.push("/dashboard")
  }, [router])

  return null
}
