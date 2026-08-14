/**
 * Subagent model selection UI, browser half: decorates the host
 * `/subagent-model` command with a popupSelect whose rows show the
 * configured provider route, the model id, and the model display name.
 * Options load from the session's model directory (`session.models`), so the
 * box stays in sync with the providers configured in settings; the current
 * pin (read from the `model-roles` session projection) marks the active row.
 * Picking a row executes the host command `/subagent-model <provider>/<model>`,
 * which logs the pin and renders the command node in the conversation — the
 * popup is a decoration, so an argued manual invocation (
 * `/subagent-model acme/acme-flash`) keeps working unchanged.
 */
import type { ConnectionHandle, SessionId, SessionModels } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: pulls the `model-roles` SessionProjectionMap merge for the pin read.
import type {} from '@deepseek-ai/dsh-model-roles/client'
import type { SubagentPinProjection } from '@deepseek-ai/dsh-model-roles/client'

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

/** Required services: the command surface, the wire, and the sessions service. */
export const inject = ['commandUi', 'connection', 'sessions']

/**
 * Client plugin body: decorate the host `/subagent-model` command with a
 * popupSelect over the session's model directory.
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
}
