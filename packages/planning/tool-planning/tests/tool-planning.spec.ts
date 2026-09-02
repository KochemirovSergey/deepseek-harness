import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import PlanningService from '../../planning/src/index.ts'
import * as tool from '../src/index.ts'

const signal = new AbortController().signal
const hash = 'a'.repeat(64)
let calls = 0

function agent(id: string): Agent {
  const session = Session.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {}, followup: () => {}, steer: () => {}, cancel: () => {},
    inject(input) { inbox.append('next-step', input) },
    runMaintenance: task => task(signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(PlanningService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool)
  const owner = agent(`planning-tool-${Math.random()}`)
  ctx.agents.register(owner)
  return { ctx, owner }
}

function call(ctx: Context, owner: Agent, name: string, args: unknown) {
  return ctx.tools.execute({ signal, callId: CallId(`planning-call-${++calls}`), name, arguments: args, agent: owner })
}

function value(result: Awaited<ReturnType<typeof call>>): unknown {
  if (result.isError) throw new Error('tool failed')
  return JSON.parse((result.value as { json: string }).json)
}

describe('dsh-tool-planning', () => {
  it('registers the opt-in planning tool set and reports empty status', async () => {
    const { ctx, owner } = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('planning_')).sort()).toEqual([
      'planning_create_portfolio', 'planning_finish_attempt', 'planning_finish_slice',
      'planning_start_attempt', 'planning_start_slice', 'planning_status',
    ])
    expect(value(await call(ctx, owner, 'planning_status', {}))).toEqual({ attempts: [], slices: [], observationCount: 0 })
  })

  it('rejects unapproved portfolio and drives approved portfolio plus attempt', async () => {
    const { ctx, owner } = await setup()
    const entry = {
      feature_id: 'F-PLAN-001', contract_sha256: hash, position: 1,
      work_class: 'runtime', work_tags: ['planning'], risk_level: 'R2',
      p50_minutes: 30, p90_minutes: 60, confidence: 'low', estimate_basis: 'prior',
    }
    const denied = await call(ctx, owner, 'planning_create_portfolio', {
      proposal_id: 'PP-1', proposal_revision: 2, proposal_sha256: hash,
      load_target: 0.6, reserve_minutes: 60, entries: [entry],
    })
    expect(denied.isError).toBe(true)

    const staged = ctx.planning.stageProposal(owner, { id: 'PP-1', sha256: hash, summary: 'reviewed proposal' })
    const approved = ctx.planning.decideProposal(owner, {
      id: staged.id, revision: 1, sha256: hash, decision: 'approved', reviewId: 'review-1',
    })
    const portfolio = value(await call(ctx, owner, 'planning_create_portfolio', {
      proposal_id: approved.id, proposal_revision: approved.revision, proposal_sha256: approved.sha256,
      load_target: 0.6, reserve_minutes: 60, entries: [entry],
    })) as { id: string }
    const attempt = value(await call(ctx, owner, 'planning_start_attempt', {
      portfolio_id: portfolio.id, feature_id: 'F-PLAN-001', contract_sha256: hash,
      p50_minutes: 30, p90_minutes: 60, confidence: 'low', estimate_basis: 'prior',
    })) as { id: string; revision: number }
    const terminal = value(await call(ctx, owner, 'planning_finish_attempt', {
      attempt_id: attempt.id, revision: attempt.revision, outcome: 'passing',
      verifier_result: 'PASS', manual_intervention: 'none', scope_status: 'within',
    })) as { outcome: string }
    expect(terminal.outcome).toBe('passing')
  })
})
