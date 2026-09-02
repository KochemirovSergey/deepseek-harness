/** Package-owned background-job snapshot invariants. @module @deepseek-ai/dsh-jobs/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { JobSnapshot } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-jobs'
const TERMINAL_STATUSES = new Set(['completed', 'killed', 'failed'])

/** Cordis companion plugin name. */
export const name = 'jobs-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate the cross-field relationships in one registry snapshot. */
function validateSnapshot(snapshot: JobSnapshot, owner: Agent | undefined, fail: InvariantFailure): void {
  const id = String(snapshot.id)
  const prefix = `${snapshot.kind}-`
  const ordinal = Number(id.slice(prefix.length))
  if (snapshot.kind.length === 0 || !id.startsWith(prefix)
    || !Number.isSafeInteger(ordinal) || ordinal < 1) {
    fail(`job snapshot id ${JSON.stringify(id)} must be ${JSON.stringify(prefix)} followed by a positive ordinal`)
  }
  if (snapshot.label.length === 0) fail(`job ${JSON.stringify(id)} label must be non-empty`)
  if (!Number.isSafeInteger(snapshot.startedAt) || snapshot.startedAt < 0) {
    fail(`job ${JSON.stringify(id)} startedAt must be a non-negative epoch integer`)
  }

  const progress = snapshot.progress
  if (progress !== undefined) {
    if (!Number.isSafeInteger(progress.updatedAt) || progress.updatedAt < snapshot.startedAt) {
      fail(`job ${JSON.stringify(id)} progress updatedAt must be an epoch integer no earlier than startedAt`)
    }
    if (progress.completedUnits !== undefined && (!Number.isFinite(progress.completedUnits) || progress.completedUnits < 0)) {
      fail(`job ${JSON.stringify(id)} progress completedUnits must be non-negative`)
    }
    if (progress.totalUnits !== undefined && (!Number.isFinite(progress.totalUnits) || progress.totalUnits <= 0)) {
      fail(`job ${JSON.stringify(id)} progress totalUnits must be positive`)
    }
    if (progress.completedUnits !== undefined && progress.totalUnits !== undefined
      && progress.completedUnits > progress.totalUnits) {
      fail(`job ${JSON.stringify(id)} progress cannot exceed totalUnits`)
    }
  }

  const terminal = TERMINAL_STATUSES.has(snapshot.status)
  if (terminal !== (snapshot.finishedAt !== undefined)) {
    fail(`job ${JSON.stringify(id)} finishedAt must be present exactly for a terminal status`)
  }
  if (snapshot.finishedAt !== undefined
    && (!Number.isSafeInteger(snapshot.finishedAt) || snapshot.finishedAt < snapshot.startedAt)) {
    fail(`job ${JSON.stringify(id)} finishedAt must be an epoch integer no earlier than startedAt`)
  }
  if (terminal !== (snapshot.durationMs !== undefined)) {
    fail(`job ${JSON.stringify(id)} durationMs must be present exactly for a terminal status`)
  }
  if (snapshot.durationMs !== undefined && (!Number.isFinite(snapshot.durationMs) || snapshot.durationMs < 0)) {
    fail(`job ${JSON.stringify(id)} durationMs must be non-negative monotonic elapsed time`)
  }

  const expectedOwner = owner?.id
  if (snapshot.ownerSession !== expectedOwner) {
    fail(`job ${JSON.stringify(id)} ownerSession does not match its completion owner`)
  }
}

/** Install checks over current unowned records and every terminal snapshot. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const snapshot of ctx.jobs.list()) validateSnapshot(snapshot, undefined, fail)
  ctx.jobs.onJobDone((snapshot, owner) => { validateSnapshot(snapshot, owner, fail) })
}, { inject: ['jobs'] })

/**
 * Register the job-registry invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
