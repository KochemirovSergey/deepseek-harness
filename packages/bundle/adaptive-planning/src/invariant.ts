/** Invariant companion for the adaptive-planning static patch carrier. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-adaptive-planning'
export const name = 'adaptive-planning-bundle-invariant'
export const inject = ['invariants']

/** No runtime invariant: this package only carries a static profile patch. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
