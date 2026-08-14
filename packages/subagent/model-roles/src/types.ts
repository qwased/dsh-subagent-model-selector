/**
 * Pure types of the subagent model-routing domain, free of host-side value
 * imports (cordis service, dsh-session). The settings value and the logged pin
 * event share this home so the value shape has one definition.
 *
 * @module @deepseek-ai/dsh-model-roles/types
 */

/** Capability metadata a user attaches to one model route. */
export interface ModelRole {
  /** Human-written capability description used for task-based routing. */
  description: string
  /** Whether this model may be auto-assigned as a subagent when none is named. */
  subagent: boolean
}

/** Model roles keyed by provider route, then by model id. */
export type ModelRolesSettings = Record<string, Record<string, ModelRole>>

/** A resolved subagent-model pin folded from the `model-roles/subagent-pin` log. */
export interface SubagentPin {
  /** Registered provider route the child must use. */
  provider: string
  /** Model id the child must use, interpreted by the selected provider. */
  model: string
}

/** Wire value of the `model-roles` session projection: the session's pinned subagent model route, nulled when absent. */
export interface SubagentPinProjection {
  /** Provider route the child must use; null when no pin is in force. */
  provider: string | null
  /** Model id the child must use; null when no pin is in force. */
  model: string | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's fixed subagent-model route from this point on: log-only,
     * whole-value replace, last one wins. Both fields null records "no pin".
     */
    'model-roles/subagent-pin': { provider: string | null; model: string | null }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The session's pinned subagent-model route, folded from the
     * `model-roles/subagent-pin` log (whole-value replace, last wins). The key's
     * absence means the projection unit is not composed; a present key always
     * carries a value, both fields null when no pin is in force.
     */
    'model-roles': SubagentPinProjection
  }
}
