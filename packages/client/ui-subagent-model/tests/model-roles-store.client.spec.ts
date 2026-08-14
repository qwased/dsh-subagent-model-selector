/** Page-store join: model directory × `model-roles` namespace, with generation-guarded reloads. */
import { describe, expect, it } from 'vitest'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelProviderGroup, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { messageOf, ModelRolesSettingsStore, MODEL_ROLES_NAMESPACE, roleOf } from '../src/client/model-roles-store.ts'

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

const GROUPS: ModelProviderGroup[] = [
  {
    id: 'acme',
    name: 'Acme',
    models: [
      { id: 'acme-flash', name: 'Acme Flash' },
      { id: 'acme-pro', name: 'Acme Pro' },
    ],
  },
  {
    id: 'vertex',
    name: 'Vertex',
    models: [{ id: 'gemini', name: 'Gemini' }],
  },
]

type ProviderRoles = Record<string, Record<string, unknown>>

function namespaceValue(): ProviderRoles {
  return { acme: { 'acme-pro': { description: 'good at planning', subagent: true } } }
}

function namespaceView(value: ProviderRoles, revision: number): SettingsNamespaceView {
  return { ns: MODEL_ROLES_NAMESPACE, schema: {}, value, applies: 'live', secrets: [], revision }
}

interface MutateCall {
  ns: string
  ops: SettingsPathOpView[]
  expectedRevision: number | undefined
}

interface ApiOverrides {
  models?: () => Promise<RpcResponse<{ groups: ModelProviderGroup[]; failures: [] }>>
  describe?: () => Promise<RpcResponse<{ writable: boolean; hasDocument: boolean; namespaces: SettingsNamespaceView[] }>>
  mutate?: (call: MutateCall) => Promise<RpcResponse<SettingsNamespaceView>>
}

/** Fake llm/settings wire that records calls and applies set/unset ops like the host. */
function makeApi(overrides: ApiOverrides = {}) {
  const calls = {
    models: 0,
    describe: 0,
    mutations: [] as MutateCall[],
  }
  const state = {
    writable: true,
    value: namespaceValue(),
    revision: 3,
  }
  const face = {
    llm: {
      models: overrides.models ?? (async () => {
        calls.models += 1
        return ok({ groups: GROUPS, failures: [] })
      }),
    },
    settings: {
      describe: overrides.describe ?? (async () => {
        calls.describe += 1
        return ok({ writable: state.writable, hasDocument: true, namespaces: [namespaceView(state.value, state.revision)] })
      }),
      mutate: overrides.mutate ?? (async (call: MutateCall) => {
        calls.mutations.push(call)
        for (const op of call.ops) {
          const provider = op.path[0] ?? ''
          const model = op.path[1] ?? ''
          if (op.op === 'set') {
            const providerRoles = state.value[provider] ?? {}
            providerRoles[model] = op.value
            state.value[provider] = providerRoles
          } else {
            const providerRoles = state.value[provider]
            if (providerRoles !== undefined) {
              state.value[provider] = Object.fromEntries(
                Object.entries(providerRoles).filter(([key]) => key !== model),
              )
            }
          }
        }
        state.revision += 1
        return ok(namespaceView(state.value, state.revision))
      }),
    },
  }
  return {
    api: face as never,
    calls,
    state,
  }
}

describe('ModelRolesSettingsStore.load', () => {
  it('joins every directory model with its stored role, in directory order', async () => {
    const h = makeApi()
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.writable).toBe(true)
    expect(state.revision).toBe(3)
    expect(state.rows).toEqual([
      {
        provider: 'acme',
        providerName: 'Acme',
        model: 'acme-flash',
        modelName: 'Acme Flash',
        role: undefined,
      },
      {
        provider: 'acme',
        providerName: 'Acme',
        model: 'acme-pro',
        modelName: 'Acme Pro',
        role: { description: 'good at planning', subagent: true },
      },
      {
        provider: 'vertex',
        providerName: 'Vertex',
        model: 'gemini',
        modelName: 'Gemini',
        role: undefined,
      },
    ])
    expect(h.calls.models).toBe(1)
    expect(h.calls.describe).toBe(1)
  })

  it('reads a zero revision when the host namespace is unmounted but still lists the directory', async () => {
    const h = makeApi({
      describe: () => Promise.resolve(ok({
        writable: false,
        hasDocument: true,
        namespaces: [{ ns: 'llm-deepseek', schema: {}, value: {}, applies: 'live', secrets: [], revision: 0 }],
      })),
    })
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.writable).toBe(false)
    expect(state.revision).toBe(0)
    expect(state.rows).toHaveLength(3)
  })

  it('surfaces a model-directory failure', async () => {
    const h = makeApi({ models: () => Promise.resolve(fail('directory down')) })
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'directory down' })
  })

  it('surfaces a settings-describe failure', async () => {
    const h = makeApi({ describe: () => Promise.resolve(fail('settings down')) })
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'settings down' })
  })

  it('stringifies a non-Error load rejection', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario
    const h = makeApi({ models: () => Promise.reject('plain refusal') })
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'plain refusal' })
  })

  it('keeps the last good rows when a later load fails', async () => {
    let modelsCalls = 0
    const h = makeApi({
      models: async () => {
        modelsCalls += 1
        return modelsCalls === 1 ? ok({ groups: GROUPS, failures: [] }) : fail('directory down')
      },
    })
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    expect(store.store.getSnapshot().rows).toHaveLength(3)
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('directory down')
    // The last good rows survive the failed refresh.
    expect(state.rows).toHaveLength(3)
  })

  it('lets the newest load win over a stale slow failure', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let call = 0
    const h = makeApi({
      models: async () => {
        call += 1
        if (call === 1) {
          await gate
          return fail('stale failure')
        }
        return ok({ groups: GROUPS, failures: [] })
      },
    })
    const store = new ModelRolesSettingsStore(h.api)
    const first = store.load()
    const second = store.load()
    release?.()
    await Promise.all([first, second])
    expect(store.store.getSnapshot().status).toBe('ready')
    expect(store.store.getSnapshot().rows).toHaveLength(3)
  })

  it('drops a stale successful response after a newer load finished', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let call = 0
    const h = makeApi({
      models: async () => {
        call += 1
        if (call === 1) {
          await gate
          return ok({ groups: [], failures: [] })
        }
        return ok({ groups: GROUPS, failures: [] })
      },
    })
    const store = new ModelRolesSettingsStore(h.api)
    const first = store.load()
    const second = store.load()
    await second
    release?.()
    await first
    // The stale empty directory never overwrote the newer join.
    expect(store.store.getSnapshot().rows).toHaveLength(3)
  })
})

describe('ModelRolesSettingsStore writes', () => {
  it('saves a role with a set op and the expected revision, then reloads', async () => {
    const h = makeApi()
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    expect(store.store.getSnapshot().revision).toBe(3)

    const failure = await store.saveRole('acme', 'acme-flash', { description: 'fast', subagent: false })
    expect(failure).toBeUndefined()
    expect(h.calls.mutations).toEqual([{
      ns: MODEL_ROLES_NAMESPACE,
      ops: [{ op: 'set', path: ['acme', 'acme-flash'], value: { description: 'fast', subagent: false } }],
      expectedRevision: 3,
    }])
    // The reload re-reads the host, which has applied the write.
    expect(h.calls.describe).toBe(2)
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.revision).toBe(4)
    expect(state.rows[0]?.role).toEqual({ description: 'fast', subagent: false })
  })

  it('clears a stored role with an unset op and reloads', async () => {
    const h = makeApi()
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    expect(store.store.getSnapshot().rows[1]?.role).toBeDefined()

    const failure = await store.clearRole('acme', 'acme-pro')
    expect(failure).toBeUndefined()
    expect(h.calls.mutations).toEqual([{
      ns: MODEL_ROLES_NAMESPACE,
      ops: [{ op: 'unset', path: ['acme', 'acme-pro'] }],
      expectedRevision: 3,
    }])
    expect(h.calls.describe).toBe(2)
    expect(store.store.getSnapshot().rows[1]?.role).toBeUndefined()
  })

  it('returns the host rejection message and still reloads', async () => {
    const h = makeApi({ mutate: () => Promise.resolve(fail('expected revision mismatch')) })
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    const failure = await store.saveRole('acme', 'acme-pro', { description: 'x', subagent: true })
    expect(failure).toBe('expected revision mismatch')
    // The reload re-reads whatever the host still holds.
    expect(h.calls.describe).toBe(2)
    expect(store.store.getSnapshot().status).toBe('ready')
  })

  it('re-reads the revision after a failed write so a stale editor is not stuck', async () => {
    let describeCount = 0
    const h = makeApi({
      mutate: () => Promise.resolve(fail('stale')),
      describe: async () => {
        describeCount += 1
        return ok({
          writable: true,
          hasDocument: true,
          namespaces: [namespaceView(namespaceValue(), describeCount === 1 ? 3 : 9)],
        })
      },
    })
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    expect(store.store.getSnapshot().revision).toBe(3)
    const failure = await store.saveRole('acme', 'acme-pro', { description: 'x', subagent: true })
    expect(failure).toBe('stale')
    expect(store.store.getSnapshot().revision).toBe(9)
  })

  it('stringifies a transport rejection on write', async () => {
    const h = makeApi({ mutate: () => Promise.reject(new Error('wire down')) })
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    expect(await store.saveRole('acme', 'acme-pro', { description: 'x', subagent: true })).toBe('wire down')
  })

  it('stringifies a non-Error transport rejection on write', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario
    const h = makeApi({ mutate: () => Promise.reject('refused') })
    const store = new ModelRolesSettingsStore(h.api)
    await store.load()
    expect(await store.saveRole('acme', 'acme-pro', { description: 'x', subagent: true })).toBe('refused')
  })
})

describe('roleOf', () => {
  it('reads a role record and defaults the subagent flag to true', () => {
    expect(roleOf({ acme: { m1: { description: 'fast' } } }, 'acme', 'm1'))
      .toEqual({ description: 'fast', subagent: true })
    expect(roleOf({ acme: { m1: { description: 'fast', subagent: false } } }, 'acme', 'm1'))
      .toEqual({ description: 'fast', subagent: false })
    // A non-boolean flag falls back to the schema default rather than failing.
    expect(roleOf({ acme: { m1: { description: 'fast', subagent: 'yes' } } }, 'acme', 'm1'))
      .toEqual({ description: 'fast', subagent: true })
  })

  it('returns undefined for anything that is not a well-formed record', () => {
    expect(roleOf(null, 'acme', 'm1')).toBeUndefined()
    expect(roleOf('not an object', 'acme', 'm1')).toBeUndefined()
    expect(roleOf({}, 'acme', 'm1')).toBeUndefined()
    expect(roleOf({ acme: null }, 'acme', 'm1')).toBeUndefined()
    expect(roleOf({ acme: { m1: null } }, 'acme', 'm1')).toBeUndefined()
    expect(roleOf({ acme: { m1: { description: 42 } } }, 'acme', 'm1')).toBeUndefined()
    expect(roleOf({ acme: { m1: { description: 'x' } } }, 'acme', 'missing')).toBeUndefined()
  })
})

describe('messageOf', () => {
  it('reads an Error message and stringifies anything else a rejection may carry', () => {
    expect(messageOf(new Error('connection lost'))).toBe('connection lost')
    expect(messageOf('the host refused')).toBe('the host refused')
    expect(messageOf(undefined)).toBe('undefined')
  })
})
