/** Model-facing controls for an already approved adaptive-planning portfolio. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  ExecutionSliceId,
  FeatureAttemptId,
  PlanningConfidence,
  PlanningEstimate,
  PlanningOutcome,
  PlanningProposalId,
  PortfolioId,
} from '@deepseek-ai/dsh-planning'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-planning'
export const inject = ['planning', 'tools']

const OUTCOMES: PlanningOutcome[] = [
  'passing', 'failed', 'blocked', 'timed_out', 'cancelled', 'scope_changed', 'interrupted', 'unknown',
]
const CONFIDENCE: PlanningConfidence[] = ['low', 'medium', 'high']
const compactOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { json: { type: 'string', required: true } },
  },
  render: (_args: unknown, value: { json: string }) => [{ type: 'text' as const, text: value.json }],
} as const

function json(value: unknown): { json: string } {
  return { json: JSON.stringify(value) }
}

function owningAgent(exec: { readonly agent?: Agent }): Agent {
  if (exec.agent === undefined) throw new Error('planning tools require a live owning agent')
  return exec.agent
}

function estimate(args: {
  p50_minutes: number
  p90_minutes: number
  confidence: string
  estimate_basis: string
}): PlanningEstimate {
  return {
    p50Minutes: args.p50_minutes,
    p90Minutes: args.p90_minutes,
    confidence: args.confidence as PlanningConfidence,
    basis: args.estimate_basis,
  }
}

const estimateProperties = {
  p50_minutes: { type: 'number', required: true, description: 'Median duration estimate in minutes.' },
  p90_minutes: { type: 'number', required: true, description: 'Conservative duration estimate in minutes; must be at least p50.' },
  confidence: { type: 'string', required: true, enum: CONFIDENCE, description: 'Evidence confidence.' },
  estimate_basis: { type: 'string', required: true, description: 'Short explanation or cohort/prior reference.' },
} as const

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'planning_status',
    description: 'Read the current adaptive-planning proposal, approved portfolio, attempts, slices, and observation counts.',
    parameters: {},
    output: compactOutput,
    execute(_args, exec) {
      const view = ctx.planning.get(owningAgent(exec))
      return Promise.resolve(json({
        proposal: view.proposal,
        portfolio: view.portfolio,
        attempts: view.attempts,
        slices: view.slices,
        observationCount: view.observations.length,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'planning_create_portfolio',
    description: 'Create one 120-minute portfolio from the exact durable proposal approval. The service rejects conversational or stale approval.',
    parameters: {
      proposal_id: { type: 'string', required: true },
      proposal_revision: { type: 'number', required: true },
      proposal_sha256: { type: 'string', required: true },
      load_target: { type: 'number', required: true, description: 'Must be between 0.60 and 0.70.' },
      reserve_minutes: { type: 'number', required: true },
      entries: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            feature_id: { type: 'string', required: true },
            contract_sha256: { type: 'string', required: true },
            position: { type: 'number', required: true },
            work_class: { type: 'string', required: true },
            work_tags: { type: 'array', required: true, items: { type: 'string' } },
            risk_level: { type: 'string', required: true, enum: ['R0', 'R1', 'R2', 'R3'] },
            ...estimateProperties,
          },
        },
      },
    },
    output: compactOutput,
    execute(args, exec) {
      const portfolio = ctx.planning.createPortfolio(owningAgent(exec), {
        proposalId: args.proposal_id as PlanningProposalId,
        proposalRevision: args.proposal_revision,
        proposalSha256: args.proposal_sha256,
        loadTarget: args.load_target,
        reserveMinutes: args.reserve_minutes,
        entries: args.entries.map(entry => ({
          featureId: entry.feature_id,
          contractSha256: entry.contract_sha256,
          position: entry.position,
          workClass: entry.work_class,
          workTags: entry.work_tags,
          riskLevel: entry.risk_level,
          estimate: estimate(entry),
        })),
      })
      return Promise.resolve(json(portfolio))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'planning_start_attempt',
    description: 'Start the next attempt for one feature in the approved portfolio. Only one feature attempt may run.',
    parameters: {
      portfolio_id: { type: 'string', required: true },
      feature_id: { type: 'string', required: true },
      contract_sha256: { type: 'string', required: true },
      ...estimateProperties,
    },
    output: compactOutput,
    execute(args, exec) {
      return Promise.resolve(json(ctx.planning.startAttempt(owningAgent(exec), {
        portfolioId: args.portfolio_id as PortfolioId,
        featureId: args.feature_id,
        contractSha256: args.contract_sha256,
        estimate: estimate(args),
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'planning_finish_attempt',
    description: 'Close the exact running feature attempt with verifier, intervention, scope, and terminal outcome facts.',
    parameters: {
      attempt_id: { type: 'string', required: true },
      revision: { type: 'number', required: true },
      outcome: { type: 'string', required: true, enum: OUTCOMES },
      verifier_result: { type: 'string', required: true, enum: ['PASS', 'FAIL', 'unknown'] },
      manual_intervention: { type: 'string', required: true, enum: ['none', 'present', 'unknown'] },
      scope_status: { type: 'string', required: true, enum: ['within', 'violated', 'unknown'] },
    },
    output: compactOutput,
    execute(args, exec) {
      return Promise.resolve(json(ctx.planning.finishAttempt(owningAgent(exec), {
        id: args.attempt_id as FeatureAttemptId,
        revision: args.revision,
        outcome: args.outcome,
        verifierResult: args.verifier_result,
        manualIntervention: args.manual_intervention,
        scopeStatus: args.scope_status,
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'planning_start_slice',
    description: 'Start one execution slice under the running feature attempt. Target 5-15 minutes; explain any exception.',
    parameters: {
      attempt_id: { type: 'string', required: true },
      objective: { type: 'string', required: true },
      allowlist: { type: 'array', required: true, items: { type: 'string' } },
      expected_result: { type: 'string', required: true },
      budget_minutes: { type: 'number', required: true },
      budget_exception_reason: { type: 'string' },
    },
    output: compactOutput,
    execute(args, exec) {
      return Promise.resolve(json(ctx.planning.startSlice(owningAgent(exec), {
        attemptId: args.attempt_id as FeatureAttemptId,
        objective: args.objective,
        allowlist: args.allowlist,
        expectedResult: args.expected_result,
        budgetMinutes: args.budget_minutes,
        ...args.budget_exception_reason === undefined ? {} : { budgetExceptionReason: args.budget_exception_reason },
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'planning_finish_slice',
    description: 'Close the exact running execution slice with a terminal outcome.',
    parameters: {
      slice_id: { type: 'string', required: true },
      revision: { type: 'number', required: true },
      outcome: { type: 'string', required: true, enum: OUTCOMES },
    },
    output: compactOutput,
    execute(args, exec) {
      return Promise.resolve(json(ctx.planning.finishSlice(owningAgent(exec), {
        id: args.slice_id as ExecutionSliceId,
        revision: args.revision,
        outcome: args.outcome,
      })))
    },
  }))
}
