import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import PlanningService, { foldPlanning, PlanningError } from '../src/index.ts'
import type { PlanningEstimate } from '../src/index.ts'

const HASH = 'a'.repeat(64)
const estimate: PlanningEstimate = { p50Minutes: 30, p90Minutes: 60, confidence: 'low', basis: 'prior' }

function stubAgent(rawId: string, seed?: readonly import('@deepseek-ai/dsh-session').SessionEvent[]): { agent: Agent; session: Session } {
  const session = Session.create(SessionId(rawId), seed)
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

async function harness(seed?: readonly import('@deepseek-ai/dsh-session').SessionEvent[]) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(PlanningService)
  const stub = stubAgent(`planning-test-${Math.random()}`, seed)
  ctx.agents.register(stub.agent)
  return { ctx, ...stub }
}

function portfolio(ctx: Context, agent: Agent) {
  const staged = ctx.planning.stageProposal(agent, { id: `PP-${Math.random()}`, sha256: HASH, summary: 'approved fixture' })
  const approved = ctx.planning.decideProposal(agent, {
    id: staged.id, revision: staged.revision, sha256: HASH, decision: 'approved', reviewId: 'review-fixture',
  })
  return ctx.planning.createPortfolio(agent, {
    proposalId: approved.id,
    proposalRevision: approved.revision,
    proposalSha256: approved.sha256,
    entries: [{ featureId: 'F-PLAN-001', contractSha256: HASH, position: 1, workClass: 'runtime', workTags: ['planning'], riskLevel: 'R2', estimate }],
    loadTarget: 0.6,
    reserveMinutes: 60,
  })
}

describe('PlanningService', () => {
  it('persists proposal decisions by exact revision and hash', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const { ctx, agent, session } = await harness()
    const staged = ctx.planning.stageProposal(agent, { id: 'PP-001', sha256: HASH, summary: 'one proposal' })
    expect(staged).toMatchObject({ revision: 1, status: 'staged', createdAt: 1_700_000_000_000 })
    expect(() => ctx.planning.decideProposal(agent, {
      id: staged.id, revision: staged.revision, sha256: 'b'.repeat(64), decision: 'approved', reviewId: 'review-1',
    })).toThrow(expect.objectContaining({ code: 'PLANNING_STALE_REVISION' }))
    const approved = ctx.planning.decideProposal(agent, {
      id: staged.id, revision: staged.revision, sha256: HASH, decision: 'approved', reviewId: 'review-1',
    })
    expect(approved).toMatchObject({ revision: 2, status: 'approved' })
    expect(foldPlanning(session.events).proposal).toMatchObject({ id: staged.id, status: 'approved' })
    vi.useRealTimers()
  })

  it('runs one attempt with bounded slices and terminal outcome metadata', async () => {
    const { ctx, agent, session } = await harness()
    const plan = portfolio(ctx, agent)
    const attempt = ctx.planning.startAttempt(agent, {
      portfolioId: plan.id, featureId: 'F-PLAN-001', contractSha256: HASH, estimate,
    })
    expect(() => ctx.planning.startAttempt(agent, {
      portfolioId: plan.id, featureId: 'F-PLAN-001', contractSha256: HASH, estimate,
    })).toThrow(/only one feature attempt/)
    expect(() => ctx.planning.startSlice(agent, {
      attemptId: attempt.id, objective: 'large slice', allowlist: ['src/'], expectedResult: 'done', budgetMinutes: 20,
    })).toThrow(/budgetExceptionReason/)
    const slice = ctx.planning.startSlice(agent, {
      attemptId: attempt.id,
      objective: 'bounded slice',
      allowlist: ['src/', 'src/'],
      expectedResult: 'one result',
      budgetMinutes: 10,
    })
    expect(slice.allowlist).toEqual(['src/'])
    const terminalSlice = ctx.planning.finishSlice(agent, { id: slice.id, revision: 1, outcome: 'passing' })
    expect(terminalSlice).toMatchObject({ revision: 2, state: 'terminal', outcome: 'passing' })
    const terminal = ctx.planning.finishAttempt(agent, {
      id: attempt.id,
      revision: 1,
      outcome: 'passing',
      verifierResult: 'PASS',
      manualIntervention: 'none',
      scopeStatus: 'within',
    })
    expect(terminal).toMatchObject({ revision: 2, state: 'terminal', outcome: 'passing', verifierResult: 'PASS' })
    expect(terminal.durationMs).toBeGreaterThanOrEqual(0)
    expect(session.deriveMessages()).toEqual([])
    expect(ctx.planning.get(agent).attempts).toHaveLength(1)
  })

  it('rejects capacity overflow and starts retries with monotonic attempt numbers', async () => {
    const { ctx, agent } = await harness()
    const staged = ctx.planning.stageProposal(agent, { id: 'PP-CAPACITY', sha256: HASH, summary: 'capacity fixture' })
    const approved = ctx.planning.decideProposal(agent, {
      id: staged.id, revision: staged.revision, sha256: HASH, decision: 'approved', reviewId: 'review-capacity',
    })
    expect(() => ctx.planning.createPortfolio(agent, {
      proposalId: approved.id,
      proposalRevision: approved.revision,
      proposalSha256: approved.sha256,
      entries: [{ featureId: 'F', contractSha256: HASH, position: 1, workClass: 'runtime', workTags: [], riskLevel: 'R2', estimate: { ...estimate, p90Minutes: 73 } }],
      loadTarget: 0.6,
      reserveMinutes: 47,
    })).toThrow(/exceeds p90 capacity/)
    const plan = portfolio(ctx, agent)
    const first = ctx.planning.startAttempt(agent, { portfolioId: plan.id, featureId: 'F-PLAN-001', contractSha256: HASH, estimate })
    ctx.planning.finishAttempt(agent, {
      id: first.id, revision: 1, outcome: 'failed', verifierResult: 'FAIL', manualIntervention: 'none', scopeStatus: 'within',
    })
    const retry = ctx.planning.startAttempt(agent, { portfolioId: plan.id, featureId: 'F-PLAN-001', contractSha256: HASH, estimate })
    expect(retry.attemptNo).toBe(2)
  })

  it('replays durable state in a new live Session instance', async () => {
    const first = await harness()
    const plan = portfolio(first.ctx, first.agent)
    first.ctx.planning.startAttempt(first.agent, {
      portfolioId: plan.id, featureId: 'F-PLAN-001', contractSha256: HASH, estimate,
    })
    const seed = first.session.events
    const replay = await harness(seed)
    expect(replay.ctx.planning.get(replay.agent)).toMatchObject({
      portfolio: { id: plan.id },
      attempts: [{ attemptNo: 1, state: 'running' }],
    })
  })

  it('rejects stale and non-live callers', async () => {
    const { ctx, agent } = await harness()
    const other = stubAgent('not-registered').agent
    expect(() => ctx.planning.get(other)).toThrow(PlanningError)
    const plan = portfolio(ctx, agent)
    const attempt = ctx.planning.startAttempt(agent, { portfolioId: plan.id, featureId: 'F-PLAN-001', contractSha256: HASH, estimate })
    ctx.planning.finishAttempt(agent, {
      id: attempt.id, revision: 1, outcome: 'cancelled', verifierResult: 'unknown', manualIntervention: 'unknown', scopeStatus: 'unknown',
    })
    expect(() => ctx.planning.finishAttempt(agent, {
      id: attempt.id, revision: 1, outcome: 'passing', verifierResult: 'PASS', manualIntervention: 'none', scopeStatus: 'within',
    })).toThrow(expect.objectContaining({ code: 'PLANNING_STALE_REVISION' }))
  })
})
