
"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  MapPin,
  Truck,
  Route,
  History,
  Settings,
  Menu,
  ChevronLeft,
  User as UserIcon,
  Users,
  LogOut,
  X,
  Car,
  Layers,
  FileText,
  BarChart2
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useUser, useAuth, useFirestore, useMemoFirebase, useCollection } from "@/firebase"
import { Badge } from "@/components/ui/badge"
import { UserRole } from "@/types/models"
import { collection, query, where, onSnapshot } from "firebase/firestore"

interface AppSidebarProps {
  userRole: UserRole;
  profileName?: string;
  isMobile?: boolean;
}

export function AppSidebar({ userRole, profileName, isMobile }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const auth = useAuth()
  const db = useFirestore()
  const { user } = useUser()
  const [collapsed, setCollapsed] = React.useState(false)
  
  // States for different types of alerts
  const [pendingReqCount, setPendingReqCount] = React.useState(0)
  const [inProgressReqCount, setInProgressReqCount] = React.useState(0)

  // Listen for requests
  React.useEffect(() => {
    if (!db || !user) return

    const isStaff = userRole === 'admin' || userRole === 'dispatcher'
    
    // Listen to all active statuses
    let q;
    if (isStaff) {
      q = query(
        collection(db, "vehicleRequests"), 
        where("status", "in", ["pending", "in_progress", "partial"])
      )
    } else {
      q = query(
        collection(db, "vehicleRequests"), 
        where("userId", "==", user.uid),
        where("status", "==", "pending")
      )
    }
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => d.data())
      
      if (isStaff) {
        // 1. Pending: Not yet acknowledged
        const pCount = docs.filter(r => r.status === 'pending').length
        
        // 2. In Progress: Received by dispatcher but not fully planned
        const iCount = docs.filter(r => r.status === 'in_progress' || r.status === 'partial').length
        
        setPendingReqCount(pCount)
        setInProgressReqCount(iCount)
      } else {
        // For Viewers, only count their own pending
        setPendingReqCount(docs.length)
        setInProgressReqCount(0)
      }
    })

    return () => unsubscribe()
  }, [db, user, userRole])

  const handleLogout = async () => {
    await auth.signOut()
    router.push("/login")
  }

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ['admin', 'dispatcher', 'viewer'] },
    { 
      name: "ขอรถ", 
      href: "/requests", 
      icon: Car, 
      roles: ['admin', 'dispatcher', 'viewer'], 
      badge: pendingReqCount > 0 ? pendingReqCount : null 
    },
    { name: "จัดการไซต์งาน", href: "/sites", icon: MapPin, roles: ['admin', 'dispatcher'] },
    { name: "ฟลีทรถและคนขับ", href: "/fleet", icon: Truck, roles: ['admin', 'dispatcher'] },
    { 
      name: "จัดกลุ่มเที่ยววิ่ง", 
      href: "/trip-grouping", 
      icon: Layers, 
      roles: ['admin', 'dispatcher'], 
      badge: inProgressReqCount > 0 ? inProgressReqCount : null 
    },
    { name: "ประวัติการส่ง", href: "/trips/history", icon: History, roles: ['admin', 'dispatcher', 'viewer'] },
    { name: "สรุปคิวรถประจำวัน", href: "/daily-summary", icon: FileText, roles: ['admin', 'dispatcher'] },
    { name: "รายงานสรุป", href: "/report", icon: BarChart2, roles: ['admin', 'dispatcher'] },
    { name: "จัดการผู้ใช้งาน", href: "/settings/users", icon: Users, roles: ['admin'] },
    { name: "ตั้งค่าระบบ", href: "/settings", icon: Settings, roles: ['admin', 'dispatcher'] },
    { name: "ข้อมูลส่วนตัว", href: "/profile", icon: UserIcon, roles: ['admin', 'dispatcher', 'viewer'] },
  ]

  const filteredItems = navItems.filter(item => item.roles.includes(userRole))

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin': return <Badge className="bg-red-500 text-[10px] h-4">ผู้ดูแล</Badge>
      case 'dispatcher': return <Badge className="bg-blue-500 text-[10px] h-4">จัดรถ</Badge>
      case 'viewer': return <Badge className="bg-gray-500 text-[10px] h-4">ดูข้อมูล</Badge>
    }
  }

  const isActuallyCollapsed = !isMobile && collapsed

  return (
    <aside 
      className={cn(
        "flex flex-col border-r bg-sidebar h-full transition-all duration-300 ease-in-out no-print",
        isActuallyCollapsed ? "w-16" : "w-64",
        isMobile && "w-full border-r-0"
      )}
    >
      <div className="flex h-16 items-center justify-between px-4 py-4 border-b">
        {!isActuallyCollapsed && (
          <span className="text-xl font-bold text-accent">LOTUS GROUP</span>
        )}
        {!isMobile ? (
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setCollapsed(!collapsed)}
            className="hover:bg-sidebar-accent"
          >
            {isActuallyCollapsed ? <Menu className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="lg:hidden">
          </Button>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4 overflow-y-auto">
        {filteredItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group flex items-center px-3 py-3 md:py-2 text-sm md:text-sm font-medium rounded-md transition-colors",
                isActive 
                  ? "bg-primary text-primary-foreground" 
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActuallyCollapsed && "justify-center"
              )}
            >
              <item.icon className={cn(
                "h-5 w-5 shrink-0",
                !isActuallyCollapsed && "mr-3"
              )} />
              {!isActuallyCollapsed && <span className="flex-1">{item.name}</span>}
              {!isActuallyCollapsed && item.badge && (
                <Badge variant="destructive" className="ml-auto h-5 min-w-5 flex items-center justify-center p-1 text-[10px]">
                  {item.badge}
                </Badge>
              )}
              {isActive && !isActuallyCollapsed && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />
              )}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t space-y-4">
        <div className={cn("flex items-center gap-3", isActuallyCollapsed && "justify-center")}>
          <div className="w-10 h-10 rounded-full bg-primary flex flex-col items-center justify-center font-bold text-accent shrink-0 relative">
            {profileName?.charAt(0) || user?.email?.charAt(0) || "U"}
          </div>
          {!isActuallyCollapsed && (
            <div className="flex flex-col items-start overflow-hidden flex-1">
              <div className="flex items-center gap-2 w-full">
                <span className="text-sm font-medium truncate">{profileName || "User"}</span>
                {getRoleBadge(userRole)}
              </div>
              <span className="text-xs text-muted-foreground truncate w-full">
                {user?.email}
              </span>
            </div>
          )}
        </div>
        {!isActuallyCollapsed && (
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full justify-start text-destructive border-destructive/20 hover:bg-destructive/10 h-11 md:h-9"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" /> ออกจากระบบ
          </Button>
        )}
      </div>
    </aside>
  )
}
