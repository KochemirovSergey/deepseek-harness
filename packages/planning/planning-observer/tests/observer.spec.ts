import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import type { JobOutcome, JobProgressUpdate } from '@deepseek-ai/dsh-jobs'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import PlanningService from '../../planning/src/index.ts'
import * as observer from '../src/index.ts'

function agent(ctx: Context, id: string, parent?: Agent): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, [], parent === undefined ? undefined : {
    version: 0,
    id: sessionId,
    createdAt: Date.now(),
    parentSession: parent.id,
    seedLength: 0,
    origin: 'subagent',
    delegationDepth: 1,
  })
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id,
    options: {}, session, inbox, ctx, status: 'idle',
    send: () => {}, followup: () => {}, steer: () => {}, cancel: () => {},
    inject(input) { inbox.append('next-step', input) },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function setup(withSubagents = false) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(PlanningService)
  await ctx.plugin(LocalJobRegistry)
  if (withSubagents) await ctx.plugin(SubagentRuntime)
  await ctx.plugin(observer)
  ctx.jobs.attachController('observer-test')
  const owner = agent(ctx, `observer-${Math.random()}`)
  ctx.agents.register(owner)
  return { ctx, owner }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('planning observer', () => {
  it('records metadata-only job start, progress, and monotonic terminal facts', async () => {
    const { ctx, owner } = await setup()
    let settle!: (outcome: JobOutcome) => void
    let progress!: (update: JobProgressUpdate) => void
    ctx.jobs.start({
      kind: 'bash',
      label: 'SECRET COMMAND LABEL',
      owner,
      run: () => ({
        cancel: () => {},
        done: new Promise((resolve) => { settle = resolve }),
        subscribeProgress(listener) { progress = listener; return () => {} },
      }),
    })
    progress({ phase: 'verify', completedUnits: 1, totalUnits: 2, message: 'SECRET PAYLOAD' })
    settle({ status: 'completed', output: 'SECRET OUTPUT' })
    await tick()
    const observations = ctx.planning.get(owner).observations
    expect(observations.map(item => [item.kind, item.phase])).toEqual([
      ['job', 'start'], ['job', 'progress'], ['job', 'terminal'],
    ])
    expect(observations.at(-1)).toMatchObject({ outcome: 'passing' })
    expect(observations.at(-1)?.durationMs).toBeGreaterThanOrEqual(0)
    const durable = JSON.stringify(owner.session.events)
    expect(durable).not.toContain('SECRET COMMAND LABEL')
    expect(durable).not.toContain('SECRET PAYLOAD')
    expect(durable).not.toContain('SECRET OUTPUT')
  })

  it('pairs subagent lifecycle observations to the parent without copying assistant output', async () => {
    const { ctx, owner } = await setup(true)
    const child = agent(ctx, 'observer-child', owner)
    ctx.agents.register(child)
    const runId = SubagentRunId('observer-run')
    const eventContext = ctx as unknown as { emit(name: string, info: unknown): void }
    eventContext.emit('subagent/start', { runId, provider: 'mock', id: child.id, local: true })
    eventContext.emit('subagent/end', {
      runId, provider: 'mock', id: child.id, local: true, stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'SECRET CHILD OUTPUT' }],
    })
    const observations = ctx.planning.get(owner).observations
    expect(observations.map(item => [item.kind, item.phase])).toEqual([
      ['delegation', 'start'], ['delegation', 'terminal'],
    ])
    expect(observations[1]).toMatchObject({ outcome: 'passing', parentObservationIds: [observations[0]?.id] })
    expect(JSON.stringify(owner.session.events)).not.toContain('SECRET CHILD OUTPUT')
  })
})
