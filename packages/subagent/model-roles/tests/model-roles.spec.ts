import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { agentEvents, assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import ModelRolesController, { foldSubagentPin, type Config } from '../src/index.ts'

/** A minimal parent agent over a real Session (enough for fold and pin writes). */
function agent(id = 'agent-1'): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session, options: {} } as unknown as Agent & { session: Session }
}

async function setup(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ModelRolesController, config)
  return ctx
}

/** Resolve the routing section text for one agent's assembly. */
async function routingText(ctx: Context, a: Agent): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(a))
  return assembly.sections.find(section => section.name === 'model-roles:routing')?.text ?? ''
}

/** Dispatch one agent/pre-step waterfall with the given decision. */
async function dispatchPreStep(
  ctx: Context,
  a: Agent,
  decision: { kind: 'reject' } | { kind: 'enter'; messages: [] },
): Promise<unknown> {
  return agentEvents(ctx, a).waterfall(
    'agent/pre-step',
    { messages: [], turn: 0, step: 0, signal: new AbortController().signal },
    async () => decision,
  )
}

describe('foldSubagentPin', () => {
  it('folds the last pin event and clears on a null record', () => {
    const session = Session.create(SessionId('fold'))
    session.append('model-roles/subagent-pin', { provider: 'p1', model: 'm1' })
    expect(foldSubagentPin(session.events)).toEqual({ provider: 'p1', model: 'm1' })
    session.append('model-roles/subagent-pin', { provider: null, model: null })
    expect(foldSubagentPin(session.events)).toBeUndefined()
  })
})

describe('ModelRolesController.set', () => {
  it('commits a pin immediately when no turn is open', async () => {
    const ctx = await setup()
    const a = agent()
    expect(ctx.modelRoles.set(a, { provider: 'p', model: 'm' })).toBe('committed')
    expect(foldSubagentPin(a.session.events)).toEqual({ provider: 'p', model: 'm' })
  })

  it('clears a logged pin', async () => {
    const ctx = await setup()
    const a = agent()
    ctx.modelRoles.set(a, { provider: 'p', model: 'm' })
    expect(ctx.modelRoles.set(a, null)).toBe('committed')
    expect(foldSubagentPin(a.session.events)).toBeUndefined()
  })

  it('is a noop when the same pin is already in force', async () => {
    const ctx = await setup()
    const a = agent()
    ctx.modelRoles.set(a, { provider: 'p', model: 'm' })
    expect(ctx.modelRoles.set(a, { provider: 'p', model: 'm' })).toBe('noop')
  })

  it('queues a pin during an open turn instead of appending', async () => {
    const ctx = await setup()
    const a = agent()
    a.session.append('turn/start', { turn: 0 })
    expect(ctx.modelRoles.set(a, { provider: 'p', model: 'm' })).toBe('queued')
    expect(foldSubagentPin(a.session.events)).toBeUndefined()
  })

  it('commits after a closed turn (turn/end restores the immediate path)', async () => {
    const ctx = await setup()
    const a = agent()
    a.session.append('turn/start', { turn: 0 })
    a.session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    expect(ctx.modelRoles.set(a, { provider: 'p', model: 'm' })).toBe('committed')
    expect(foldSubagentPin(a.session.events)).toEqual({ provider: 'p', model: 'm' })
  })

  it('reads a queued pin as the current state on a second set()', async () => {
    const ctx = await setup()
    const a = agent()
    a.session.append('turn/start', { turn: 0 })
    expect(ctx.modelRoles.set(a, { provider: 'p', model: 'm' })).toBe('queued')
    // The pending value now backs the current-state read, so re-selecting it is a noop.
    expect(ctx.modelRoles.set(a, { provider: 'p', model: 'm' })).toBe('noop')
    expect(ctx.modelRoles.set(a, { provider: 'p2', model: 'm2' })).toBe('queued')
  })

  it('flushes a queued pin at the next accepted in-turn pre-step', async () => {
    const ctx = await setup()
    const a = agent()
    a.session.append('turn/start', { turn: 0 })
    expect(ctx.modelRoles.set(a, { provider: 'p', model: 'm' })).toBe('queued')
    expect(foldSubagentPin(a.session.events)).toBeUndefined()
    await dispatchPreStep(ctx, a, { kind: 'enter', messages: [] })
    expect(foldSubagentPin(a.session.events)).toEqual({ provider: 'p', model: 'm' })
    expect(ctx.modelRoles.set(a, { provider: 'p', model: 'm' })).toBe('noop')
  })

  it('keeps a queued pin pending when the pre-step rejects', async () => {
    const ctx = await setup()
    const a = agent()
    a.session.append('turn/start', { turn: 0 })
    expect(ctx.modelRoles.set(a, { provider: 'p', model: 'm' })).toBe('queued')
    await dispatchPreStep(ctx, a, { kind: 'reject' })
    expect(foldSubagentPin(a.session.events)).toBeUndefined()
  })

  it('queues a clear during an open turn and flushes the null record at the next pre-step', async () => {
    const ctx = await setup()
    const a = agent()
    ctx.modelRoles.set(a, { provider: 'p', model: 'm' })
    a.session.append('turn/start', { turn: 0 })
    // The pending value is a null (clear), so the pending-read falls through.
    expect(ctx.modelRoles.set(a, null)).toBe('queued')
    expect(foldSubagentPin(a.session.events)).toEqual({ provider: 'p', model: 'm' })
    // A second selection reads the queued null through the pending path: the
    // null reads as "no current pin", so a repeated clear is a noop.
    expect(ctx.modelRoles.set(a, null)).toBe('noop')
    await dispatchPreStep(ctx, a, { kind: 'enter', messages: [] })
    expect(foldSubagentPin(a.session.events)).toBeUndefined()
  })

  it('overwrites a queued clear with a new selection and flushes that at the pre-step', async () => {
    const ctx = await setup()
    const a = agent()
    ctx.modelRoles.set(a, { provider: 'p', model: 'm' })
    a.session.append('turn/start', { turn: 0 })
    expect(ctx.modelRoles.set(a, null)).toBe('queued')
    expect(ctx.modelRoles.set(a, { provider: 'p2', model: 'm2' })).toBe('queued')
    await dispatchPreStep(ctx, a, { kind: 'enter', messages: [] })
    expect(foldSubagentPin(a.session.events)).toEqual({ provider: 'p2', model: 'm2' })
  })
})

describe('model-roles:routing guidance section', () => {
  it('renders nothing while no pin and no roles exist', async () => {
    const ctx = await setup()
    const a = agent()
    expect(await routingText(ctx, a)).toBe('')
  })

  it('renders the fixed route after a pin is logged', async () => {
    const ctx = await setup()
    const a = agent()
    ctx.modelRoles.set(a, { provider: 'acme', model: 'acme-flash' })
    const text = await routingText(ctx, a)
    expect(text).toContain("The user fixed this session's subagent model to provider `acme`")
    expect(text).toContain('agentOptions: { provider: "acme", model: "acme-flash" }')
  })

  it('honors a custom tool name in the guidance', async () => {
    const ctx = await setup({ toolName: 'delegate' })
    const a = agent()
    ctx.modelRoles.set(a, { provider: 'p', model: 'm' })
    expect(await routingText(ctx, a)).toContain('the `delegate` tool')
  })

  it('assembles empty text for a subject-less assembly', async () => {
    const ctx = await setup()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'model-roles:routing')?.text).toBe('')
  })
})

describe('model-roles projection unit', () => {
  interface Bench {
    ctx: Context
    session: Session
    values(): Record<string, unknown>
  }

  async function harness(withController: boolean): Promise<Bench> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(SessionProjectionRegistry)
    if (withController) await ctx.plugin(ModelRolesController, {})
    const session = ctx.sessions.create()
    return {
      ctx,
      session,
      values: () => ctx.sessionProjections.snapshot(session).values,
    }
  }

  it('serves a null pin for the empty log', async () => {
    const bench = await harness(true)
    expect(bench.values()).toEqual({ 'model-roles': { provider: null, model: null } })
  })

  it('folds the last pin event and clears on a null record', async () => {
    const bench = await harness(true)
    bench.session.append('model-roles/subagent-pin', { provider: 'p1', model: 'm1' })
    expect(bench.values()['model-roles']).toEqual({ provider: 'p1', model: 'm1' })
    bench.session.append('model-roles/subagent-pin', { provider: null, model: null })
    expect(bench.values()['model-roles']).toEqual({ provider: null, model: null })
  })

  it('has no model-roles key when the controller is not composed', async () => {
    const bench = await harness(false)
    expect('model-roles' in bench.values()).toBe(false)
  })

  it('cold replay recovers the pin from the log alone', async () => {
    const bench = await harness(true)
    bench.session.append('model-roles/subagent-pin', { provider: 'p1', model: 'm1' })
    const cold = await harness(true)
    for (const event of bench.session.events) {
      if (event.type === 'model-roles/subagent-pin') cold.session.append(event.type, event.data)
    }
    expect(cold.values()['model-roles']).toEqual({ provider: 'p1', model: 'm1' })
  })
})
