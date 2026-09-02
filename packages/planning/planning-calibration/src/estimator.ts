import type { FeatureAttemptSnapshot } from '@deepseek-ai/dsh-planning'
import type {
  CalibratedEstimate,
  CalibrationEstimateRequest,
  CalibrationSample,
  ScheduleCandidate,
  ScheduleRecommendation,
} from './types.ts'

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) throw new Error('quantile requires samples')
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * probability
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const lowerValue = sorted[lower]
  const upperValue = sorted[upper]
  if (lowerValue === undefined || upperValue === undefined) throw new Error('quantile index is out of bounds')
  if (lower === upper) return lowerValue
  return lowerValue * (upper - index) + upperValue * (index - lower)
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Classify exact first-attempt success: PASS, within p90, unchanged scope, and no intervention.
 * @param attempt - Terminal or running feature attempt snapshot.
 * @returns Whether all strict first-success conditions hold.
 */
export function isFirstAttemptSuccess(attempt: FeatureAttemptSnapshot): boolean {
  return attempt.attemptNo === 1
    && attempt.state === 'terminal'
    && attempt.durationMs !== undefined
    && attempt.outcome === 'passing'
    && attempt.verifierResult === 'PASS'
    && attempt.manualIntervention === 'none'
    && attempt.scopeStatus === 'within'
    && attempt.durationMs <= attempt.estimate.p90Minutes * 60_000
}

/**
 * Derive one rebuildable sample from a terminal attempt.
 * @param sessionId - Owning Session identity used for idempotency.
 * @param attempt - Candidate feature attempt.
 * @returns A calibration row, or undefined while the attempt is incomplete.
 */
export function sampleFromAttempt(sessionId: string, attempt: FeatureAttemptSnapshot): CalibrationSample | undefined {
  if (attempt.state !== 'terminal' || attempt.durationMs === undefined || attempt.endedAt === undefined) return undefined
  return {
    id: `${sessionId}:${attempt.id}`,
    featureId: attempt.featureId,
    workClass: attempt.workClass,
    workTags: [...attempt.workTags],
    riskLevel: attempt.riskLevel,
    estimatedP50Minutes: attempt.estimate.p50Minutes,
    estimatedP90Minutes: attempt.estimate.p90Minutes,
    actualMinutes: attempt.durationMs / 60_000,
    attemptNo: attempt.attemptNo,
    firstAttemptSuccess: isFirstAttemptSuccess(attempt),
    outcome: attempt.outcome ?? 'unknown',
    recordedAt: attempt.endedAt,
  }
}

/**
 * Estimate with hierarchical cohort fallback and shrinkage toward caller/default priors.
 * @param request - Work cohort and optional prior values.
 * @param samples - Current rebuildable calibration rows.
 * @returns Calibrated p50/p90 plus evidence metadata.
 */
export function estimate(
  request: CalibrationEstimateRequest,
  samples: readonly CalibrationSample[],
): CalibratedEstimate {
  const valid = samples.filter(sample => Number.isFinite(sample.actualMinutes) && sample.actualMinutes >= 0)
  const exact = valid.filter(sample => sample.workClass === request.workClass
    && sample.riskLevel === request.riskLevel && sameTags(sample.workTags, request.workTags))
  const classRisk = valid.filter(sample => sample.workClass === request.workClass && sample.riskLevel === request.riskLevel)
  const workClass = valid.filter(sample => sample.workClass === request.workClass)
  const [cohort, selected] = exact.length >= 3
    ? ['exact', exact] as const
    : classRisk.length >= 3
      ? ['class-risk', classRisk] as const
      : workClass.length >= 3
        ? ['class', workClass] as const
        : valid.length > 0
          ? ['global', valid] as const
          : ['prior', []] as const
  const priorP50 = finitePositive(request.fallbackP50Minutes, 30)
  const priorP90 = Math.max(priorP50, finitePositive(request.fallbackP90Minutes, 60))
  if (selected.length === 0) {
    return {
      p50Minutes: priorP50,
      p90Minutes: priorP90,
      confidence: 'low',
      basis: 'hierarchical prior; no calibration samples',
      sampleCount: 0,
      cohort,
    }
  }
  const actuals = selected.map(sample => sample.actualMinutes)
  const weight = selected.length / (selected.length + 4)
  const p50 = priorP50 * (1 - weight) + quantile(actuals, 0.5) * weight
  const p90 = Math.max(p50, priorP90 * (1 - weight) + quantile(actuals, 0.9) * weight)
  const meanAbsoluteError = selected.reduce(
    (sum, sample) => sum + Math.abs(sample.actualMinutes - sample.estimatedP50Minutes),
    0,
  ) / selected.length
  return {
    p50Minutes: Math.round(p50 * 10) / 10,
    p90Minutes: Math.round(p90 * 10) / 10,
    confidence: cohort === 'exact' && selected.length >= 20 ? 'high' : selected.length >= 5 ? 'medium' : 'low',
    basis: `${cohort} cohort with ${selected.length} sample(s), shrunk toward prior`,
    sampleCount: selected.length,
    cohort,
    meanAbsoluteErrorMinutes: Math.round(meanAbsoluteError * 10) / 10,
    firstAttemptSuccessRate: selected.filter(sample => sample.firstAttemptSuccess).length / selected.length,
  }
}

/**
 * Recommend a capacity-safe portfolio without reordering supplied priority.
 * @param candidates - Priority-ordered accepted feature candidates.
 * @param samples - Current rebuildable calibration rows.
 * @param loadTarget - Admitted fraction of the 120-minute horizon.
 * @returns Entries and capacity exclusions in source order.
 */
export function schedule(
  candidates: readonly ScheduleCandidate[],
  samples: readonly CalibrationSample[],
  loadTarget = 0.65,
): ScheduleRecommendation {
  if (!Number.isFinite(loadTarget) || loadTarget < 0.6 || loadTarget > 0.7) {
    throw new Error('planning load target must be between 0.6 and 0.7')
  }
  const capacityMinutes = 120 * loadTarget
  let used = 0
  const entries = []
  const exclusions = []
  for (const candidate of candidates) {
    const calibrated = estimate(candidate, samples)
    if (used + calibrated.p90Minutes > capacityMinutes) {
      exclusions.push({ featureId: candidate.featureId, reason: 'capacity' as const, p90Minutes: calibrated.p90Minutes })
      continue
    }
    used += calibrated.p90Minutes
    entries.push({ ...candidate, position: entries.length + 1, estimate: calibrated })
  }
  return {
    horizonMinutes: 120,
    loadTarget,
    capacityMinutes,
    reserveMinutes: 120 - used,
    entries,
    exclusions,
  }
}
