/** Package invariant companion for rebuildable planning calibration. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-planning-calibration'
export const name = 'planning-calibration-invariant'
export const inject = ['invariants']

/** No runtime invariant: planning replay and storage-domain schemas validate both authorities. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
