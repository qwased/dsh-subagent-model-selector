/**
 * Model-roles settings store: joins the session-independent model directory
 * (`llm.models`) with the `model-roles` settings namespace view
 * (`settings.describe`). The host stays the single fact source — every edit
 * writes through `settings.mutate` with the expected revision, and the page
 * re-renders from the next describe, pushed or refetched. The host
 * `model-roles` plugin watches its namespace and hot-applies it, so a saved
 * row is effective without a restart.
 */

import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Settings namespace carrying per-model roles (owned by the host plugin). */
export const MODEL_ROLES_NAMESPACE = 'model-roles'

/** One per-model role record as stored in the namespace value. */
export interface ModelRole {
  /** User-written capability description (required by the host schema). */
  description: string
  /** Whether the model may be auto-assigned as a subagent. */
  subagent: boolean
}

/** One rendered row: a model-directory entry joined with its role, if any. */
export interface RoleRow {
  /** Provider route id (the model group id). */
  provider: string
  /** Provider display name. */
  providerName: string
  /** Model id. */
  model: string
  /** Model display name. */
  modelName: string
  /** The configured role, or `undefined` when none is set. */
  role: ModelRole | undefined
}

/** Page snapshot. */
export interface ModelRolesState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; row-level write failures stay in the editor. */
  error: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Revision of the `model-roles` user section the rows were read at. */
  revision: number
  /** Every model-directory entry joined with its role, in directory order. */
  rows: readonly RoleRow[]
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the page still has
 * to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read one role record from a redacted namespace value at
 * `[provider][model]`. A value that is not the exact record shape counts as
 * absent — the host schema validates the section, so this stays defensive.
 * @param value - the namespace's resolved (redacted) value.
 * @param provider - provider route id.
 * @param model - model id.
 * @returns the role, or `undefined` when the path holds none.
 */
export function roleOf(value: unknown, provider: string, model: string): ModelRole | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const providerValue = (value as Record<string, unknown>)[provider]
  if (typeof providerValue !== 'object' || providerValue === null) return undefined
  const candidate = (providerValue as Record<string, unknown>)[model]
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const { description, subagent } = candidate as { description?: unknown; subagent?: unknown }
  if (typeof description !== 'string') return undefined
  // The host schema defaults `subagent` to true; an absent or non-boolean
  // field resolves to the schema default rather than failing the row.
  return { description, subagent: subagent !== false }
}

/**
 * The model-roles settings page controller (one per settings surface). The
 * rows enumerate the whole model directory, so a provider or model added on
 * the Models page shows up here on the next load without any of this page's
 * own bookkeeping.
 */
export class ModelRolesSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<ModelRolesState> = createSnapshotStore<ModelRolesState>({
    status: 'idle', error: null, writable: false, revision: 0, rows: [],
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (llm directory + settings describe/mutate).
   */
  constructor(private readonly api: Pick<IApiClient, 'settings' | 'llm'>) {}

  /**
   * Refresh the whole page snapshot: the model directory and the settings
   * namespaces in parallel, then join each directory row with its role. A
   * failure keeps the last good rows and surfaces the error.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    let writable: boolean
    let revision: number
    let rows: RoleRow[]
    try {
      const [modelsResponse, settingsResponse] = await Promise.all([
        this.api.llm.models({}),
        this.api.settings.describe({}),
      ])
      if (!modelsResponse.result.ok) throw new Error(modelsResponse.result.error.message)
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      const namespace: SettingsNamespaceView | undefined = settingsResponse.result.value.namespaces
        .find(view => view.ns === MODEL_ROLES_NAMESPACE)
      writable = settingsResponse.result.value.writable
      // No namespace view means the host plugin is unmounted: the page still
      // lists the directory, but writes carry revision 0 and fail loud.
      revision = namespace?.revision ?? 0
      rows = []
      for (const group of modelsResponse.result.value.groups) {
        for (const model of group.models) {
          rows.push({
            provider: group.id,
            providerName: group.name,
            model: model.id,
            modelName: model.name,
            role: roleOf(namespace?.value, group.id, model.id),
          })
        }
      }
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
      return
    }
    if (generation !== this.generation) return
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.writable = writable
      s.revision = revision
      s.rows = rows
    })
  }

  /** The revision a write must send as `expectedRevision`. */
  private expectedRevision(): number {
    return this.store.getSnapshot().revision
  }

  /**
   * Apply one path-addressed edit to the `model-roles` namespace and reload
   * the snapshot afterwards — on success the rows show the new role, and on
   * failure the reload re-reads the revision the host still holds, so a stale
   * editor is never stuck sending an out-of-date `expectedRevision`.
   * @param provider - provider route id.
   * @param model - model id.
   * @param role - the role to store, or `null` to remove the stored one.
   * @returns the failure message, or `undefined` once the edit landed.
   */
  private async write(provider: string, model: string, role: ModelRole | null): Promise<string | undefined> {
    const op = role === null
      ? { op: 'unset' as const, path: [provider, model] }
      : { op: 'set' as const, path: [provider, model], value: role }
    let failure: string | undefined
    try {
      const response = await this.api.settings.mutate({
        ns: MODEL_ROLES_NAMESPACE,
        ops: [op],
        expectedRevision: this.expectedRevision(),
      })
      if (!response.result.ok) failure = response.result.error.message
    } catch (error) {
      // The transport rejected rather than answering; the caller must be able
      // to retry instead of the row silently staying unsaved.
      failure = messageOf(error)
    }
    await this.load()
    return failure
  }

  /**
   * Store one model's role (creating or replacing it).
   * @param provider - provider route id.
   * @param model - model id.
   * @param role - the description and auto-assignment flag.
   * @returns the failure message, or `undefined` once saved and reloaded.
   */
  saveRole(provider: string, model: string, role: ModelRole): Promise<string | undefined> {
    return this.write(provider, model, role)
  }

  /**
   * Remove one model's stored role.
   * @param provider - provider route id.
   * @param model - model id.
   * @returns the failure message, or `undefined` once cleared and reloaded.
   */
  clearRole(provider: string, model: string): Promise<string | undefined> {
    return this.write(provider, model, null)
  }
}
