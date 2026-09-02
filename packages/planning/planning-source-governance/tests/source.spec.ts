import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PlanningReviewService, PlanningSourceAdapter } from '@deepseek-ai/dsh-planning-review'
import * as source from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function rootFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-governance-source-'))
  roots.push(root)
  await mkdir(join(root, 'scripts'))
  const script = join(root, 'scripts', 'adaptive_planning.py')
  await writeFile(script, [
    '#!/usr/bin/env python3',
    'import json, sys',
    'proposal = json.load(open(sys.argv[sys.argv.index("--proposal") + 1], encoding="utf-8"))',
    'approval = json.load(open(sys.argv[sys.argv.index("--approval") + 1], encoding="utf-8"))',
    'print(json.dumps({"status": "applied", "proposal_id": proposal["proposal_id"], "review_id": approval["review_id"]}))',
  ].join('\n') + '\n')
  await chmod(script, 0o700)
  return root
}

describe('planning governance source adapter', () => {
  it('registers one fixed source and passes proposal plus approval through temporary files', async () => {
    const root = await rootFixture()
    const ctx = new Context()
    let adapter: PlanningSourceAdapter | undefined
    const review = {
      registerSource(value: PlanningSourceAdapter) { adapter = value; return () => {} },
    } as unknown as PlanningReviewService
    await ctx.plugin({ apply(child: Context) { child.provide('planningReview', review) } })
    await ctx.plugin(source, { root, pythonBinary: 'python3', timeoutMs: 10_000 })
    expect(adapter?.name).toBe('data-platform-governance')
    const result = await adapter!.apply({
      proposal: { proposal_id: 'PP-TEST' },
      approval: {
        decision: 'approved', proposal_id: 'PP-TEST', proposal_sha256: 'a'.repeat(64),
        session_id: 'session-1', review_id: 'review-1', approved_at: '2026-01-01T00:00:00.000Z',
      },
    })
    expect(result).toEqual({ status: 'applied', proposal_id: 'PP-TEST', review_id: 'review-1' })
  })

  it('rejects a relative repository root at plugin activation', async () => {
    const ctx = new Context()
    const review = { registerSource: () => () => {} } as unknown as PlanningReviewService
    await ctx.plugin({ apply(child: Context) { child.provide('planningReview', review) } })
    await expect(ctx.plugin(source, { root: 'relative' })).rejects.toThrow(/must be absolute/)
  })
})
