import type { Trip } from '@/types/models'
import type { ContinuousBooking, QueueNotice } from '@/types/continuous-queue'

export const MAX_QUEUE_DAYS = 90

export function expandQueueDates(from: string, to: string): string[] {
  const parse = (value: string) => {
    const time = new Date(`${value}T00:00:00Z`).getTime()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('วันที่ไม่ถูกต้อง')
    return time
  }
  const start = parse(from)
  const end = parse(to)
  const count = (end - start) / 86_400_000 + 1
  if (count < 1 || count > MAX_QUEUE_DAYS) throw new Error(`ระบุช่วงคิว 1–${MAX_QUEUE_DAYS} วัน โดยวันสิ้นสุดต้องไม่ก่อนวันเริ่ม`)
  const dates: string[] = []
  for (let day = new Date(start); day.getTime() <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10))
  }
  return dates
}

export function isManagedTrip(trip: Pick<Trip, 'queueLink'>): boolean {
  return !!trip.queueLink
}

export function effectiveTrips<T extends { status: string }>(trips: T[]): T[] {
  return trips.filter(trip => trip.status !== 'Cancelled')
}

export function queueNotice(booking: ContinuousBooking, date: string): QueueNotice | null {
  if (date < booking.startDate || date > booking.endDate) return null
  const override = booking.overrides[date]
  const borrowed = override?.state === 'borrowed'
  return { bookingId: booking.id, startDate: booking.startDate, endDate: booking.endDate, date, driverId: booking.driverId, driverName: booking.driverName, vehicleId: booking.vehicleId, vehiclePlate: booking.vehiclePlate, siteName: booking.siteName, effectiveSiteName: borrowed ? override.targetSiteName : booking.siteName, borrowedDriver: borrowed && override.borrowDriver, borrowedVehicle: borrowed && override.borrowVehicle }
}

export function resourceGuardKeys(trip: Pick<Trip, 'driverId' | 'actualDriverId' | 'vehicleId'> & { tripDate?: string; date?: string }): string[] {
  const date = trip.tripDate || trip.date || ''
  return [trip.actualDriverId || trip.driverId ? `driver__${trip.actualDriverId || trip.driverId}__${date}` : '', trip.vehicleId ? `vehicle__${trip.vehicleId}__${date}` : ''].filter(Boolean)
}
