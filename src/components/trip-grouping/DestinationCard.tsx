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
  manualIndex?: number;
  onHover?: (id: string | null) => void;
}

export function DestinationCard({ dest, isSelected, onToggle, manualIndex, onHover }: DestinationCardProps) {
  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all border-l-4 group overflow-hidden",
        isSelected 
          ? "border-accent bg-accent/5 shadow-md scale-[1.01]" 
          : "border-secondary bg-secondary/20 hover:border-accent/40"
      )}
      onClick={onToggle}
      onMouseEnter={() => onHover?.(dest.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <CardContent className="p-0 flex items-stretch">
        {/* Checkbox or Order Area */}
        <div className="bg-secondary/10 flex items-center justify-center px-4 border-r border-border/30">
          {manualIndex ? (
            <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center font-bold text-xs shadow-sm">
              {manualIndex}
            </div>
          ) : (
            <Checkbox 
              checked={isSelected} 
              onCheckedChange={onToggle}
              onClick={(e) => e.stopPropagation()}
              className="w-4 h-4 rounded-sm border-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
            />
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 p-3 space-y-3">
          <div className="flex justify-between items-start gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-accent">{dest.vrId}</span>
              </div>
              <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-accent shrink-0" /> {dest.siteName}
              </p>
            </div>
            <div className="text-right shrink-0 bg-background/40 px-2 py-1 rounded border border-border/50">
              <p className="text-[10px] font-bold text-muted-foreground uppercase flex items-center justify-end gap-1">
                วันที่ขอใช้รถ
              </p>
              <p className="text-xs font-bold text-white">
                {dest.requestDate ? (() => {
                  const [y, m, d] = dest.requestDate.split('-')
                  return `${d}/${m}/${y}`
                })() : "-"}
              </p>
              {dest.requestTime && (
                <p className="text-[11px] font-bold text-accent mt-0.5">
                  🕗 {dest.requestTime} น.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="bg-secondary/40 p-2 rounded-lg border border-border/50">
              <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 mb-0.5">
                <User className="h-3 w-3" /> ผู้ขอใช้งาน
              </p>
              <p className="text-xs font-medium text-white truncate">{dest.requestedBy}</p>
            </div>
            <div className="bg-secondary/40 p-2 rounded-lg border border-border/50">
              <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 mb-0.5">
                <FileText className="h-3 w-3 text-accent" /> ลักษณะงาน
              </p>
              <p className="text-xs text-foreground/80 line-clamp-1">
                {dest.jobDescription || "ไม่ได้ระบุ"}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
