/** Metadata-only bridges from job and subagent lifecycles into planning observations. */

import { performance } from 'node:perf_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { PlanningObservation, PlanningOutcome } from '@deepseek-ai/dsh-planning'
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'

export const name = 'planning-observer'
export const inject = ['planning']

interface RunStart {
  readonly parent: Agent
  readonly startedAt: number
  readonly monotonicStartedAt: number
  readonly startObservationId: PlanningObservation['id']
}

function contextOf(ctx: Context, owner: Agent): Pick<PlanningObservation, 'attemptId' | 'sliceId'> {
  const view = ctx.planning.get(owner)
  const attempt = view.attempts.find(candidate => candidate.state === 'running')
  const slice = view.slices.find(candidate => candidate.state === 'running')
  return {
    ...attempt === undefined ? {} : { attemptId: attempt.id },
    ...slice === undefined ? {} : { sliceId: slice.id },
  }
}

function jobOutcome(status: JobSnapshot['status']): PlanningOutcome | undefined {
  if (status === 'completed') return 'passing'
  if (status === 'killed') return 'cancelled'
  if (status === 'failed') return 'failed'
  return undefined
}

function subagentOutcome(reason: string): PlanningOutcome {
  if (reason === 'completed') return 'passing'
  if (reason === 'aborted') return 'cancelled'
  if (reason === 'max-tokens') return 'timed_out'
  if (reason === 'refusal') return 'blocked'
  if (reason === 'error') return 'failed'
  return 'unknown'
}

function safely(ctx: Context, owner: Agent, observation: Omit<PlanningObservation, 'id' | 'observedAt'>): PlanningObservation | undefined {
  try {
    return ctx.planning.observe(owner, observation)
  } catch (error: unknown) {
    ctx.logger.warn(`planning observer skipped observation: ${String(error)}`)
    return undefined
  }
}

function observeJobs(ctx: Context): () => void {
  const prior = new WeakMap<Agent, Map<string, JobSnapshot>>()
  const inspect = (owner: Agent): void => {
    const before = prior.get(owner) ?? new Map<string, JobSnapshot>()
    const after = new Map<string, JobSnapshot>()
    for (const snapshot of ctx.jobs.list(owner)) {
      if (snapshot.ownerSession !== owner.id || snapshot.kind === 'subagent') continue
      after.set(snapshot.id, snapshot)
      const previous = before.get(snapshot.id)
      if (previous === undefined) {
        safely(ctx, owner, {
          ...contextOf(ctx, owner),
          externalId: String(snapshot.id),
          kind: 'job',
          phase: 'start',
          startedAt: snapshot.startedAt,
          parentObservationIds: [],
          metadata: { jobKind: snapshot.kind },
        })
      }
      if (snapshot.progress !== undefined && snapshot.progress.updatedAt !== previous?.progress?.updatedAt) {
        safely(ctx, owner, {
          ...contextOf(ctx, owner),
          externalId: String(snapshot.id),
          kind: 'job',
          phase: 'progress',
          startedAt: snapshot.startedAt,
          parentObservationIds: [],
          metadata: {
            jobKind: snapshot.kind,
            ...snapshot.progress.phase === undefined ? {} : { phase: snapshot.progress.phase },
            ...snapshot.progress.completedUnits === undefined ? {} : { completedUnits: snapshot.progress.completedUnits },
            ...snapshot.progress.totalUnits === undefined ? {} : { totalUnits: snapshot.progress.totalUnits },
          },
        })
      }
      const outcome = jobOutcome(snapshot.status)
      if (outcome !== undefined && jobOutcome(previous?.status ?? 'running') === undefined) {
        safely(ctx, owner, {
          ...contextOf(ctx, owner),
          externalId: String(snapshot.id),
          kind: 'job',
          phase: 'terminal',
          startedAt: snapshot.startedAt,
          ...snapshot.finishedAt === undefined ? {} : { endedAt: snapshot.finishedAt },
          ...snapshot.durationMs === undefined ? {} : { durationMs: snapshot.durationMs },
          outcome,
          parentObservationIds: [],
          metadata: { jobKind: snapshot.kind },
        })
      }
    }
    prior.set(owner, after)
  }
  for (const owner of ctx.agents.list()) inspect(owner)
  return ctx.jobs.onJobsChanged((owner) => {
    if (owner !== undefined) inspect(owner)
  })
}

function observeSubagents(ctx: Context): () => void {
  const runs = new Map<string, RunStart>()
  const onStart = (info: SubagentRunInfo): void => {
    const child = ctx.agents.get(info.id)
    const parentId = child?.session.header.parentSession
    const parent = parentId === undefined ? undefined : ctx.agents.get(parentId)
    if (parent === undefined) return
    const startedAt = Date.now()
    const observation = safely(ctx, parent, {
      ...contextOf(ctx, parent),
      externalId: String(info.runId),
      kind: 'delegation',
      phase: 'start',
      startedAt,
      parentObservationIds: [],
      metadata: { provider: info.provider, childSessionId: String(info.id), local: info.local },
    })
    if (observation === undefined) return
    runs.set(info.runId, {
      parent,
      startedAt,
      monotonicStartedAt: performance.now(),
      startObservationId: observation.id,
    })
  }
  const onEnd = (info: SubagentRunEndInfo): void => {
    const run = runs.get(info.runId)
    if (run === undefined) return
    runs.delete(info.runId)
    safely(ctx, run.parent, {
      ...contextOf(ctx, run.parent),
      externalId: String(info.runId),
      kind: 'delegation',
      phase: 'terminal',
      startedAt: run.startedAt,
      endedAt: Date.now(),
      durationMs: Math.max(0, performance.now() - run.monotonicStartedAt),
      outcome: subagentOutcome(info.stopReason),
      parentObservationIds: [run.startObservationId],
      metadata: { provider: info.provider, childSessionId: String(info.id), local: info.local },
    })
  }
  const disposeStart = ctx.on('subagent/start', onStart, { global: true })
  const disposeEnd = ctx.on('subagent/end', onEnd, { global: true })
  return () => {
    disposeStart()
    disposeEnd()
    for (const [runId, run] of runs) {
      safely(ctx, run.parent, {
        ...contextOf(ctx, run.parent),
        externalId: runId,
        kind: 'delegation',
        phase: 'terminal',
        startedAt: run.startedAt,
        endedAt: Date.now(),
        durationMs: Math.max(0, performance.now() - run.monotonicStartedAt),
        outcome: 'interrupted',
        parentObservationIds: [run.startObservationId],
        metadata: { interruptedBy: 'observer_disposal' },
      })
    }
    runs.clear()
  }
}

export function apply(ctx: Context): void {
  ctx.inject(['jobs', 'agents'], (childCtx) => {
    const dispose = observeJobs(childCtx)
    childCtx.effect(() => dispose, 'planning-observer.jobs')
  })
  ctx.inject(['subagents', 'agents'], (childCtx) => {
    const dispose = observeSubagents(childCtx)
    childCtx.effect(() => dispose, 'planning-observer.subagents')
  })
}
