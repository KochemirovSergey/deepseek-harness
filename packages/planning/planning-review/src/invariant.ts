/** Package invariant companion for exact-hash planning review. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-planning-review'
export const name = 'planning-review-invariant'
export const inject = ['invariants']
/** No runtime invariant: planning events own approval state and adapters recheck apply artifacts. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
