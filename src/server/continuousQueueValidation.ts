import type { QueueCommand } from '@/types/continuous-queue'
import { z } from 'zod'
import { expandQueueDates } from '@/lib/continuousQueue'

const id = z.string().min(1).max(120).refine(value => !value.includes('/') && value !== '.' && value !== '..')
const date = z.string().refine(value => { try { expandQueueDates(value, value); return true } catch { return false } }, 'วันที่ไม่ถูกต้อง')
const reason = z.string().trim().min(1).max(1000)
const operationId = z.string().min(8).max(80).regex(/^[a-zA-Z0-9_-]+$/)
const text = z.string().max(10_000)
const stop = z.object({
  siteId: z.string().nullable().optional(), siteName: text, order: z.number().int().min(1), cargoDetails: text,
  lat: z.number().finite().min(-90).max(90).optional(), lng: z.number().finite().min(-180).max(180).optional(),
  requestedBy: text.optional(), requestedByPhone: text.optional(), requestedByUserId: text.optional(), requestedAt: z.number().finite().optional(), requestTime: text.optional(), address: text.optional(), note: text.optional(), dispatcherNote: text.optional(), dispatcherName: text.optional(),
}).strict()
const trip = z.object({
  tripDate: date, driverId: id, driverName: text, vehicleId: id, vehiclePlate: text, stops: z.array(stop).min(1).max(150),
  vehicleType: text.optional(), sourceVRIds: z.array(id).max(150).optional(), totalDistanceKm: z.number().finite().nonnegative().optional(), totalEstimatedTimeMinutes: z.number().finite().nonnegative().optional(), fuelCost: z.number().finite().nonnegative().optional(), dieselPriceUsed: z.number().finite().nonnegative().optional(), fuelRateUsed: z.number().finite().positive().optional(), departurePoint: text.optional(), originLat: z.number().finite().min(-90).max(90).optional(), originLng: z.number().finite().min(-180).max(180).optional(),
}).strict()
const assignments = z.array(z.object({ requestId: id, destinationIndexes: z.array(z.number().int().min(0).max(149)).min(1).max(150) }).strict()).max(150)
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), operationId, trip, endDate: date, assignments }).strict(),
  z.object({ action: z.literal('extend'), operationId, tripId: id, endDate: date }).strict(),
  z.object({ action: z.literal('borrow'), operationId, bookingId: id, date, trip, assignments, borrowDriver: z.boolean(), borrowVehicle: z.boolean(), reason, compensationRequired: z.boolean() }).strict(),
  z.object({ action: z.literal('return'), operationId, bookingId: id, date, reason }).strict(),
  z.object({ action: z.literal('schedule-compensation'), operationId, bookingId: id, originalDate: date, date }).strict(),
  z.object({ action: z.literal('complete-compensation'), operationId, bookingId: id, originalDate: date }).strict(),
  z.object({ action: z.literal('cancel-compensation'), operationId, bookingId: id, originalDate: date }).strict(),
  z.object({ action: z.literal('complete-day'), operationId, bookingId: id, date }).strict(),
])

export function parseQueueCommand(input: unknown): QueueCommand {
  const command = schema.parse(input) as QueueCommand
  if (command.action === 'create') expandQueueDates(command.trip.tripDate, command.endDate)
  if (command.action === 'borrow' && (command.trip.tripDate !== command.date || (!command.borrowDriver && !command.borrowVehicle))) throw new Error('วันที่ยืมต้องตรงกับวันใช้งานและต้องเลือกทรัพยากรที่ยืม')
  return command
}
