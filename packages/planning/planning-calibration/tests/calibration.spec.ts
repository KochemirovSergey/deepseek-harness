import { describe, expect, it } from 'vitest'
import type { FeatureAttemptSnapshot } from '@deepseek-ai/dsh-planning'
import { criticalPath, estimate, isFirstAttemptSuccess, schedule } from '../src/index.ts'
import type { CalibrationSample } from '../src/index.ts'

const hash = 'a'.repeat(64)
const samples: CalibrationSample[] = Array.from({ length: 5 }, (_, index) => ({
  id: `sample-${index}`,
  featureId: `F-${index}`,
  workClass: 'runtime',
  workTags: ['typescript'],
  riskLevel: 'R2',
  estimatedP50Minutes: 30,
  estimatedP90Minutes: 60,
  actualMinutes: 20 + index * 5,
  attemptNo: 1,
  firstAttemptSuccess: index < 4,
  outcome: 'passing',
  recordedAt: index,
}))

describe('planning calibration estimator', () => {
  it('uses the narrowest sufficiently populated cohort and reports calibration metadata', () => {
    const result = estimate({ workClass: 'runtime', workTags: ['typescript'], riskLevel: 'R2' }, samples)
    expect(result).toMatchObject({ cohort: 'exact', sampleCount: 5, confidence: 'medium' })
    expect(result.p90Minutes).toBeGreaterThanOrEqual(result.p50Minutes)
    expect(result.firstAttemptSuccessRate).toBe(0.8)
  })

  it('preserves candidate order and excludes work above the 120-minute load capacity', () => {
    const recommendation = schedule([
      { featureId: 'A', contractSha256: hash, workClass: 'runtime', workTags: ['typescript'], riskLevel: 'R2' },
      { featureId: 'B', contractSha256: hash, workClass: 'unknown', workTags: [], riskLevel: 'R3', fallbackP50Minutes: 40, fallbackP90Minutes: 70 },
      { featureId: 'C', contractSha256: hash, workClass: 'unknown', workTags: [], riskLevel: 'R1', fallbackP50Minutes: 5, fallbackP90Minutes: 5 },
    ], samples, 0.6)
    expect(recommendation.capacityMinutes).toBe(72)
    expect(recommendation.entries.map(entry => entry.featureId)).toEqual(['A', 'C'])
    expect(recommendation.entries.map(entry => entry.position)).toEqual([1, 2])
    expect(recommendation.exclusions).toEqual([{ featureId: 'B', reason: 'capacity', p90Minutes: 52.2 }])
    expect(recommendation.reserveMinutes).toBeGreaterThanOrEqual(48)
  })

  it('uses the exact first-attempt-success definition', () => {
    const attempt = {
      attemptNo: 1,
      state: 'terminal',
      outcome: 'passing',
      verifierResult: 'PASS',
      manualIntervention: 'none',
      scopeStatus: 'within',
      durationMs: 50 * 60_000,
      estimate: { p50Minutes: 30, p90Minutes: 60, confidence: 'low', basis: 'prior' },
    } as FeatureAttemptSnapshot
    expect(isFirstAttemptSuccess(attempt)).toBe(true)
    expect(isFirstAttemptSuccess({ ...attempt, manualIntervention: 'present' })).toBe(false)
    expect(isFirstAttemptSuccess({ ...attempt, durationMs: 61 * 60_000 })).toBe(false)
    expect(isFirstAttemptSuccess({ ...attempt, attemptNo: 2 })).toBe(false)
  })
})

describe('criticalPath', () => {
  it('uses leaf unions and the longest causal path instead of summing parallel work', () => {
    const result = criticalPath([
      { id: 'attempt', kind: 'container', parentIds: [], startedAt: 0, endedAt: 120 },
      { id: 'job-a', kind: 'leaf', parentIds: ['attempt'], startedAt: 0, endedAt: 60 },
      { id: 'job-b', kind: 'leaf', parentIds: ['attempt'], startedAt: 0, endedAt: 40 },
      { id: 'verify', kind: 'leaf', parentIds: ['job-a'], startedAt: 60, endedAt: 100 },
    ])
    expect(result).toEqual({
      wallMs: 120,
      activeMs: 100,
      criticalPathMs: 100,
      overheadMs: 20,
      leafIds: ['job-a', 'job-b', 'verify'],
      criticalPathIds: ['attempt', 'job-a', 'verify'],
    })
  })

  it('rejects cycles and missing causal parents', () => {
    expect(() => criticalPath([
      { id: 'a', kind: 'leaf', parentIds: ['b'], startedAt: 0, endedAt: 1 },
      { id: 'b', kind: 'leaf', parentIds: ['a'], startedAt: 0, endedAt: 1 },
    ])).toThrow(/cycle/)
    expect(() => criticalPath([
      { id: 'a', kind: 'leaf', parentIds: ['missing'], startedAt: 0, endedAt: 1 },
    ])).toThrow(/missing parent/)
  })
})
