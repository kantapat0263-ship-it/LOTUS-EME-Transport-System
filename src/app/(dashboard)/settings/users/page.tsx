
"use client"

import * as React from "react"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { collection, doc, query, orderBy, serverTimestamp } from "firebase/firestore"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { UserProfile, UserRole } from "@/types/models"
import { updateDocumentNonBlocking } from "@/firebase/non-blocking-updates"
import { MoreHorizontal, Shield, Loader2, UserPlus } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function UserManagementPage() {
  const { toast } = useToast()
  const db = useFirestore()
  const usersRef = useMemoFirebase(() => query(collection(db, "users"), orderBy("createdAt", "desc")), [db])
  const { data: users, isLoading } = useCollection<UserProfile>(usersRef)

  const handleRoleChange = (userId: string, newRole: UserRole) => {
    updateDocumentNonBlocking(doc(db, "users", userId), { 
      role: newRole,
      updatedAt: serverTimestamp()
    })
    toast({ title: "อัปเดตบทบาทสำเร็จ", description: `เปลี่ยนเป็น ${newRole} เรียบร้อยแล้ว` })
  }

  const handleStatusChange = (userId: string, active: boolean) => {
    updateDocumentNonBlocking(doc(db, "users", userId), { 
      active: active,
      updatedAt: serverTimestamp()
    })
    toast({ 
      title: active ? "เปิดใช้งานบัญชี" : "ระงับบัญชี", 
      description: active ? "ผู้ใช้สามารถเข้าสู่ระบบได้แล้ว" : "ผู้ใช้จะไม่สามารถเข้าสู่ระบบได้" 
    })
  }

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin': return <Badge className="bg-red-500">Admin</Badge>
      case 'dispatcher': return <Badge className="bg-blue-500">Dispatcher</Badge>
      case 'viewer': return <Badge className="bg-gray-500">Viewer</Badge>
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">จัดการผู้ใช้งาน</h2>
        <p className="text-muted-foreground">กำหนดบทบาทและจัดการสิทธิ์การเข้าถึงของทีมงาน</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-accent" /> รายชื่อผู้ใช้งานในระบบ
          </CardTitle>
          <CardDescription>จัดการบัญชีผู้ใช้และสิทธิ์การใช้งานของพนักงานทุกคน</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อ-นามสกุล / อีเมล</TableHead>
                <TableHead>บทบาท (Role)</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-accent" />
                  </TableCell>
                </TableRow>
              ) : users?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground">{user.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select 
                      defaultValue={user.role} 
                      onValueChange={(val) => handleRoleChange(user.id, val as UserRole)}
                    >
                      <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="dispatcher">Dispatcher</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch 
                        checked={user.active} 
                        onCheckedChange={(val) => handleStatusChange(user.id, val)} 
                      />
                      <span className={user.active ? "text-green-500" : "text-destructive"}>
                        {user.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-destructive">
                          ลบผู้ใช้งาน
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
