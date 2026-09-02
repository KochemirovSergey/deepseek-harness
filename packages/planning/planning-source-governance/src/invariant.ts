/** Invariant companion for the governance source adapter. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-planning-source-governance'
export const name = 'planning-source-governance-invariant'
export const inject = ['invariants']
/** No runtime invariant: exact approval and Python transactions own the cross-process checks. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
