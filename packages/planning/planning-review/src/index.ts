/** Exact-hash human proposal review and source-adapter application. */

import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PlanningProposalSnapshot } from '@deepseek-ai/dsh-planning'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'

/** Exact approved proposal artifact accepted by repository adapters. */
export interface PlanningApproval {
  readonly decision: 'approved'
  readonly proposal_id: string
  readonly proposal_sha256: string
  readonly session_id: string
  readonly review_id: string
  readonly approved_at: string
}

/** Complete source-adapter input after durable approval verification. */
export interface PlanningApplyRequest {
  readonly proposal: Record<string, unknown>
  readonly approval: PlanningApproval
}

/** Deployment-owned named boundary that atomically mutates one source authority. */
export interface PlanningSourceAdapter {
  readonly name: string
  apply(request: PlanningApplyRequest): Promise<unknown>
}

/** Human decision plus the durable snapshot and optional approval artifact. */
export interface PlanningReviewResult {
  readonly decision: 'approved' | 'rejected'
  readonly proposal: PlanningProposalSnapshot
  readonly approval?: PlanningApproval
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    planningReview: PlanningReviewService
  }
}

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error('proposal contains a non-canonical number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('proposal contains a cycle')
    seen.add(value)
    const result = `[${value.map(item => canonical(item, seen)).join(',')}]`
    seen.delete(value)
    return result
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (Object.getPrototypeOf(object) !== Object.prototype || seen.has(object)) {
      throw new Error('proposal must contain only plain JSON objects')
    }
    seen.add(object)
    const parts = Object.keys(object).sort().map((key) => {
      const item = object[key]
      if (item === undefined) throw new Error('proposal contains undefined')
      return `${JSON.stringify(key)}:${canonical(item, seen)}`
    })
    seen.delete(object)
    return `{${parts.join(',')}}`
  }
  throw new Error(`proposal contains unsupported ${typeof value}`)
}

/**
 * Canonicalize a plain JSON proposal with recursively sorted object keys.
 * @param proposal - Complete proposal document.
 * @returns Compact UTF-8-ready canonical JSON text.
 */
export function canonicalProposalJson(proposal: unknown): string {
  return canonical(proposal)
}

/**
 * Hash one canonical proposal document.
 * @param proposal - Complete proposal document.
 * @returns Lowercase hexadecimal SHA-256.
 */
export function proposalSha256(proposal: unknown): string {
  return createHash('sha256').update(canonicalProposalJson(proposal), 'utf8').digest('hex')
}

function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} root must be an object`)
  return value as Record<string, unknown>
}

function parseApproval(value: Record<string, unknown>): PlanningApproval {
  if (value.decision !== 'approved') throw new Error('approval decision must be approved')
  for (const key of ['proposal_id', 'proposal_sha256', 'session_id', 'review_id', 'approved_at'] as const) {
    if (typeof value[key] !== 'string' || value[key].length === 0) throw new Error(`approval is missing ${key}`)
  }
  return value as unknown as PlanningApproval
}

function json(value: unknown): { json: string } {
  return { json: JSON.stringify(value) }
}

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      json: { type: 'string', required: true },
    },
  },
  render(_args: unknown, value: { json: string }) {
    return [{ type: 'text' as const, text: value.json }]
  },
} as const

/** Portable authority boundary; deployment adapters own source mutation. */
export class PlanningReviewService extends Service {
  static inject = ['planning', 'userQuestions', 'tools']
  private readonly sources = new Map<string, PlanningSourceAdapter>()

  constructor(ctx: Context) {
    super(ctx, 'planningReview')
    ctx.tools.register(defineTool({
      name: 'planning_review_proposal',
      description: 'Submit a complete planning proposal JSON document for exact-hash human review. Ordinary chat approval is not accepted.',
      parameters: {
        source: { type: 'string', required: true },
        summary: { type: 'string', required: true },
        proposal_json: { type: 'string', required: true },
      },
      output,
      execute: async (args, exec) => json(await this.review(this.requireAgent(exec.agent), {
        source: args.source,
        summary: args.summary,
        proposal: parseObject(args.proposal_json, 'proposal_json'),
        signal: exec.signal,
      })),
    }))
    ctx.tools.register(defineTool({
      name: 'planning_apply_proposal',
      description: 'Apply an exact proposal through its registered source adapter. Requires the durable approval artifact returned by planning_review_proposal.',
      parameters: {
        source: { type: 'string', required: true },
        proposal_json: { type: 'string', required: true },
        approval_json: { type: 'string', required: true },
      },
      output,
      execute: async (args, exec) => json(await this.applyApproved(this.requireAgent(exec.agent), {
        source: args.source,
        proposal: parseObject(args.proposal_json, 'proposal_json'),
        approval: parseApproval(parseObject(args.approval_json, 'approval_json')),
      })),
    }))
  }

  /**
   * Register one deployment-owned source boundary.
   * @param adapter - Named deployment source boundary.
   * @returns Registration disposer.
   */
  registerSource(adapter: PlanningSourceAdapter): () => void {
    if (adapter.name.trim().length === 0 || this.sources.has(adapter.name)) throw new Error(`invalid or duplicate planning source ${JSON.stringify(adapter.name)}`)
    this.sources.set(adapter.name, adapter)
    const dispose = this.ctx.effect(() => () => { this.sources.delete(adapter.name) }, `planning source ${adapter.name}`)
    return () => { void dispose() }
  }

  /**
   * List available source boundaries.
   * @returns Registered source names in stable order.
   */
  listSources(): string[] {
    return [...this.sources.keys()].sort()
  }

  /**
   * Ask a human to decide one complete canonical proposal.
   * @param agent - Exact live human-facing owner.
   * @param request - Complete proposal and source identity.
   * @returns Durable exact-hash review result.
   */
  async review(agent: Agent, request: {
    readonly source: string
    readonly summary: string
    readonly proposal: Record<string, unknown>
    readonly signal?: AbortSignal
  }): Promise<PlanningReviewResult> {
    if (!this.sources.has(request.source)) throw new Error(`unknown planning source ${JSON.stringify(request.source)}`)
    const proposalId = request.proposal.proposal_id
    if (typeof proposalId !== 'string' || proposalId.length === 0) throw new Error('proposal_json requires proposal_id')
    const sha256 = proposalSha256(request.proposal)
    const current = this.ctx.planning.get(agent).proposal
    const staged = current?.id === proposalId && current.sha256 === sha256 && current.status === 'staged'
      ? current
      : this.ctx.planning.stageProposal(agent, { id: proposalId, sha256, summary: request.summary })
    const approve = 'Approve exact proposal'
    const answer = await this.ctx.userQuestions.ask({
      agent,
      ...request.signal === undefined ? {} : { signal: request.signal },
      questions: [{
        id: `planning-review:${proposalId}:${sha256.slice(0, 12)}`,
        header: 'Adaptive planning review',
        question: `Approve proposal ${proposalId} at SHA-256 ${sha256}?`,
        detail: `Source: ${request.source}\n\n\`\`\`json\n${JSON.stringify(request.proposal, null, 2)}\n\`\`\``,
        options: [
          { label: approve, description: 'Authorize only this canonical proposal hash.' },
          { label: 'Reject', description: 'Record rejection; no source files may change.' },
        ],
        intent: { kind: 'plan-review', approve },
      }],
    })
    const accepted = answer.answers.some(item => item.id.startsWith('planning-review:') && item.selected.includes(approve))
    const reviewId = `planning-review-${randomUUID()}`
    const proposal = this.ctx.planning.decideProposal(agent, {
      id: staged.id,
      revision: staged.revision,
      sha256,
      decision: accepted ? 'approved' : 'rejected',
      reviewId,
    })
    if (!accepted) return { decision: 'rejected', proposal }
    return {
      decision: 'approved',
      proposal,
      approval: {
        decision: 'approved',
        proposal_id: proposalId,
        proposal_sha256: sha256,
        session_id: String(agent.session.id),
        review_id: reviewId,
        approved_at: new Date().toISOString(),
      },
    }
  }

  /**
   * Apply one exact durably approved proposal.
   * @param agent - Exact live approval owner.
   * @param request - Proposal plus approval artifact.
   * @returns Source adapter result.
   */
  async applyApproved(agent: Agent, request: {
    readonly source: string
    readonly proposal: Record<string, unknown>
    readonly approval: PlanningApproval
  }): Promise<unknown> {
    const adapter = this.sources.get(request.source)
    if (adapter === undefined) throw new Error(`unknown planning source ${JSON.stringify(request.source)}`)
    const hash = proposalSha256(request.proposal)
    const current = this.ctx.planning.get(agent).proposal
    if (current === undefined || current.status !== 'approved' || current.id !== request.approval.proposal_id
      || current.sha256 !== hash || request.approval.proposal_sha256 !== hash
      || request.approval.session_id !== String(agent.session.id) || current.reviewId !== request.approval.review_id) {
      throw new Error('apply requires the exact durable proposal approval')
    }
    const result = await adapter.apply({ proposal: request.proposal, approval: request.approval })
    this.ctx.planning.decideProposal(agent, {
      id: current.id,
      revision: current.revision,
      sha256: hash,
      decision: 'applied',
      reviewId: request.approval.review_id,
    })
    return result
  }

  private requireAgent(agent: Agent | undefined): Agent {
    if (agent === undefined) throw new Error('planning review tools require a live owning agent')
    return agent
  }
}

export default PlanningReviewService
