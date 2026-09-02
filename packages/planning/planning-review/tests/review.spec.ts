import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import PlanningService from '../../planning/src/index.ts'
import PlanningReviewService, { canonicalProposalJson, proposalSha256 } from '../src/index.ts'
import type { PlanningApproval } from '../src/index.ts'

const proposal = { proposal_id: 'PP-001', z: ['Привет', 2], a: { y: true, x: null } }

function owner(id: string): Agent {
  const session = Session.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id, options: {}, session, inbox, ctx: new Context(), status: 'idle',
    send: () => {}, followup: () => {}, steer: () => {}, cancel: () => {},
    inject(input) { inbox.append('next-step', input) },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function harness(answer: 'approve' | 'reject' = 'approve') {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(PlanningService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestions)
  await ctx.plugin(PlanningReviewService)
  const agent = owner(`planning-review-${Math.random()}`)
  ctx.agents.register(agent)
  const seen: unknown[] = []
  ctx.userQuestions.registerProvider({
    async ask(request) {
      seen.push(request.questions)
      const question = request.questions[0]!
      return { answers: [{ id: question.id, selected: [answer === 'approve' ? 'Approve exact proposal' : 'Reject'] }] }
    },
  })
  const applied = vi.fn(async () => ({ status: 'applied' }))
  ctx.planningReview.registerSource({ name: 'test', apply: applied })
  return { ctx, agent, seen, applied }
}

describe('PlanningReviewService', () => {
  it('canonicalizes recursively with the same compact sorted-key hash contract', () => {
    expect(canonicalProposalJson(proposal)).toBe('{"a":{"x":null,"y":true},"proposal_id":"PP-001","z":["Привет",2]}')
    expect(proposalSha256(proposal)).toBe(createHash('sha256').update(canonicalProposalJson(proposal)).digest('hex'))
    expect(proposalSha256(proposal)).toBe('e2d97fea76bf85500458b31d828e8673994bbe0db964a6b7bae1ce2651e88711')
    expect(() => proposalSha256({ proposal_id: 'x', bad: Number.NaN })).toThrow(/non-canonical number/)
  })

  it('binds UI approval, Session decision, adapter apply, and applied transition to one hash', async () => {
    const { ctx, agent, seen, applied } = await harness()
    const reviewed = await ctx.planningReview.review(agent, { source: 'test', summary: 'review me', proposal })
    expect(reviewed).toMatchObject({ decision: 'approved', proposal: { status: 'approved', revision: 2 } })
    expect(reviewed.approval).toMatchObject({
      decision: 'approved', proposal_id: 'PP-001', proposal_sha256: proposalSha256(proposal), session_id: agent.id,
    })
    expect(JSON.stringify(seen)).toContain(proposalSha256(proposal))
    const result = await ctx.planningReview.applyApproved(agent, {
      source: 'test', proposal, approval: reviewed.approval!,
    })
    expect(result).toEqual({ status: 'applied' })
    expect(applied).toHaveBeenCalledOnce()
    expect(ctx.planning.get(agent).proposal).toMatchObject({ status: 'applied', revision: 3 })
  })

  it('exposes the reviewed flow through the real guarded ToolRuntime', async () => {
    const { ctx, agent, applied } = await harness()
    const signal = new AbortController().signal
    const reviewedResult = await ctx.tools.execute({
      signal, callId: CallId('planning-review-tool-1'), name: 'planning_review_proposal', agent,
      arguments: { source: 'test', summary: 'tool review', proposal_json: JSON.stringify(proposal) },
    })
    expect(reviewedResult.isError).toBe(false)
    const reviewed = JSON.parse((reviewedResult.value as { json: string }).json) as { approval: PlanningApproval }
    const appliedResult = await ctx.tools.execute({
      signal, callId: CallId('planning-review-tool-2'), name: 'planning_apply_proposal', agent,
      arguments: {
        source: 'test', proposal_json: JSON.stringify(proposal), approval_json: JSON.stringify(reviewed.approval),
      },
    })
    expect(appliedResult.isError).toBe(false)
    expect(applied).toHaveBeenCalledOnce()
  })

  it('records rejection and never creates an apply artifact', async () => {
    const { ctx, agent, applied } = await harness('reject')
    const reviewed = await ctx.planningReview.review(agent, { source: 'test', summary: 'reject me', proposal })
    expect(reviewed).toMatchObject({ decision: 'rejected', proposal: { status: 'rejected' } })
    expect(reviewed.approval).toBeUndefined()
    expect(applied).not.toHaveBeenCalled()
  })

  it('rejects stale or conversationally fabricated apply artifacts', async () => {
    const { ctx, agent, applied } = await harness()
    const reviewed = await ctx.planningReview.review(agent, { source: 'test', summary: 'review me', proposal })
    await expect(ctx.planningReview.applyApproved(agent, {
      source: 'test', proposal: { ...proposal, extra: true }, approval: reviewed.approval!,
    })).rejects.toThrow(/exact durable proposal approval/)
    await expect(ctx.planningReview.applyApproved(agent, {
      source: 'test', proposal, approval: { ...reviewed.approval!, review_id: 'chat-said-yes' },
    })).rejects.toThrow(/exact durable proposal approval/)
    expect(applied).not.toHaveBeenCalled()
  })
})
