/** Pure durable and service types for adaptive planning. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable proposal identity within one Session planning log. */
export type PlanningProposalId = Branded<'PlanningProposalId'>
/** Stable approved-portfolio identity within one Session. */
export type PortfolioId = Branded<'PortfolioId'>
/** Stable identity for one numbered feature attempt. */
export type FeatureAttemptId = Branded<'FeatureAttemptId'>
/** Stable identity for one bounded execution slice. */
export type ExecutionSliceId = Branded<'ExecutionSliceId'>
/** Stable identity for one metadata-only causal observation. */
export type PlanningObservationId = Branded<'PlanningObservationId'>

/** Qualitative confidence attached to a planning estimate. */
export type PlanningConfidence = 'low' | 'medium' | 'high'
/** P50/p90 duration estimate and the evidence description that produced it. */
export interface PlanningEstimate {
  readonly p50Minutes: number
  readonly p90Minutes: number
  readonly confidence: PlanningConfidence
  readonly basis: string
}

/** Complete revisioned snapshot of one exact-hash proposal decision. */
export interface PlanningProposalSnapshot {
  readonly id: PlanningProposalId
  readonly revision: number
  readonly sha256: string
  readonly summary: string
  readonly status: 'staged' | 'approved' | 'rejected' | 'applied'
  readonly reviewId?: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** Governance risk route copied from the accepted source feature contract. */
export type PlanningRiskLevel = 'R0' | 'R1' | 'R2' | 'R3'

/** Immutable feature row admitted to an approved portfolio. */
export interface PortfolioEntry {
  readonly featureId: string
  readonly contractSha256: string
  readonly position: number
  readonly workClass: string
  readonly workTags: readonly string[]
  readonly riskLevel: PlanningRiskLevel
  readonly estimate: PlanningEstimate
}

/** Complete revisioned 120-minute portfolio snapshot. */
export interface PortfolioSnapshot {
  readonly id: PortfolioId
  readonly revision: number
  readonly proposalId: PlanningProposalId
  readonly proposalSha256: string
  readonly horizonMinutes: 120
  readonly loadTarget: number
  readonly reserveMinutes: number
  readonly phase: 'approved' | 'running' | 'completed'
  readonly entries: readonly PortfolioEntry[]
  readonly createdAt: number
  readonly updatedAt: number
}

/** Terminal result vocabulary shared by attempts, slices, jobs, and waits. */
export type PlanningOutcome =
  | 'passing'
  | 'failed'
  | 'blocked'
  | 'timed_out'
  | 'cancelled'
  | 'scope_changed'
  | 'interrupted'
  | 'unknown'

/** Complete running or terminal snapshot for one numbered feature attempt. */
export interface FeatureAttemptSnapshot {
  readonly id: FeatureAttemptId
  readonly revision: number
  readonly portfolioId: PortfolioId
  readonly featureId: string
  readonly contractSha256: string
  readonly workClass: string
  readonly workTags: readonly string[]
  readonly riskLevel: PlanningRiskLevel
  readonly attemptNo: number
  readonly estimate: PlanningEstimate
  readonly state: 'running' | 'terminal'
  readonly startedAt: number
  readonly endedAt?: number
  readonly durationMs?: number
  readonly outcome?: PlanningOutcome
  readonly verifierResult?: 'PASS' | 'FAIL' | 'unknown'
  readonly manualIntervention?: 'none' | 'present' | 'unknown'
  readonly scopeStatus?: 'within' | 'violated' | 'unknown'
}

/** Complete running or terminal snapshot for one bounded execution slice. */
export interface ExecutionSliceSnapshot {
  readonly id: ExecutionSliceId
  readonly revision: number
  readonly attemptId: FeatureAttemptId
  readonly objective: string
  readonly allowlist: readonly string[]
  readonly expectedResult: string
  readonly budgetMinutes: number
  readonly budgetExceptionReason?: string
  readonly state: 'running' | 'terminal'
  readonly startedAt: number
  readonly endedAt?: number
  readonly durationMs?: number
  readonly outcome?: PlanningOutcome
}

/** Lossless JSON value permitted in redacted planning observation metadata. */
export type PlanningMetadataValue =
  | string | number | boolean | null
  | readonly PlanningMetadataValue[]
  | { readonly [key: string]: PlanningMetadataValue }

/** Metadata-only causal execution fact used for traces and calibration. */
export interface PlanningObservation {
  readonly id: PlanningObservationId
  readonly attemptId?: FeatureAttemptId
  readonly sliceId?: ExecutionSliceId
  readonly kind: 'delegation' | 'job' | 'tool' | 'human_wait' | 'network_wait' | 'queue_wait' | 'unknown_wait'
  readonly externalId: string
  readonly phase: 'start' | 'progress' | 'terminal'
  readonly observedAt: number
  readonly startedAt?: number
  readonly endedAt?: number
  readonly durationMs?: number
  readonly outcome?: PlanningOutcome
  readonly parentObservationIds: readonly PlanningObservationId[]
  readonly metadata: { readonly [key: string]: PlanningMetadataValue }
}

/** Detached replay view over all current planning aggregates in one Session. */
export interface PlanningView {
  readonly proposal?: PlanningProposalSnapshot
  readonly portfolio?: PortfolioSnapshot
  readonly attempts: readonly FeatureAttemptSnapshot[]
  readonly slices: readonly ExecutionSliceSnapshot[]
  readonly observations: readonly PlanningObservation[]
}

/** Input for staging one immutable proposal identity. */
export interface StageProposalRequest {
  readonly id: string
  readonly sha256: string
  readonly summary: string
}
/** Compare-and-set proposal decision input. */
export interface DecideProposalRequest {
  readonly id: PlanningProposalId
  readonly revision: number
  readonly sha256: string
  readonly decision: 'approved' | 'rejected' | 'applied'
  readonly reviewId: string
}
/** Input for materializing one exact approved portfolio. */
export interface CreatePortfolioRequest {
  readonly proposalId: PlanningProposalId
  readonly proposalRevision: number
  readonly proposalSha256: string
  readonly entries: readonly PortfolioEntry[]
  readonly loadTarget: number
  readonly reserveMinutes: number
}
/** Input for starting the next attempt of an admitted feature. */
export interface StartAttemptRequest {
  readonly portfolioId: PortfolioId
  readonly featureId: string
  readonly contractSha256: string
  readonly estimate: PlanningEstimate
}
/** Input for terminating an exact running feature attempt revision. */
export interface FinishAttemptRequest {
  readonly id: FeatureAttemptId
  readonly revision: number
  readonly outcome: PlanningOutcome
  readonly verifierResult: 'PASS' | 'FAIL' | 'unknown'
  readonly manualIntervention: 'none' | 'present' | 'unknown'
  readonly scopeStatus: 'within' | 'violated' | 'unknown'
}
/** Input for starting a bounded slice under the running attempt. */
export interface StartSliceRequest {
  readonly attemptId: FeatureAttemptId
  readonly objective: string
  readonly allowlist: readonly string[]
  readonly expectedResult: string
  readonly budgetMinutes: number
  readonly budgetExceptionReason?: string
}
/** Input for terminating an exact running slice revision. */
export interface FinishSliceRequest {
  readonly id: ExecutionSliceId
  readonly revision: number
  readonly outcome: PlanningOutcome
}

/** Versioned complete-snapshot event union for planning aggregate transitions. */
export type PlanningEvent =
  | { readonly version: 1; readonly operation: 'stage' | 'decide'; readonly proposal: PlanningProposalSnapshot }
  | { readonly version: 1; readonly operation: 'create' | 'phase'; readonly portfolio: PortfolioSnapshot }
  | { readonly version: 1; readonly operation: 'start' | 'finish'; readonly attempt: FeatureAttemptSnapshot }
  | { readonly version: 1; readonly operation: 'start' | 'finish'; readonly slice: ExecutionSliceSnapshot }

/** Versioned Session envelope for one metadata-only observation. */
export interface PlanningObservationEvent {
  readonly version: 1
  readonly observation: PlanningObservation
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Records one complete versioned proposal, portfolio, attempt, or slice lifecycle snapshot. */
    'planning/change': PlanningEvent
    /** Records one metadata-only causal execution observation for calibration and trace analysis. */
    'planning/observation': PlanningObservationEvent
  }
}
