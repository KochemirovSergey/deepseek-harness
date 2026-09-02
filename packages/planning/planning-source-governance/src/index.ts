/** Local adapter for data-platform-governance's atomic adaptive_planning.py boundary. */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PlanningSourceAdapter } from '@deepseek-ai/dsh-planning-review'

const execute = promisify(execFile)
export const name = 'planning-source-governance'
export const inject = ['planningReview']

/** Deployment configuration for the fixed local governance subprocess adapter. */
export interface Config {
  /** Absolute data-platform-governance repository root. */
  readonly root: string
  /** Python executable used without a shell. */
  readonly pythonBinary?: string
  /** Maximum atomic adapter subprocess duration in milliseconds. */
  readonly timeoutMs?: number
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
  pythonBinary: z.string().default('python3'),
  timeoutMs: z.number().step(1).min(1).default(120_000),
})

export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.root)) throw new Error('planning governance source root must be absolute')
  const root = resolve(config.root)
  const script = join(root, 'scripts', 'adaptive_planning.py')
  const pythonBinary = config.pythonBinary ?? 'python3'
  const timeout = config.timeoutMs ?? 120_000
  const adapter: PlanningSourceAdapter = {
    name: 'data-platform-governance',
    async apply(request) {
      const temporary = await mkdtemp(join(tmpdir(), 'dsh-governance-planning-'))
      const proposal = join(temporary, 'proposal.json')
      const approval = join(temporary, 'approval.json')
      try {
        await Promise.all([
          writeFile(proposal, `${JSON.stringify(request.proposal, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }),
          writeFile(approval, `${JSON.stringify(request.approval, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }),
        ])
        const result = await execute(pythonBinary, [script, 'apply', '--proposal', proposal, '--approval', approval], {
          cwd: root,
          timeout,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        })
        const parsed: unknown = JSON.parse(result.stdout)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('governance planning adapter returned a non-object result')
        }
        return parsed
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    },
  }
  ctx.planningReview.registerSource(adapter)
}
