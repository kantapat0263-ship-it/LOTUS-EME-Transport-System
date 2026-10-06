import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QueueNoticeCard } from './QueueNoticeCard'
import type { QueueNotice } from '@/types/continuous-queue'

const notice: QueueNotice = {
  bookingId: 'booking-a', startDate: '2026-10-03', endDate: '2026-10-10', date: '2026-10-05',
  driverId: 'driver-a', driverName: 'สมคิด', vehicleId: 'truck-a', vehiclePlate: '40-1234',
  siteName: 'ไซต์ A', effectiveSiteName: 'ไซต์ B', borrowedDriver: true, borrowedVehicle: false,
}

describe('continuous queue notice', () => {
  it('keeps the original truck reserved when only the driver is borrowed', () => {
    const html = renderToStaticMarkup(<QueueNoticeCard date="2026-10-05" status="ready" notices={[notice]} />)
    expect(html).toContain('สมคิด')
    expect(html).toContain('ไซต์ B')
    expect(html).toContain('40-1234 ยังจองให้ไซต์ A')
    expect(html).toContain('ส่งคำขอได้')
    expect(html).toContain('คนจัดรถจะพิจารณา')
    expect(html).not.toContain('รถว่าง')
  })
  it('does not describe an unavailable check as a free resource', () => {
    const html = renderToStaticMarkup(<QueueNoticeCard date="2026-10-05" status="error" notices={[notice]} />)
    expect(html).toContain('ตรวจคิวต่อเนื่องไม่ได้')
    expect(html).not.toContain('ไม่พบคิว')
    expect(html).not.toContain('ไซต์ B')
    expect(html).toContain('ส่งคำขอได้ตามปกติ')
  })
  it('does not reuse a notice from an earlier selected date', () => {
    const html = renderToStaticMarkup(<QueueNoticeCard date="2026-10-06" status="ready" notices={[notice]} />)
    expect(html).not.toContain('สมคิด')
    expect(html).toContain('คนจัดรถจะยืนยันความพร้อมอีกครั้ง')
    expect(html).not.toContain('รถว่าง')
  })
  it('keeps the driver reserved when only the truck is borrowed', () => {
    const html = renderToStaticMarkup(<QueueNoticeCard date="2026-10-05" status="ready" notices={[{ ...notice, borrowedDriver: false, borrowedVehicle: true }]} />)
    expect(html).toContain('สมคิด ยังจองให้ ไซต์ A')
    expect(html).toContain('รถ มีคิว ไซต์ B แล้ว')
    expect(html).not.toContain('พร้อมรถ 40-1234')
  })
  it('describes a single compensation day as one occupied day', () => {
    const html = renderToStaticMarkup(<QueueNoticeCard date="2026-10-11" status="ready" notices={[{ ...notice, startDate: '2026-10-11', endDate: '2026-10-11', date: '2026-10-11', effectiveSiteName: 'ไซต์ A', borrowedDriver: false, borrowedVehicle: false }]} />)
    expect(html).toContain('สมคิด มีคิววันที่ 11/10/2026')
    expect(html).not.toContain('มีคิวต่อเนื่อง')
    expect(html).toContain('ยังไม่ยืนยันคนขับและรถ')
  })
})
