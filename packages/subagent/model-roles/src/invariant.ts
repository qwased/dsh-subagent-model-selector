/**
 * Package-owned invariant companion for subagent model routing.
 *
 * The only durable relationship is the `model-roles/subagent-pin` event, which
 * this package is the sole producer of and appends as a whole-value replace
 * with both fields null or both set — the mixed state is unrepresentable at the
 * typed same-process boundary. The empty installer keeps that absence explicit.
 *
 * @module @deepseek-ai/dsh-model-roles/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-model-roles'

/** Cordis companion plugin name. */
export const name = 'model-roles-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: the pin event is whole-value replace from one producer. */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
