/** Package invariant companion for planning lifecycle observation bridges. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-planning-observer'
export const name = 'planning-observer-invariant'
export const inject = ['invariants']

/** No runtime invariant: source lifecycle invariants and planning replay validate both ends. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
