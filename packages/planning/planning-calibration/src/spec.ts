import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CalibrationSample } from './types.ts'

/** Runtime validator for one rebuildable calibration sample row. */
export const calibrationSampleSchema: z.ZodType<CalibrationSample> = z.object({
  id: z.string().min(1),
  featureId: z.string().min(1),
  workClass: z.string().min(1),
  workTags: z.array(z.string().min(1)),
  riskLevel: z.enum(['R0', 'R1', 'R2', 'R3']),
  estimatedP50Minutes: z.number().positive(),
  estimatedP90Minutes: z.number().positive(),
  actualMinutes: z.number().nonnegative(),
  attemptNo: z.number().int().positive(),
  firstAttemptSuccess: z.boolean(),
  outcome: z.enum(['passing', 'failed', 'blocked', 'timed_out', 'cancelled', 'scope_changed', 'interrupted', 'unknown']),
  recordedAt: z.number().int().nonnegative(),
})

/** Derived local calibration cache; every row can be reconstructed from planning Session events. */
export const planningCalibrationDomainSpec = defineDomain({
  name: 'planning_calibration',
  version: 1,
  tables: {
    samples: domainTable<string, CalibrationSample>(calibrationSampleSchema),
  },
})
