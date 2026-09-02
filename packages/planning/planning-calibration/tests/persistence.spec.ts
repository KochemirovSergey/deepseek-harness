import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import PlanningService from '../../planning/src/index.ts'
import PlanningCalibrationService from '../src/index.ts'

const roots: string[] = []
const hash = 'a'.repeat(64)

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function owner(session: Session): Agent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id, options: {}, session, inbox, ctx: new Context(), status: 'idle',
    send: () => {}, followup: () => {}, steer: () => {}, cancel: () => {},
    inject(input) { inbox.append('next-step', input) },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-planning-calibration-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json', routes: {} })
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(PlanningService)
  await ctx.plugin(PlanningCalibrationService)
  const session = ctx.sessions.create(SessionId(`calibration-${Math.random()}`))
  const agent = owner(session)
  ctx.agents.register(agent)
  return { ctx, agent }
}

describe('PlanningCalibrationService persistence', () => {
  it('derives one idempotent sample from a terminal attempt and estimates from storage', async () => {
    const { ctx, agent } = await harness()
    const staged = ctx.planning.stageProposal(agent, { id: 'PP-CAL', sha256: hash, summary: 'calibration' })
    const approved = ctx.planning.decideProposal(agent, {
      id: staged.id, revision: 1, sha256: hash, decision: 'approved', reviewId: 'review-cal',
    })
    const portfolio = ctx.planning.createPortfolio(agent, {
      proposalId: approved.id, proposalRevision: approved.revision, proposalSha256: hash,
      loadTarget: 0.6, reserveMinutes: 60,
      entries: [{
        featureId: 'F-CAL', contractSha256: hash, position: 1,
        workClass: 'runtime', workTags: ['typescript'], riskLevel: 'R2',
        estimate: { p50Minutes: 30, p90Minutes: 60, confidence: 'low', basis: 'prior' },
      }],
    })
    const attempt = ctx.planning.startAttempt(agent, {
      portfolioId: portfolio.id, featureId: 'F-CAL', contractSha256: hash,
      estimate: { p50Minutes: 30, p90Minutes: 60, confidence: 'low', basis: 'prior' },
    })
    ctx.planning.finishAttempt(agent, {
      id: attempt.id, revision: 1, outcome: 'passing', verifierResult: 'PASS',
      manualIntervention: 'none', scopeStatus: 'within',
    })
    await vi.waitFor(() => { expect(ctx.planningCalibration.samples()).toHaveLength(1) })
    expect(ctx.planningCalibration.samples()[0]).toMatchObject({
      featureId: 'F-CAL', workClass: 'runtime', riskLevel: 'R2', attemptNo: 1, firstAttemptSuccess: true,
    })
    expect(await ctx.planningCalibration.ingestSession(agent.session)).toBe(1)
    expect(ctx.planningCalibration.samples()).toHaveLength(1)
    expect(ctx.planningCalibration.estimate({
      workClass: 'runtime', workTags: ['typescript'], riskLevel: 'R2',
    }).sampleCount).toBe(1)
  })
})
