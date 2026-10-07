import { z } from 'zod'
import type { CoordinateSyncCommand } from '@/lib/tripCoordinateSync'

const id = z.string().min(1).max(200).refine(value => value !== '.' && value !== '..' && !value.includes('/'))
const selection = z.object({ stopIndex: z.number().int().min(0).max(1000), siteId: id, latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict()
const command = z.object({
  operationId: z.string().uuid(), tripId: id, baseline: z.string().regex(/^[a-f0-9]{64}$/),
  selections: z.array(selection).min(1).max(100).refine(values => new Set(values.map(value => value.stopIndex)).size === values.length),
}).strict()

export const parseCoordinateSyncCommand = (input: unknown): CoordinateSyncCommand => command.parse(input)
