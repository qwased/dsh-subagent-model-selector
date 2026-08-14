/**
 * Subagent model selection UI, browser half. Two optional registrations:
 *
 * 1. A `popupSelect` decoration over the host `/subagent-model` command whose
 *    rows show the configured provider route, the model id, and the model
 *    display name. Options load from the session's model directory
 *    (`session.models`), so the box stays in sync with the providers
 *    configured in settings; the current pin (read from the `model-roles`
 *    session projection) marks the active row. Picking a row executes the
 *    host command `/subagent-model <provider>/<model>` — the popup is a
 *    decoration, so an argued manual invocation keeps working unchanged.
 *
 * 2. A `settings.section` page (registered in an optional child fiber over
 *    ['slots', 'locale', 'connection', 'remote']) that lists the whole model
 *    directory with a per-model capability description and an auto-assignment
 *    switch. The host `model-roles` plugin watches its settings namespace, so
 *    a saved row is effective immediately (no restart) — the page is hot-
 *    pluggable on both ends.
 */
import type { ConnectionHandle, SessionId, SessionModels } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the `model-roles` SessionProjectionMap merge for the pin read.
import type {} from '@deepseek-ai/dsh-model-roles/client'
import type { SubagentPinProjection } from '@deepseek-ai/dsh-model-roles/client'
import { ModelRolesSection } from './ModelRolesSection.tsx'
import type { ModelRolesSectionInjected } from './ModelRolesSection.tsx'
import { MODEL_ROLES_NAMESPACE, ModelRolesSettingsStore } from './model-roles-store.ts'
import { en, zh, type ModelRolesKey } from './locales.ts'

/** One row's opaque id: the exact `<provider>/<model>` the pin command takes. */
function rowId(provider: string, model: string): string {
  return `${provider}/${model}`
}

/**
 * Build the popup rows from one session model directory: display name on the
 * label line, provider route and model id on the detail line, and the active
 * check on the row matching the current pin.
 * @param models - the loaded session model directory.
 * @param pin - the folded current pin (nulls or undefined = no pin).
 * @returns the popupSelect rows.
 */
export function optionsOf(
  models: SessionModels,
  pin: SubagentPinProjection | undefined,
): readonly SelectOption[] {
  const rows: SelectOption[] = []
  for (const group of models.groups) {
    for (const model of group.models) {
      const active = pin !== undefined && pin.provider === group.id && pin.model === model.id
      rows.push({
        id: rowId(group.id, model.id),
        label: model.name,
        detail: `${group.id} · ${model.id}`,
        ...(active ? { active: true } : {}),
      })
    }
  }
  return rows
}

/**
 * Resolve the session's current pin projection (capability absent = no pin).
 * @param sessions - the sessions service.
 * @param sessionId - the addressed session.
 * @returns the folded pin, or undefined while the session or projection is absent.
 */
function currentPin(
  sessions: SessionRuntime,
  sessionId: SessionId,
): SubagentPinProjection | undefined {
  const actx = sessions.scope(sessionId)
  if (actx === undefined) return undefined
  const face = sessions.sessionOf(actx)
  if (face === undefined) return undefined
  return face.projections.faceOf('model-roles').getSnapshot() as SubagentPinProjection | undefined
}

/**
 * Resolve the session face for one popup callback (throws when the scope or
 * face is gone — the pick cannot be submitted).
 * @param sessions - the sessions service.
 * @param sessionId - the addressed session.
 * @returns the session face.
 */
function requireSessionFace(sessions: SessionRuntime, sessionId: SessionId) {
  const actx = sessions.scope(sessionId)
  const face = actx !== undefined ? sessions.sessionOf(actx) : undefined
  if (face === undefined) {
    throw new Error(`ui-subagent-model: session "${String(sessionId)}" resolved no live session face`)
  }
  return face
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The subagent-model-roles settings page copy. */
    'settings.model-roles': ModelRolesKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.model-roles'

/** Required services: the command surface, the wire, and the sessions service. */
export const inject = ['commandUi', 'connection', 'sessions']

/**
 * Refetch the page snapshot only after its first load: an unopened settings
 * page must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: ModelRolesSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Client plugin body: decorate the host `/subagent-model` command with a
 * popupSelect over the session's model directory, and register the
 * subagent-model-roles settings section once the settings shell is composed.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.inject(['commandUi', 'connection', 'sessions'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const connection = scope.get('connection') as ConnectionHandle
    const sessions = scope.get('sessions') as SessionRuntime
    scope.effect(() => command.decorate({
      name: 'subagent-model',
      available: session => sessions.subagentAddress(session.sessionId) === undefined,
      ui: {
        kind: 'popupSelect',
        options: async (session: ClientSessionContext, signal: AbortSignal) => {
          const api = connection.api.sessions
          const { result } = await api.models({ sessionId: session.sessionId }, signal)
          if (!result.ok) {
            throw new Error(`session.models failed: ${result.error.code}: ${result.error.message}`)
          }
          return optionsOf(result.value, currentPin(sessions, session.sessionId))
        },
        onSelect: async (option: SelectOption, session: ClientSessionContext) => {
          const face = requireSessionFace(sessions, session.sessionId)
          const slash = option.id.indexOf('/')
          const provider = slash < 0 ? option.id : option.id.slice(0, slash)
          const model = slash < 0 ? '' : option.id.slice(slash + 1)
          const outcome = await face.command(`/subagent-model ${provider}/${model}`)
          if (!outcome.ok || !outcome.value.matched) {
            throw new Error('subagent-model: the pin command was not admitted')
          }
        },
      },
    }), 'ui-subagent-model: /subagent-model decoration')
  })

  // The settings section lives in its own optional child fiber: it activates
  // only once the settings shell, locale, and remote services are composed,
  // and collapses with them (hot-unplug). The popup fiber above is untouched,
  // so a composition without the settings shell still gets the decoration.
  ctx.inject(['slots', 'locale', 'connection', 'remote'], (settingsCtx: ClientContext) => {
    const connection = settingsCtx.get('connection') as ConnectionHandle
    const controller = new ModelRolesSettingsStore(connection.api)
    const useSnapshot = bindSnapshotSelector(controller.store)
    // Registration-time text (the nav label thunk) and the inject face share
    // one bound translate; copy freshness rides the locale revision.
    const t = settingsCtx.locale.bind(NS) as ModelRolesSectionInjected['t']
    const injected = (): ModelRolesSectionInjected => ({
      controller,
      useSnapshot,
      api: connection.api,
      t,
    })

    settingsCtx.effect(() => settingsCtx.locale.register(NS, { zh, en }), 'ui-subagent-model: settings copy dictionaries')

    // Pushed invalidations converge every open surface without polling: any
    // settings change to the model-roles namespace, model-directory topology
    // change, or connection reset refetches once the page loaded.
    settingsCtx.effect(() => {
      const disposers = [
        settingsCtx.remote.$on('settings/document-updated', (ns) => {
          if (ns === MODEL_ROLES_NAMESPACE) refreshIfLoaded(controller)
        }),
        settingsCtx.remote.$on('llm/adapters-updated', () => { refreshIfLoaded(controller) }),
        settingsCtx.on('connection/reset', () => { refreshIfLoaded(controller) }),
      ]
      return () => { for (const dispose of disposers) dispose() }
    }, 'ui-subagent-model: settings pushed invalidations')

    settingsCtx.slots.inject('settings.section', () => settingsCtx.slots.register({
      name: 'settings.section',
      id: 'model-roles',
      order: 20,
      label: () => t('nav'),
      inject: injected,
    }, ModelRolesSection))
  })
}
