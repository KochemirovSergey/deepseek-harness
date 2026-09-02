import type {
  PlanningConfidence,
  PlanningEstimate,
  PlanningOutcome,
  PlanningRiskLevel,
} from '@deepseek-ai/dsh-planning'

/** Rebuildable metadata-only row derived from one terminal feature attempt. */
export interface CalibrationSample {
  readonly id: string
  readonly featureId: string
  readonly workClass: string
  readonly workTags: readonly string[]
  readonly riskLevel: PlanningRiskLevel
  readonly estimatedP50Minutes: number
  readonly estimatedP90Minutes: number
  readonly actualMinutes: number
  readonly attemptNo: number
  readonly firstAttemptSuccess: boolean
  readonly outcome: PlanningOutcome
  readonly recordedAt: number
}

/** Work cohort and optional priors used to request a calibrated estimate. */
export interface CalibrationEstimateRequest {
  readonly workClass: string
  readonly workTags: readonly string[]
  readonly riskLevel: PlanningRiskLevel
  readonly fallbackP50Minutes?: number
  readonly fallbackP90Minutes?: number
}

/** Estimate enriched with selected cohort, evidence size, error, and success rate. */
export interface CalibratedEstimate extends PlanningEstimate {
  readonly confidence: PlanningConfidence
  readonly sampleCount: number
  readonly cohort: 'exact' | 'class-risk' | 'class' | 'global' | 'prior'
  readonly meanAbsoluteErrorMinutes?: number
  readonly firstAttemptSuccessRate?: number
}

/** Priority-ordered accepted feature candidate presented to the scheduler. */
export interface ScheduleCandidate extends CalibrationEstimateRequest {
  readonly featureId: string
  readonly contractSha256: string
}

/** Admitted candidate with its preserved position and calibrated estimate. */
export interface ScheduleEntry extends ScheduleCandidate {
  readonly position: number
  readonly estimate: CalibratedEstimate
}

/** Candidate omitted because its p90 would exceed the configured capacity. */
export interface ScheduleExclusion {
  readonly featureId: string
  readonly reason: 'capacity'
  readonly p90Minutes: number
}

/** Priority-preserving recommendation for one fixed 120-minute horizon. */
export interface ScheduleRecommendation {
  readonly horizonMinutes: 120
  readonly loadTarget: number
  readonly capacityMinutes: number
  readonly reserveMinutes: number
  readonly entries: readonly ScheduleEntry[]
  readonly exclusions: readonly ScheduleExclusion[]
}

/** Causal trace node whose wall interval is a container or active leaf. */
export interface TraceInterval {
  readonly id: string
  readonly kind: 'container' | 'leaf'
  readonly parentIds: readonly string[]
  readonly startedAt: number
  readonly endedAt: number
}

/** Wall, active-union, overhead, and longest causal-path trace summary. */
export interface CriticalPathMetrics {
  readonly wallMs: number
  readonly activeMs: number
  readonly criticalPathMs: number
  readonly overheadMs: number
  readonly leafIds: readonly string[]
  readonly criticalPathIds: readonly string[]
}
