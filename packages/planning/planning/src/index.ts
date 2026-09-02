/** Event-sourced adaptive planning service. */

import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyPlanningEvent,
  clonePlanningState,
  foldPlanning,
  planningView,
} from './fold.ts'
import type { PlanningFoldState } from './fold.ts'
import type {
  CreatePortfolioRequest,
  DecideProposalRequest,
  ExecutionSliceId,
  ExecutionSliceSnapshot,
  FeatureAttemptId,
  FeatureAttemptSnapshot,
  FinishAttemptRequest,
  FinishSliceRequest,
  PlanningEstimate,
  PlanningObservation,
  PlanningObservationId,
  PlanningProposalId,
  PlanningProposalSnapshot,
  PlanningView,
  PortfolioId,
  PortfolioSnapshot,
  StageProposalRequest,
  StartAttemptRequest,
  StartSliceRequest,
} from './types.ts'

export type * from './types.ts'
export { applyPlanningEvent, emptyPlanningState, foldPlanning, planningView } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    planning: PlanningService
  }
}

/** Stable error taxonomy for planning authority and lifecycle failures. */
export type PlanningErrorCode =
  | 'PLANNING_AGENT_NOT_LIVE'
  | 'PLANNING_INVALID_REQUEST'
  | 'PLANNING_STALE_REVISION'
  | 'PLANNING_INVALID_TRANSITION'
  | 'PLANNING_NOT_FOUND'

/** Error carrying a stable planning failure code. */
export class PlanningError extends Error {
  constructor(message: string, readonly code: PlanningErrorCode) {
    super(message)
    this.name = 'PlanningError'
  }
}

interface PlanningCache {
  readonly state: PlanningFoldState
  observedSeq: number
}

function text(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new PlanningError(`${label} must be non-empty`, 'PLANNING_INVALID_REQUEST')
  return value.trim()
}

function sha256(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new PlanningError(`${label} must be lowercase SHA-256`, 'PLANNING_INVALID_REQUEST')
  return value
}

function estimate(value: PlanningEstimate): PlanningEstimate {
  if (!Number.isFinite(value.p50Minutes) || value.p50Minutes <= 0
    || !Number.isFinite(value.p90Minutes) || value.p90Minutes < value.p50Minutes
    || !['low', 'medium', 'high'].includes(value.confidence)) {
    throw new PlanningError('estimate requires positive p50, p90 >= p50 and known confidence', 'PLANNING_INVALID_REQUEST')
  }
  return { ...value, basis: text(value.basis, 'estimate basis') }
}

function detachedStrings(values: readonly string[], label: string): string[] {
  if (values.some(value => typeof value !== 'string' || value.trim().length === 0)) {
    throw new PlanningError(`${label} must contain non-empty strings`, 'PLANNING_INVALID_REQUEST')
  }
  return [...new Set(values.map(value => value.trim()))]
}

/** Planning state owned by the exact live agent's Session log. */
export class PlanningService extends Service {
  static inject = ['agents']
  private readonly caches = new WeakMap<Session, PlanningCache>()
  private readonly monotonicStarts = new WeakMap<Session, Map<string, number>>()

  constructor(private readonly planningCtx: Context) {
    super(planningCtx, 'planning')
  }

  /**
   * Read current durable planning state.
   * @param agent - Exact live owner.
   * @returns Replayed planning view for its Session.
   */
  get(agent: Agent): PlanningView {
    return planningView(this.prepare(agent).state)
  }

  /**
   * Stage one immutable proposal.
   * @param agent - Exact live owner.
   * @param request - Immutable proposal identity.
   * @returns Staged revision.
   */
  stageProposal(agent: Agent, request: StageProposalRequest): PlanningProposalSnapshot {
    const cache = this.prepare(agent)
    const now = Date.now()
    const proposal: PlanningProposalSnapshot = {
      id: text(request.id, 'proposal id') as PlanningProposalId,
      revision: 1,
      sha256: sha256(request.sha256, 'proposal hash'),
      summary: text(request.summary, 'proposal summary'),
      status: 'staged',
      createdAt: now,
      updatedAt: now,
    }
    this.commit(agent.session, cache, 'planning/change', { version: 1, operation: 'stage', proposal })
    return proposal
  }

  /**
   * Decide the exact current proposal revision.
   * @param agent - Exact live owner.
   * @param request - Exact revision/hash decision.
   * @returns Advanced proposal.
   */
  decideProposal(agent: Agent, request: DecideProposalRequest): PlanningProposalSnapshot {
    const cache = this.prepare(agent)
    const current = cache.state.proposal
    if (current === undefined || current.id !== request.id) throw new PlanningError('proposal not found', 'PLANNING_NOT_FOUND')
    if (current.revision !== request.revision || current.sha256 !== request.sha256) {
      throw new PlanningError('proposal revision or hash is stale', 'PLANNING_STALE_REVISION')
    }
    if (request.decision === 'applied' && current.status !== 'approved') {
      throw new PlanningError('proposal must be approved before apply', 'PLANNING_INVALID_TRANSITION')
    }
    if (request.decision !== 'applied' && current.status !== 'staged') {
      throw new PlanningError('only staged proposal may be approved or rejected', 'PLANNING_INVALID_TRANSITION')
    }
    const proposal: PlanningProposalSnapshot = {
      ...current,
      revision: current.revision + 1,
      status: request.decision,
      reviewId: text(request.reviewId, 'review id'),
      updatedAt: Date.now(),
    }
    this.commit(agent.session, cache, 'planning/change', { version: 1, operation: 'decide', proposal })
    return proposal
  }

  /**
   * Materialize an approved capacity plan.
   * @param agent - Exact live owner.
   * @param request - Approved capacity plan.
   * @returns Created portfolio.
   */
  createPortfolio(agent: Agent, request: CreatePortfolioRequest): PortfolioSnapshot {
    const cache = this.prepare(agent)
    const proposal = cache.state.proposal
    if (proposal === undefined || proposal.status !== 'approved' || proposal.id !== request.proposalId
      || proposal.revision !== request.proposalRevision || proposal.sha256 !== request.proposalSha256) {
      throw new PlanningError('portfolio requires the exact approved proposal revision and hash', 'PLANNING_INVALID_TRANSITION')
    }
    if (!Number.isFinite(request.loadTarget) || request.loadTarget < 0.6 || request.loadTarget > 0.7) {
      throw new PlanningError('loadTarget must be between 0.6 and 0.7', 'PLANNING_INVALID_REQUEST')
    }
    if (request.entries.length === 0) {
      throw new PlanningError('portfolio requires at least one entry', 'PLANNING_INVALID_REQUEST')
    }
    const entries = request.entries.map(entry => ({
      featureId: text(entry.featureId, 'feature id'),
      contractSha256: sha256(entry.contractSha256, 'feature contract hash'),
      position: entry.position,
      workClass: text(entry.workClass, 'work class'),
      workTags: detachedStrings(entry.workTags, 'work tags'),
      riskLevel: entry.riskLevel,
      estimate: estimate(entry.estimate),
    }))
    if (entries.some(entry => !['R0', 'R1', 'R2', 'R3'].includes(entry.riskLevel))) {
      throw new PlanningError('portfolio entries require riskLevel R0-R3', 'PLANNING_INVALID_REQUEST')
    }
    if (entries.some((entry, index) => entry.position !== index + 1)) {
      throw new PlanningError('portfolio positions must be contiguous in array order', 'PLANNING_INVALID_REQUEST')
    }
    const totalP90 = entries.reduce((total, entry) => total + entry.estimate.p90Minutes, 0)
    if (totalP90 > 120 * request.loadTarget || Math.abs(request.reserveMinutes - (120 - totalP90)) > 1e-6) {
      throw new PlanningError('portfolio exceeds p90 capacity or reserve is inconsistent', 'PLANNING_INVALID_REQUEST')
    }
    const now = Date.now()
    const portfolio: PortfolioSnapshot = {
      id: `portfolio-${randomUUID()}` as PortfolioId,
      revision: 1,
      proposalId: proposal.id,
      proposalSha256: proposal.sha256,
      horizonMinutes: 120,
      loadTarget: request.loadTarget,
      reserveMinutes: request.reserveMinutes,
      phase: 'approved',
      entries,
      createdAt: now,
      updatedAt: now,
    }
    this.commit(agent.session, cache, 'planning/change', { version: 1, operation: 'create', portfolio })
    return portfolio
  }

  /**
   * Start one portfolio feature attempt.
   * @param agent - Exact live owner.
   * @param request - Portfolio feature attempt.
   * @returns Running attempt.
   */
  startAttempt(agent: Agent, request: StartAttemptRequest): FeatureAttemptSnapshot {
    const cache = this.prepare(agent)
    const portfolio = cache.state.portfolio
    if (portfolio === undefined || portfolio.id !== request.portfolioId) throw new PlanningError('portfolio not found', 'PLANNING_NOT_FOUND')
    const featureId = text(request.featureId, 'feature id')
    const contractSha256 = sha256(request.contractSha256, 'feature contract hash')
    const entry = portfolio.entries.find(candidate => candidate.featureId === featureId && candidate.contractSha256 === contractSha256)
    if (entry === undefined) throw new PlanningError('feature contract is not in the approved portfolio', 'PLANNING_INVALID_TRANSITION')
    const attemptNo = [...cache.state.attempts.values()].filter(candidate => candidate.featureId === featureId).length + 1
    const attempt: FeatureAttemptSnapshot = {
      id: `attempt-${randomUUID()}` as FeatureAttemptId,
      revision: 1,
      portfolioId: portfolio.id,
      featureId,
      contractSha256,
      workClass: entry.workClass,
      workTags: [...entry.workTags],
      riskLevel: entry.riskLevel,
      attemptNo,
      estimate: estimate(request.estimate),
      state: 'running',
      startedAt: Date.now(),
    }
    this.commit(agent.session, cache, 'planning/change', { version: 1, operation: 'start', attempt })
    this.starts(agent.session).set(attempt.id, performance.now())
    return attempt
  }

  /**
   * Close the exact running feature attempt.
   * @param agent - Exact live owner.
   * @param request - Terminal attempt facts.
   * @returns Terminal attempt.
   */
  finishAttempt(agent: Agent, request: FinishAttemptRequest): FeatureAttemptSnapshot {
    const cache = this.prepare(agent)
    const current = cache.state.attempts.get(request.id)
    if (current === undefined) throw new PlanningError('attempt not found', 'PLANNING_NOT_FOUND')
    if (current.revision !== request.revision || current.state !== 'running') {
      throw new PlanningError('attempt revision is stale or terminal', 'PLANNING_STALE_REVISION')
    }
    const started = this.starts(agent.session).get(current.id)
    const endedAt = Date.now()
    const attempt: FeatureAttemptSnapshot = {
      ...current,
      revision: current.revision + 1,
      state: 'terminal',
      endedAt,
      durationMs: started === undefined ? Math.max(0, endedAt - current.startedAt) : Math.max(0, performance.now() - started),
      outcome: request.outcome,
      verifierResult: request.verifierResult,
      manualIntervention: request.manualIntervention,
      scopeStatus: request.scopeStatus,
    }
    this.commit(agent.session, cache, 'planning/change', { version: 1, operation: 'finish', attempt })
    this.starts(agent.session).delete(current.id)
    return attempt
  }

  /**
   * Start one bounded execution slice.
   * @param agent - Exact live owner.
   * @param request - Bounded execution slice.
   * @returns Running slice.
   */
  startSlice(agent: Agent, request: StartSliceRequest): ExecutionSliceSnapshot {
    const cache = this.prepare(agent)
    const attempt = cache.state.attempts.get(request.attemptId)
    if (attempt === undefined || attempt.state !== 'running') throw new PlanningError('running attempt not found', 'PLANNING_NOT_FOUND')
    if (!Number.isFinite(request.budgetMinutes) || request.budgetMinutes <= 0) {
      throw new PlanningError('slice budget must be positive', 'PLANNING_INVALID_REQUEST')
    }
    const outsideTarget = request.budgetMinutes < 5 || request.budgetMinutes > 15
    const exception = request.budgetExceptionReason?.trim()
    if (outsideTarget && !exception) throw new PlanningError('slice outside 5-15 minutes requires budgetExceptionReason', 'PLANNING_INVALID_REQUEST')
    const slice: ExecutionSliceSnapshot = {
      id: `slice-${randomUUID()}` as ExecutionSliceId,
      revision: 1,
      attemptId: attempt.id,
      objective: text(request.objective, 'slice objective'),
      allowlist: detachedStrings(request.allowlist, 'slice allowlist'),
      expectedResult: text(request.expectedResult, 'slice expected result'),
      budgetMinutes: request.budgetMinutes,
      ...exception === undefined || exception === '' ? {} : { budgetExceptionReason: exception },
      state: 'running',
      startedAt: Date.now(),
    }
    this.commit(agent.session, cache, 'planning/change', { version: 1, operation: 'start', slice })
    this.starts(agent.session).set(slice.id, performance.now())
    return slice
  }

  /**
   * Close the exact running execution slice.
   * @param agent - Exact live owner.
   * @param request - Terminal slice facts.
   * @returns Terminal slice.
   */
  finishSlice(agent: Agent, request: FinishSliceRequest): ExecutionSliceSnapshot {
    const cache = this.prepare(agent)
    const current = cache.state.slices.get(request.id)
    if (current === undefined) throw new PlanningError('slice not found', 'PLANNING_NOT_FOUND')
    if (current.revision !== request.revision || current.state !== 'running') {
      throw new PlanningError('slice revision is stale or terminal', 'PLANNING_STALE_REVISION')
    }
    const endedAt = Date.now()
    const started = this.starts(agent.session).get(current.id)
    const slice: ExecutionSliceSnapshot = {
      ...current,
      revision: current.revision + 1,
      state: 'terminal',
      endedAt,
      durationMs: started === undefined ? Math.max(0, endedAt - current.startedAt) : Math.max(0, performance.now() - started),
      outcome: request.outcome,
    }
    this.commit(agent.session, cache, 'planning/change', { version: 1, operation: 'finish', slice })
    this.starts(agent.session).delete(current.id)
    return slice
  }

  /**
   * Append one metadata-only lifecycle fact.
   * @param agent - Exact live owner.
   * @param observation - Metadata-only fact.
   * @returns Durable observation snapshot.
   */
  observe(agent: Agent, observation: Omit<PlanningObservation, 'id' | 'observedAt'>): PlanningObservation {
    const cache = this.prepare(agent)
    const value: PlanningObservation = {
      ...observation,
      id: `observation-${randomUUID()}` as PlanningObservationId,
      externalId: text(observation.externalId, 'observation external id'),
      observedAt: Date.now(),
    }
    this.commit(agent.session, cache, 'planning/observation', { version: 1, observation: value })
    return value
  }

  private prepare(agent: Agent): PlanningCache {
    if (this.planningCtx.agents.get(agent.id) !== agent) throw new PlanningError(`agent "${agent.id}" is not live`, 'PLANNING_AGENT_NOT_LIVE')
    const cache = this.cache(agent.session)
    for (const event of agent.session.events.slice(cache.observedSeq)) {
      applyPlanningEvent(cache.state, event)
      cache.observedSeq += 1
    }
    return cache
  }

  private cache(session: Session): PlanningCache {
    let cache = this.caches.get(session)
    if (cache !== undefined) return cache
    cache = { state: foldPlanning(session.events), observedSeq: session.seq }
    this.caches.set(session, cache)
    return cache
  }

  private starts(session: Session): Map<string, number> {
    let starts = this.monotonicStarts.get(session)
    if (starts === undefined) {
      starts = new Map()
      this.monotonicStarts.set(session, starts)
    }
    return starts
  }

  private commit(
    session: Session,
    cache: PlanningCache,
    type: 'planning/change',
    data: import('./types.ts').PlanningEvent,
  ): void
  private commit(
    session: Session,
    cache: PlanningCache,
    type: 'planning/observation',
    data: import('./types.ts').PlanningObservationEvent,
  ): void
  private commit(
    session: Session,
    cache: PlanningCache,
    type: 'planning/change' | 'planning/observation',
    data: import('./types.ts').PlanningEvent | import('./types.ts').PlanningObservationEvent,
  ): void {
    const preflight = clonePlanningState(cache.state)
    applyPlanningEvent(preflight, {
      type,
      data,
      seq: session.seq,
      time: Date.now(),
    } as SessionEvent)
    const event = type === 'planning/change'
      ? session.append('planning/change', data as import('./types.ts').PlanningEvent)
      : session.append('planning/observation', data as import('./types.ts').PlanningObservationEvent)
    applyPlanningEvent(cache.state, event)
    cache.observedSeq = session.seq
  }
}

export default PlanningService
