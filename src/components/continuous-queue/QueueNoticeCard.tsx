import * as React from 'react'
import type { QueueNotice } from '@/types/continuous-queue'

export function queueDateLabel(date: string) {
  const [year, month, day] = date.split('-')
  return `${Number(day)}/${Number(month)}/${year}`
}

export function QueueNoticeCard({ date, status, notices }: { date: string; status: 'loading' | 'ready' | 'error'; notices: QueueNotice[] }) {
  if (!date) return null
  if (status !== 'ready') {
    return <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
      {status === 'loading' ? 'กำลังตรวจคิวต่อเนื่อง' : 'ตรวจคิวต่อเนื่องไม่ได้ในขณะนี้'}
      {' คนจัดรถจะยืนยันความพร้อมอีกครั้ง ส่งคำขอได้ตามปกติ'}
    </p>
  }
  const current = notices.filter(n => n.date === date)
  if (current.length === 0) return <p className="text-xs text-muted-foreground">ไม่พบคิวต่อเนื่องครอบคลุมวันที่เลือก คนจัดรถจะยืนยันความพร้อมอีกครั้ง</p>
  return <aside className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100" aria-label="คิวต่อเนื่องในวันที่ขอรถ">
    <p className="font-semibold">{current[0].startDate === current[0].endDate
      ? `${current[0].driverName} มีคิววันที่ ${queueDateLabel(current[0].startDate)}`
      : `${current[0].driverName} มีคิวต่อเนื่อง วันที่ ${queueDateLabel(current[0].startDate)} ถึง ${queueDateLabel(current[0].endDate)}`}</p>
    <p className="text-xs">{current[0].borrowedDriver || current[0].borrowedVehicle
      ? `วันที่ ${queueDateLabel(date)} ${[current[0].borrowedDriver ? 'คนขับ' : '', current[0].borrowedVehicle ? 'รถ' : ''].filter(Boolean).join('และ')} มีคิว ${current[0].effectiveSiteName} แล้ว`
      : `วันที่ ${queueDateLabel(date)} ประจำ ${current[0].siteName} พร้อมรถ ${current[0].vehiclePlate}`}</p>
    {current.length > 1 && <p className="text-xs">มีคิวต่อเนื่องอีก {current.length - 1} รายการ</p>}
    <details className="text-xs">
      <summary className="cursor-pointer font-medium underline underline-offset-4">ดูรายละเอียดคิว</summary>
      <div className="mt-2 space-y-3 border-t border-amber-500/25 pt-2">
        {current.map(n => <div key={n.bookingId} className="space-y-1">
          <p className="font-medium">{`${n.driverName} · ${n.vehiclePlate}`}</p>
          <p>{n.startDate === n.endDate ? `คิว ${n.siteName} วันที่ ${queueDateLabel(n.startDate)}` : `คิวเดิม ${n.siteName} วันที่ ${queueDateLabel(n.startDate)} ถึง ${queueDateLabel(n.endDate)}`}</p>
          {(n.borrowedDriver || n.borrowedVehicle) && <>
            <p>{`เฉพาะวันที่ ${queueDateLabel(date)} ${[n.borrowedDriver ? 'คนขับ' : '', n.borrowedVehicle ? 'รถ' : ''].filter(Boolean).join('และ')} ไป ${n.effectiveSiteName}`}</p>
            {!n.borrowedVehicle && <p>{`${n.vehiclePlate} ยังจองให้${n.siteName}`}</p>}
            {!n.borrowedDriver && <p>{`${n.driverName} ยังจองให้ ${n.siteName}`}</p>}
          </>}
        </div>)}
      </div>
    </details>
    <p className="text-xs text-amber-200/90">โทรปรึกษาคนจัดรถก่อน หรือส่งคำขอได้ คนจัดรถจะพิจารณา ยังไม่ยืนยันคนขับและรถ</p>
  </aside>
}
