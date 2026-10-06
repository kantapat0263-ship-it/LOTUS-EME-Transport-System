import type { Trip, TripStop } from './models'

export interface QueueLink {
  bookingId: string
  kind: 'day' | 'borrow' | 'compensation'
  date: string
  originalDate?: string
}

export interface QueueOverride {
  state: 'borrowed' | 'returned'
  targetTripId: string
  targetSiteName: string
  borrowDriver: boolean
  borrowVehicle: boolean
  reason: string
  approvedBy: string
  approvedByName?: string
  approvedAt: string
  compensation: 'not-required' | 'owed' | 'scheduled' | 'completed'
  compensationTripId?: string
  compensationDate?: string
  completedAt?: string
  assignments?: QueueSourceAssignment[]
}

export interface ContinuousBooking {
  id: string
  startDate: string
  endDate: string
  driverId: string
  driverName: string
  vehicleId: string
  vehiclePlate: string
  siteName: string
  dayTripIds: Record<string, string>
  overrides: Record<string, QueueOverride>
  template: QueueTripInput
  createdBy: string
  createdAt: string
}

export interface QueueNotice {
  bookingId: string
  startDate: string
  endDate: string
  date: string
  driverId: string
  driverName: string
  vehicleId: string
  vehiclePlate: string
  siteName: string
  effectiveSiteName: string
  borrowedDriver: boolean
  borrowedVehicle: boolean
}

export type QueueTripInput = Pick<Trip, 'tripDate' | 'driverId' | 'driverName' | 'vehicleId' | 'vehiclePlate' | 'stops'> & Partial<Pick<Trip, 'vehicleType' | 'sourceVRIds' | 'totalDistanceKm' | 'totalEstimatedTimeMinutes' | 'fuelCost' | 'dieselPriceUsed' | 'fuelRateUsed' | 'departurePoint' | 'originLat' | 'originLng'>>
export interface QueueSourceAssignment { requestId: string; destinationIndexes: number[]; expectedDestinationFingerprints?: string[] }

type Operation = { operationId: string }
export type QueueCommand = Operation & (
  | { action: 'create'; trip: QueueTripInput; endDate: string; assignments: QueueSourceAssignment[] }
  | { action: 'extend'; tripId: string; endDate: string }
  | { action: 'borrow'; bookingId: string; date: string; trip: QueueTripInput; assignments: QueueSourceAssignment[]; borrowDriver: boolean; borrowVehicle: boolean; reason: string; compensationRequired: boolean }
  | { action: 'return'; bookingId: string; date: string; reason: string }
  | { action: 'schedule-compensation'; bookingId: string; originalDate: string; date: string }
  | { action: 'complete-compensation' | 'cancel-compensation'; bookingId: string; originalDate: string }
  | { action: 'complete-day'; bookingId: string; date: string }
)

export interface QueueCommandResult { bookingId: string; tripIds: string[] }
export interface QueueSnapshot { date: string; notices: QueueNotice[]; bookings: ContinuousBooking[] }

export interface QueueResourceGuard {
  version: number
  bookingId?: string
  tripId?: string
}

export interface QueueAuditEvent {
  action: QueueCommand['action']
  bookingId: string
  date: string
  actorId: string
  actorName: string
  recordedAt: string
  reason?: string
  tripIds: string[]
}

export type QueueStops = TripStop[]
