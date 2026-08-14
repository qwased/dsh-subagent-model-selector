/**
 * Subagent model routing: a settings-backed catalog of per-model capability
 * roles plus a per-session pinned subagent model. The pin is logged
 * (`model-roles/subagent-pin`, last wins) and rendered into a system-prompt
 * section, so a pinned or description-routed child is soft-enforced: the
 * delegating model passes the chosen `agentOptions` on each `subagent` tool
 * call. No routing happens inside the loop, and no provider adapter schema is
 * touched — the roles are advisory metadata consumed only by this prompt
 * section and the `/subagent-model` command.
 *
 * @module @deepseek-ai/dsh-model-roles
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import zod from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves `ctx.commands` for the optional command child.
import type {} from '@deepseek-ai/dsh-commands'
// Type-only: makes `ctx.systemPrompt` resolve for the guidance section.
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only: resolves `ctx.sessionProjections` for the optional projection unit child.
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ModelRole, ModelRolesSettings, SubagentPin, SubagentPinProjection } from './types.ts'
export type * from './types.ts'

/** Settings namespace carrying per-model roles, keyed provider then model. */
export const MODEL_ROLES_SETTINGS_NAMESPACE = settingsNamespace('model-roles')

/** Prompt order: just before tool-subagent's per-tool guidance band (116.5). */
const ROUTING_SECTION_ORDER = 116

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelRoles: ModelRolesController
  }
}

/** Plugin configuration. */
export interface Config {
  /** Model-facing subagent tool name whose calls should carry `agentOptions`. */
  toolName?: string
}

export const Config: z<Config> = z.object({
  toolName: z.string().default('subagent'),
})

const ModelRoleSchema: z<ModelRole> = z.object({
  // A model excluded from auto-assignment (subagent: false) carries no routing
  // prose; only checked candidates need a description, which the settings page
  // enforces. Absence normalizes to '' so hand-written configs stay readable.
  description: z.string().default(''),
  subagent: z.boolean().default(true),
})

const ModelRolesSchema: z<ModelRolesSettings> = z.dict(z.dict(ModelRoleSchema)).default({})

/**
 * Fold the session's pinned subagent-model route from its log.
 * @param events - the session log or any prefix of it.
 * @returns the pinned provider/model, or `undefined` when the log records none.
 */
export function foldSubagentPin(events: readonly SessionEvent[]): SubagentPin | undefined {
  let pin: SubagentPin | undefined
  for (const event of events) {
    if (event.type !== 'model-roles/subagent-pin') continue
    pin = event.data.provider !== null && event.data.model !== null
      ? { provider: event.data.provider, model: event.data.model }
      : undefined
  }
  return pin
}

/** Whether the log holds an opened turn without its closing `turn/end`. */
function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

/** One auto-assignable model route plus its user-written description. */
interface RouteCandidate extends SubagentPin {
  description: string
}

/** The auto-assignable models, in settings order. */
function routeCandidates(roles: ModelRolesSettings): RouteCandidate[] {
  const candidates: RouteCandidate[] = []
  for (const [provider, models] of Object.entries(roles)) {
    for (const [model, role] of Object.entries(models)) {
      // Only checked candidates with real routing prose join the guidance list:
      // an excluded model never appears, and a hand-written `subagent: true`
      // without a description has nothing for the delegating model to read.
      if (role.subagent && role.description.trim() !== '') {
        candidates.push({ provider, model, description: role.description })
      }
    }
  }
  return candidates
}

/** Parse `<provider>/<model>` or `<provider> <model>` into a pin. */
function parsePin(input: string): SubagentPin | undefined {
  const slashParts = input.split('/')
  if (slashParts.length === 2) {
    const provider = slashParts[0]?.trim()
    const model = slashParts[1]?.trim()
    if (provider !== undefined && provider !== '' && model !== undefined && model !== '') {
      return { provider, model }
    }
  }
  const spaceParts = input.split(/\s+/)
  if (spaceParts.length === 2) {
    const provider = spaceParts[0]
    const model = spaceParts[1]
    // The command handler trims rawInput first, so a two-part split cannot
    // carry an empty segment; the checks mirror the slash branch defensively.
    /* v8 ignore next 4 -- post-trim split(\s+) yields only non-empty parts */
    if (provider !== undefined && provider !== '' && model !== undefined && model !== '') {
      return { provider, model }
    }
  }
  return undefined
}

/**
 * `ctx.modelRoles`: owns the `model-roles` settings namespace, the logged
 * per-session pin, the `model-roles:routing` prompt section, and the
 * `/subagent-model` command. Routing is advisory: this service never starts a
 * child; it only tells the delegating model which route to pass.
 */
export class ModelRolesController extends Service {
  static Config: z<Config> = Config
  static inject = ['systemPrompt']

  /** Current settings source, swapped by the settings wiring. */
  private source: () => ModelRolesSettings
  /** The model-facing delegation tool this guidance names. */
  private readonly toolName: string
  /** Latest pin selection per session awaiting the next accepted in-turn pre-step. */
  private readonly pendingPins = new WeakMap<Session, SubagentPin | null>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'modelRoles')
    // Config normalization always supplies the toolName default; the ?? guards
    // only direct (non-plugin) construction.
    /* v8 ignore next -- schema default always sets toolName under plugin normalization */
    this.toolName = config.toolName ?? 'subagent'
    this.source = () => ({})
    installSettingsSection(ctx, MODEL_ROLES_SETTINGS_NAMESPACE, ModelRolesSchema, {}, {
      setSource: (current) => { this.source = current },
      // The prompt section reads the source live, so no registration-level fact
      // needs rebuilding when the settings document changes.
      onChange: () => {},
    })

    // Commit a queued pin at the next accepted in-turn pre-step (mirrors
    // plan-mode): appending outside the append-publication window keeps the
    // pin before the next request assembly without re-entering the session.
    ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || !this.pendingPins.has(agent.session)) return decision
      this.appendPin(agent.session, this.pendingPins.get(agent.session) ?? null)
      this.pendingPins.delete(agent.session)
      return decision
    })

    ctx.systemPrompt.section({
      name: 'model-roles:routing',
      order: ROUTING_SECTION_ORDER,
      text: (context) => {
        const agent = context.agent
        return agent === undefined ? '' : this.guidance(agent)
      },
    })

    // The `model-roles` session projection unit: folds the logged pin into a
    // whole wire value for client surfaces (the /subagent-model popup marks
    // the active row). The unit child activates only when a projection
    // registry is composed (headless assemblies stay unaffected).
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'model-roles', SubagentPinProjection>({
        key: 'model-roles',
        schema: zod.object({
          provider: zod.string().nullable(),
          model: zod.string().nullable(),
        }),
        init: () => ({ provider: null, model: null }),
        apply: (state, event) => {
          if (event.type !== 'model-roles/subagent-pin') return state
          return { provider: event.data.provider, model: event.data.model }
        },
        view: state => state,
        stateVersion: 1,
      })
    })

    // The command child activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'subagent-model',
        description: 'Pin the subagent model for this session',
        input: { hint: '[provider/model|off]' },
        handler: ({ agent, rawInput }) => this.handleCommand(agent, rawInput),
      })
    })
  }

  /**
   * Select the session's fixed subagent-model route. Between turns the change
   * is appended immediately; during an open turn it stays pending until the
   * next accepted in-turn pre-step. Selecting the current state is a no-op.
   * @param agent - the agent whose session is pinned.
   * @param selection - the provider/model to pin, or `null` to clear the pin.
   * @returns `committed` (logged now), `queued` (awaiting the next step), or
   * `noop` (already in that state).
   */
  set(agent: Agent, selection: SubagentPin | null): 'committed' | 'queued' | 'noop' {
    const session = agent.session
    const current = this.pendingPins.has(session)
      ? (this.pendingPins.get(session) ?? undefined)
      : foldSubagentPin(session.events)
    const same = selection === null
      ? current === undefined
      : current !== undefined && current.provider === selection.provider && current.model === selection.model
    if (same) return 'noop'
    if (hasOpenTurn(session.events)) {
      this.pendingPins.set(session, selection)
      return 'queued'
    }
    this.appendPin(session, selection)
    return 'committed'
  }

  /** The prompt section text for one agent: pinned route, else role candidates. */
  private guidance(agent: Agent): string {
    const pin = foldSubagentPin(agent.session.events)
    if (pin !== undefined) {
      return `The user fixed this session's subagent model to provider \`${pin.provider}\`, model \`${pin.model}\`. `
        + `Whenever you delegate with the \`${this.toolName}\` tool, pass \`agentOptions: { provider: ${JSON.stringify(pin.provider)}, model: ${JSON.stringify(pin.model)} }\`. `
        + 'Do not substitute another route unless the user asks you to.'
    }
    const candidates = routeCandidates(this.source())
    if (candidates.length === 0) return ''
    const rows = candidates
      .map(candidate => `- provider \`${candidate.provider}\`, model \`${candidate.model}\`: ${candidate.description}`)
    return `Choose the model for each \`${this.toolName}\` delegation from these candidates, by how well each fits the task, `
      + 'and pass your choice as `agentOptions: { provider, model }`. '
      + 'If a child result is unsatisfactory, re-delegate with a stronger candidate. '
      + 'If the user names a specific model, use it. '
      + 'Pass \`agentOptions\` only with a provider/model from this list or one the user named; omit it to inherit the parent route.\n'
      + rows.join('\n')
  }

  /** Handle one `/subagent-model` command invocation. */
  private handleCommand(agent: Agent, rawInput: string): { kind: 'success'; text: string } {
    const input = rawInput.trim()
    if (input === '' || input === 'off' || input === 'clear') {
      const outcome = this.set(agent, null)
      return {
        kind: 'success',
        text: outcome === 'noop' ? 'No subagent model is pinned.' : 'Subagent model pin cleared.',
      }
    }
    const selection = parsePin(input)
    if (selection === undefined) {
      return { kind: 'success', text: 'Usage: /subagent-model <provider>/<model>, or /subagent-model off to clear.' }
    }
    const outcome = this.set(agent, selection)
    return {
      kind: 'success',
      text: outcome === 'noop'
        ? `Subagent model already pinned to ${selection.provider}/${selection.model}.`
        : `Subagent model pinned to ${selection.provider}/${selection.model}.`,
    }
  }

  /** Append one pin state to the durable log. */
  private appendPin(session: Session, selection: SubagentPin | null): void {
    session.append('model-roles/subagent-pin', selection === null
      ? { provider: null, model: null }
      : { provider: selection.provider, model: selection.model })
  }
}

export default ModelRolesController
