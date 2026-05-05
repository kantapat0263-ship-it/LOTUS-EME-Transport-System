
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
  LogOut,
  User as UserIcon
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useUser, useAuth } from "@/firebase"
import { signOut } from "firebase/auth"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"

const navItems = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "จัดการไซน์งาน", href: "/sites", icon: MapPin },
  { name: "ฟลีทรถและคนขับ", href: "/fleet", icon: Truck },
  { name: "วางแผนการส่ง", href: "/trips/plan", icon: Route },
  { name: "ประวัติการส่ง", href: "/trips/history", icon: History },
  { name: "Settings", href: "/settings", icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const auth = useAuth()
  const { user } = useUser()
  const [collapsed, setCollapsed] = React.useState(false)

  const handleLogout = async () => {
    try {
      await signOut(auth)
      router.push("/login")
    } catch (error) {
      console.error("Logout failed", error)
    }
  }

  return (
    <aside 
      className={cn(
        "flex flex-col border-r bg-sidebar h-screen transition-all duration-300 ease-in-out",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex h-16 items-center justify-between px-4 py-4 border-b">
        {!collapsed && (
          <span className="text-xl font-bold text-accent">LOTUS EME</span>
        )}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setCollapsed(!collapsed)}
          className="hover:bg-sidebar-accent"
        >
          {collapsed ? <Menu className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </Button>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                isActive 
                  ? "bg-primary text-primary-foreground" 
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                collapsed && "justify-center"
              )}
            >
              <item.icon className={cn(
                "h-5 w-5 shrink-0",
                !collapsed && "mr-3"
              )} />
              {!collapsed && <span>{item.name}</span>}
              {isActive && !collapsed && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />
              )}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className={cn("w-full p-0 flex items-center gap-3 justify-start hover:bg-transparent", collapsed && "justify-center")}>
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center font-bold text-accent shrink-0">
                {user?.displayName?.charAt(0) || user?.email?.charAt(0) || "U"}
              </div>
              {!collapsed && (
                <div className="flex flex-col items-start overflow-hidden">
                  <span className="text-sm font-medium truncate w-full text-left">
                    {user?.displayName || "User"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate w-full text-left">
                    {user?.email}
                  </span>
                </div>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={collapsed ? "center" : "end"} className="w-56">
            <DropdownMenuItem disabled>
              <UserIcon className="mr-2 h-4 w-4" /> โปรไฟล์
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Settings className="mr-2 h-4 w-4" /> ตั้งค่า
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" /> ออกจากระบบ
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
