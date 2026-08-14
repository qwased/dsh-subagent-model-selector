/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-subagent-model`.
 * @module @deepseek-ai/dsh-client-ui-subagent-model/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-subagent-model'

/** Cordis companion plugin name. */
export const name = 'client-ui-subagent-model-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a single /subagent-model popupSelect decoration whose
 * disposal is proven by the HMR-safety spec — the plugin owns no store (the
 * current pin arrives on the `model-roles` session projection), emits no
 * cordis events, and holds no cross-plugin mutable state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
