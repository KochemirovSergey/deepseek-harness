/** Strict replay fold for durable planning events. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  ExecutionSliceSnapshot,
  FeatureAttemptSnapshot,
  PlanningObservation,
  PlanningProposalSnapshot,
  PlanningView,
  PortfolioSnapshot,
} from './types.ts'

/** Mutable internal aggregates used while replaying immutable planning events. */
export interface PlanningFoldState {
  proposal?: PlanningProposalSnapshot
  portfolio?: PortfolioSnapshot
  readonly attempts: Map<string, FeatureAttemptSnapshot>
  readonly slices: Map<string, ExecutionSliceSnapshot>
  readonly observations: PlanningObservation[]
}

/**
 * Create a blank replay accumulator.
 * @returns A new empty planning replay state.
 */
export function emptyPlanningState(): PlanningFoldState {
  return { attempts: new Map(), slices: new Map(), observations: [] }
}

/**
 * Clone replay maps and arrays for append preflight validation.
 * @param state - Current durable replay state.
 * @returns Detached mutable replay state.
 */
export function clonePlanningState(state: PlanningFoldState): PlanningFoldState {
  return {
    ...state.proposal === undefined ? {} : { proposal: state.proposal },
    ...state.portfolio === undefined ? {} : { portfolio: state.portfolio },
    attempts: new Map(state.attempts),
    slices: new Map(state.slices),
    observations: [...state.observations],
  }
}

function positiveRevision(value: { readonly revision: number }, label: string): void {
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error(`${label} revision must be positive`)
}

function applyProposal(state: PlanningFoldState, proposal: PlanningProposalSnapshot, operation: 'stage' | 'decide'): void {
  positiveRevision(proposal, 'proposal')
  const current = state.proposal
  if (operation === 'stage') {
    if (proposal.revision !== 1 || proposal.status !== 'staged') throw new Error('staged proposal must begin at revision 1')
    if (current !== undefined && current.status === 'staged') throw new Error('cannot replace an undecided proposal')
  } else {
    if (current === undefined || current.id !== proposal.id || proposal.revision !== current.revision + 1) {
      throw new Error('proposal decision must advance the current proposal by one revision')
    }
    if (current.status !== 'staged' && !(current.status === 'approved' && proposal.status === 'applied')) {
      throw new Error(`cannot decide proposal from ${current.status}`)
    }
    if (proposal.sha256 !== current.sha256 || proposal.createdAt !== current.createdAt) {
      throw new Error('proposal decision changed immutable identity')
    }
  }
  state.proposal = proposal
}

function applyPortfolio(state: PlanningFoldState, portfolio: PortfolioSnapshot, operation: 'create' | 'phase'): void {
  positiveRevision(portfolio, 'portfolio')
  const current = state.portfolio
  if (operation === 'create') {
    if (current !== undefined) throw new Error('session already has a portfolio')
    if (portfolio.revision !== 1 || portfolio.phase !== 'approved') throw new Error('portfolio must begin approved at revision 1')
    if (state.proposal?.status !== 'approved' || state.proposal.id !== portfolio.proposalId
      || state.proposal.sha256 !== portfolio.proposalSha256) {
      throw new Error('portfolio requires the exact approved proposal')
    }
  } else {
    if (current === undefined || current.id !== portfolio.id || portfolio.revision !== current.revision + 1) {
      throw new Error('portfolio phase must advance current revision')
    }
    const allowed = current.phase === 'approved' ? 'running' : current.phase === 'running' ? 'completed' : undefined
    if (portfolio.phase !== allowed) throw new Error(`invalid portfolio phase ${current.phase} -> ${portfolio.phase}`)
    if (portfolio.createdAt !== current.createdAt || portfolio.proposalId !== current.proposalId
      || portfolio.proposalSha256 !== current.proposalSha256 || JSON.stringify(portfolio.entries) !== JSON.stringify(current.entries)) {
      throw new Error('portfolio phase changed immutable contract')
    }
  }
  state.portfolio = portfolio
}

function applyAttempt(state: PlanningFoldState, attempt: FeatureAttemptSnapshot, operation: 'start' | 'finish'): void {
  positiveRevision(attempt, 'attempt')
  const current = state.attempts.get(attempt.id)
  if (operation === 'start') {
    if (current !== undefined || attempt.revision !== 1 || attempt.state !== 'running') throw new Error('attempt must start once at revision 1')
    if ([...state.attempts.values()].some(candidate => candidate.state === 'running')) throw new Error('only one feature attempt may run')
    const portfolio = state.portfolio
    if (portfolio === undefined || portfolio.id !== attempt.portfolioId
      || !portfolio.entries.some(entry => entry.featureId === attempt.featureId && entry.contractSha256 === attempt.contractSha256)) {
      throw new Error('attempt feature is not in the current portfolio')
    }
  } else {
    if (current === undefined || current.state !== 'running' || attempt.state !== 'terminal'
      || attempt.revision !== current.revision + 1 || attempt.startedAt !== current.startedAt
      || attempt.contractSha256 !== current.contractSha256) {
      throw new Error('attempt finish must terminate the current running revision')
    }
  }
  state.attempts.set(attempt.id, attempt)
}

function applySlice(state: PlanningFoldState, slice: ExecutionSliceSnapshot, operation: 'start' | 'finish'): void {
  positiveRevision(slice, 'slice')
  const current = state.slices.get(slice.id)
  if (operation === 'start') {
    const attempt = state.attempts.get(slice.attemptId)
    if (current !== undefined || slice.revision !== 1 || slice.state !== 'running'
      || attempt === undefined || attempt.state !== 'running') throw new Error('slice must start once under a running attempt')
  } else if (current === undefined || current.state !== 'running' || slice.state !== 'terminal'
    || slice.revision !== current.revision + 1 || slice.startedAt !== current.startedAt) {
    throw new Error('slice finish must terminate the current running revision')
  }
  state.slices.set(slice.id, slice)
}

/**
 * Validate and apply one relevant Session event.
 * @param state - Mutable replay accumulator.
 * @param event - Candidate Session event; unrelated types are ignored.
 */
export function applyPlanningEvent(state: PlanningFoldState, event: SessionEvent): void {
  if (event.type === 'planning/observation') {
    const observation = event.data.observation
    if (state.observations.some(candidate => candidate.id === observation.id)) throw new Error('planning observation id must be unique')
    const known = new Set(state.observations.map(candidate => candidate.id))
    if (observation.parentObservationIds.some(parentId => !known.has(parentId))) {
      throw new Error('planning observation causal parents must precede the observation')
    }
    if (observation.durationMs !== undefined && (!Number.isFinite(observation.durationMs) || observation.durationMs < 0)) {
      throw new Error('planning observation duration must be non-negative')
    }
    if (observation.startedAt !== undefined && observation.endedAt !== undefined && observation.endedAt < observation.startedAt) {
      throw new Error('planning observation wall interval is inverted')
    }
    state.observations.push(observation)
    return
  }
  if (event.type !== 'planning/change') return
  const change = event.data
  if ('proposal' in change) applyProposal(state, change.proposal, change.operation)
  else if ('portfolio' in change) applyPortfolio(state, change.portfolio, change.operation)
  else if ('attempt' in change) applyAttempt(state, change.attempt, change.operation)
  else applySlice(state, change.slice, change.operation)
}

/**
 * Strictly replay a complete Session event sequence.
 * @param events - Ordered Session log.
 * @returns Current mutable aggregate state.
 */
export function foldPlanning(events: readonly SessionEvent[]): PlanningFoldState {
  const state = emptyPlanningState()
  for (const event of events) applyPlanningEvent(state, event)
  return state
}

/**
 * Project mutable replay storage into a detached public view.
 * @param state - Current replay accumulator.
 * @returns Immutable-style planning view arrays.
 */
export function planningView(state: PlanningFoldState): PlanningView {
  return {
    ...state.proposal === undefined ? {} : { proposal: state.proposal },
    ...state.portfolio === undefined ? {} : { portfolio: state.portfolio },
    attempts: [...state.attempts.values()],
    slices: [...state.slices.values()],
    observations: [...state.observations],
  }
}
