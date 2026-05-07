"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { MapPin, User, FileText, Calendar } from "lucide-react"
import { cn } from "@/lib/utils"

interface DestinationCardProps {
  dest: any;
  isSelected: boolean;
  onToggle: () => void;
}

export function DestinationCard({ dest, isSelected, onToggle }: DestinationCardProps) {
  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all border-l-[12px] group overflow-hidden",
        isSelected 
          ? "border-accent bg-accent/10 shadow-lg shadow-accent/5 scale-[1.02]" 
          : "border-secondary bg-secondary/20 hover:border-accent/40"
      )}
      onClick={onToggle}
    >
      <CardContent className="p-0 flex items-stretch">
        {/* Large Checkbox Area */}
        <div className="bg-secondary/10 flex items-center justify-center px-6 border-r border-border/30">
          <div className="relative w-8 h-8 flex items-center justify-center">
            <Checkbox 
              checked={isSelected} 
              onCheckedChange={onToggle}
              className="w-8 h-8 rounded-md border-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
            />
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-5 space-y-4">
          <div className="flex justify-between items-start gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-accent">{dest.vrId}</span>
                <Badge variant="outline" className="text-sm font-bold bg-background/50">จุดที่ {dest.destIndex + 1}</Badge>
              </div>
              <p className="text-2xl font-bold text-white flex items-center gap-2">
                <MapPin className="h-6 w-6 text-accent shrink-0" /> {dest.siteName}
              </p>
            </div>
            <div className="text-right shrink-0 bg-background/40 p-2 rounded-lg border border-border/50">
              <p className="text-sm font-bold text-muted-foreground uppercase flex items-center justify-end gap-1">
                <Calendar className="h-3 w-3" /> วันที่ต้องการ
              </p>
              <p className="text-lg font-black text-white">{dest.requestDate}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-secondary/40 p-3 rounded-xl border border-border/50">
              <p className="text-sm font-bold text-muted-foreground flex items-center gap-1.5 mb-1">
                <User className="h-4 w-4" /> ผู้ขอใช้งาน
              </p>
              <p className="text-lg font-bold text-white truncate">{dest.requestedBy}</p>
            </div>
            <div className="bg-secondary/40 p-3 rounded-xl border border-border/50">
              <p className="text-sm font-bold text-muted-foreground flex items-center gap-1.5 mb-1">
                <FileText className="h-4 w-4 text-accent" /> ลักษณะงาน
              </p>
              <p className="text-base font-medium text-foreground/90 line-clamp-2 leading-relaxed">
                {dest.jobDescription || "ไม่ได้ระบุ"}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
