"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"
import { format } from "date-fns"
import { th } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

/** หัวปฏิทินภาษาไทย ปี พ.ศ. แบบที่เว็บใช้ทุกหน้า (เช่น "พฤศจิกายน 2569") */
export function formatThaiCaption(month: Date): string {
  return `${format(month, "LLLL", { locale: th })} ${month.getFullYear() + 543}`
}

/** ชื่อวันแบบสั้นไม่มีจุด: จ อ พ พฤ ศ ส อา */
export function formatThaiWeekday(day: Date): string {
  return format(day, "cccccc", { locale: th }).replace(/\.$/, "")
}

/**
 * ปฏิทินเลือกวันที่ — react-day-picker v9 (package.json ^9)
 * เดิม classNames เขียนแบบ v8 (head_row/cell/day ...) — v9 ไม่รู้จักชื่อส่วนใหญ่ และเอาคลาสปุ่ม (inline-flex) ไปใส่ช่องวันในตาราง
 * ตารางเลยพัง หัววันขึ้นเป็น "Mo ……… TuWeThFrSaSu" ทั้งจอคอมและมือถือ · ชื่อคลาสด้านล่างเป็นของ v9 ทั้งหมด
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={th}
      formatters={{ formatCaption: formatThaiCaption, formatWeekdayName: formatThaiWeekday }}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col sm:flex-row gap-4",
        month: "space-y-4",
        month_caption: "flex h-7 items-center justify-center",
        caption_label: "text-sm font-medium",
        // ปุ่มเลื่อนเดือนวางทับหัวปฏิทิน ซ้าย/ขวา
        nav: "absolute inset-x-0 top-0 z-10 flex h-7 items-center justify-between px-1",
        button_previous: cn(buttonVariants({ variant: "outline" }), "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"),
        button_next: cn(buttonVariants({ variant: "outline" }), "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"),
        month_grid: "w-full border-collapse",
        weekdays: "flex w-full",
        weekday: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center p-0",
        week: "flex w-full mt-2",
        day: "h-9 w-9 text-center text-sm p-0 relative rounded-md focus-within:relative focus-within:z-20",
        day_button: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal"),
        range_end: "day-range-end",
        selected: "bg-primary text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground",
        today: "bg-accent text-accent-foreground",
        outside: "day-outside text-muted-foreground",
        // ปุ่มวันที่กดไม่ได้จางอยู่แล้ว (disabled:opacity-50 ของปุ่ม) — ไม่จางซ้ำที่ช่อง
        disabled: "text-muted-foreground",
        range_middle: "bg-accent text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ className, orientation }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight
          return <Icon className={cn("h-4 w-4", className)} />
        },
      }}
      weekStartsOn={1}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
