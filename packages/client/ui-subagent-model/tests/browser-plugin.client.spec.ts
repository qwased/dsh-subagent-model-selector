/**
 * ui-subagent-model browser half on a real cordis Context with fake
 * command/connection/sessions faces: the /subagent-model host command is
 * decorated with a popupSelect whose rows show provider route, model id, and
 * display name from the session's model directory; the row matching the
 * current `model-roles` projection is marked active; picking a row executes
 * the host command line. Addressed subagent sessions expose no popup.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

import type { CommandDecoration, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import { apply, inject, optionsOf } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { apply as invariantApply, name, inject as invariantInject } from '../src/invariant.ts'
import type { SubagentPinProjection } from '@deepseek-ai/dsh-model-roles/client'

const sid = (k: string): SessionId => k as SessionId

const GROUPS = [
  {
    id: 'acme',
    name: 'Acme',
    models: [
      { id: 'acme-flash', name: 'Acme Flash' },
      { id: 'acme-pro', name: 'Acme Pro' },
    ],
  },
]

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  mint(key: string): void
  decoration(): CommandDecoration
  commands: string[]
  setPin(pin: SubagentPinProjection | undefined): void
  address(key: string): void
  /** Fail the next session.models call with the given code. */
  failModels(code: string, message: string): void
  /** Sessions whose scope or face has gone away (session ended). */
  dead(key: string): void
  /** Make the next /subagent-model command fail to be admitted. */
  rejectNextCommand(): void
}

async function bench(): Promise<Bench> {
  const ctx = new Context()
  const commands: string[] = []
  let pin: SubagentPinProjection | undefined
  const scopes = new Map<SessionId, Context>()
  const scopeKeys = new Map<Context, SessionId>()
  const addressed = new Set<SessionId>()
  const deadSessions = new Set<SessionId>()
  let modelsError: { code: string; message: string } | undefined
  let commandRejected = false
  let decoration: CommandDecoration | undefined

  ctx.provide('connection', {
    api: { sessions: {
      models: () => modelsError === undefined
        ? Promise.resolve({
          result: { ok: true as const, value: { current: null as never, routable: true, groups: GROUPS, failures: [] } },
        })
        : Promise.resolve({
          result: { ok: false as const, error: modelsError },
        }),
    } },
  })

  ctx.provide('commandUi', {
    decorate(d: CommandDecoration) {
      decoration = d
      return () => { decoration = undefined }
    },
  })

  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id),
    subagentAddress: (id: SessionId) => addressed.has(id)
      ? { parentSessionId: sid('parent'), childSessionId: id, mode: 'continuable' as const }
      : undefined,
    sessionOf: (actx: Context) => {
      const key = scopeKeys.get(actx)
      if (key === undefined || deadSessions.has(key)) return undefined
      return {
        sessionId: key,
        projections: { faceOf: () => ({ getSnapshot: () => pin }) },
        command: (line: string) => {
          commands.push(line)
          return commandRejected
            ? Promise.resolve({ ok: true as const, value: { matched: false } })
            : Promise.resolve({ ok: true as const, value: { matched: true } })
        },
      }
    },
  })

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  const mint = (key: string) => {
    const handle = createScope(ctx, sid(key))
    scopes.set(sid(key), handle.ctx)
    scopeKeys.set(handle.ctx, sid(key))
  }

  return {
    ctx, fiber, mint,
    decoration: () => decoration!,
    commands,
    setPin: (next: SubagentPinProjection | undefined) => { pin = next },
    address: (key: string) => { addressed.add(sid(key)) },
    failModels: (code: string, message: string) => { modelsError = { code, message } },
    dead: (key: string) => { deadSessions.add(sid(key)) },
    rejectNextCommand: () => { commandRejected = true },
  }
}

const projection = (id: string) => ({ sessionId: sid(id) })

describe('ui-subagent-model /subagent-model decoration', () => {
  it('decorates the host command with a popupSelect over the model directory', async () => {
    const b = await bench()
    expect(b.decoration().name).toBe('subagent-model')
    expect(b.decoration().ui.kind).toBe('popupSelect')
    expect(b.decoration().available(projection('s1'))).toBe(true)
  })

  it('lists provider route and model id on the detail line with the display name as label', async () => {
    const b = await bench()
    b.mint('s1')
    const options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    expect(options.map((o: SelectOption) => o.label)).toEqual(['Acme Flash', 'Acme Pro'])
    expect(options.map((o: SelectOption) => o.detail)).toEqual([
      'acme · acme-flash',
      'acme · acme-pro',
    ])
    expect(options.every((o: SelectOption) => o.active !== true)).toBe(true)
  })

  it('marks the row matching the current model-roles projection active', async () => {
    const b = await bench()
    b.mint('s1')
    b.setPin({ provider: 'acme', model: 'acme-flash' })
    const options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    expect(options[0]?.active).toBe(true)
    expect(options[1]?.active).toBeUndefined()
  })

  it('executes the /subagent-model command line on select', async () => {
    const b = await bench()
    b.mint('s1')
    await b.decoration().ui.onSelect(
      { id: 'acme/acme-flash', label: 'Acme Flash', detail: 'acme · acme-flash' },
      projection('s1'),
    )
    expect(b.commands).toEqual(['/subagent-model acme/acme-flash'])
  })

  it('hides the popup for addressed subagent sessions', async () => {
    const b = await bench()
    b.address('s2')
    expect(b.decoration().available(projection('s2'))).toBe(false)
  })

  it('resolves no pin while the session scope or face is absent', async () => {
    const b = await bench()
    b.mint('s1')
    // A session with a minted scope and a live face reports the current pin…
    b.setPin({ provider: 'acme', model: 'acme-flash' })
    let options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    expect(options[0]?.active).toBe(true)
    // …a scope-less session reads no pin (currentPin falls through)…
    const scopeLess = await b.decoration().ui.options(projection('s2'), new AbortController().signal)
    expect(scopeLess.every(o => o.active !== true)).toBe(true)
    // …and a dead session (scope present, face gone) also reads no pin.
    b.dead('s1')
    options = await b.decoration().ui.options(projection('s1'), new AbortController().signal)
    expect(options.every(o => o.active !== true)).toBe(true)
  })

  it('fails loud when the model directory call fails or the command is not admitted', async () => {
    const b = await bench()
    b.mint('s1')
    b.failModels('REMOTE', 'directory unavailable')
    await expect(b.decoration().ui.options(projection('s1'), new AbortController().signal))
      .rejects.toThrow('session.models failed: REMOTE: directory unavailable')

    b.rejectNextCommand()
    await expect(b.decoration().ui.onSelect(
      { id: 'acme/acme-flash', label: 'Acme Flash', detail: 'acme · acme-flash' },
      projection('s1'),
    )).rejects.toThrow('subagent-model: the pin command was not admitted')
  })

  it('rejects onSelect when the session scope or face is gone', async () => {
    const b = await bench()
    // A session with no scope at all (never minted).
    await expect(b.decoration().ui.onSelect(
      { id: 'acme/acme-flash', label: 'Acme Flash', detail: 'acme · acme-flash' },
      projection('s2'),
    )).rejects.toThrow('resolved no live session face')
    // A session whose face has died after the scope was minted.
    b.mint('s1')
    b.dead('s1')
    await expect(b.decoration().ui.onSelect(
      { id: 'acme/acme-flash', label: 'Acme Flash', detail: 'acme · acme-flash' },
      projection('s1'),
    )).rejects.toThrow('resolved no live session face')
  })

  it('handles an option id without a slash by treating the whole id as the provider', async () => {
    const b = await bench()
    b.mint('s1')
    // A slash-less id leaves the model segment empty but still executes the command.
    await b.decoration().ui.onSelect(
      { id: 'acme', label: 'Acme', detail: 'acme' },
      projection('s1'),
    )
    expect(b.commands).toEqual(['/subagent-model acme/'])
  })
})

describe('node half', () => {
  it('host apply is a no-op', () => {
    hostApply()
  })

  it('invariant companion registers package ownership', async () => {
    const ctx = new Context()
    let registered = ''
    ctx.provide('invariants', {
      register: (pkg: string) => { registered = pkg; return () => {} },
    })
    await invariantApply(ctx)
    expect(registered).toBe('@deepseek-ai/dsh-client-ui-subagent-model')
    expect(name).toBe('client-ui-subagent-model-invariant')
    expect(invariantInject).toEqual(['invariants'])
  })
})

describe('optionsOf', () => {
  it('builds one row per model with the three-field layout', () => {
    const rows = optionsOf({ current: null as never, routable: true, groups: GROUPS, failures: [] }, undefined)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ id: 'acme/acme-flash', label: 'Acme Flash', detail: 'acme · acme-flash' })
  })

  it('marks active from a matching pin and ignores non-matching ones', () => {
    const pin: SubagentPinProjection = { provider: 'acme', model: 'acme-pro' }
    const rows = optionsOf({ current: null as never, routable: true, groups: GROUPS, failures: [] }, pin)
    expect(rows[0]?.active).toBeUndefined()
    expect(rows[1]?.active).toBe(true)
  })
})
