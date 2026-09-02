/** Package invariant companion for the planning tool consumer. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-planning'
export const name = 'tool-planning-invariant'
export const inject = ['invariants']

/** No runtime invariant: the planning service validates every durable transition this adapter requests. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
