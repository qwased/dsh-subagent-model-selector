/** Settings-section registration: the optional fiber, locale-following nav label, HMR recovery, and pushed invalidations. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandDecoration } from '@deepseek-ai/dsh-client-ui-commands/client'
import { apply, inject, refreshIfLoaded } from '../src/client/index.ts'
import { MODEL_ROLES_NAMESPACE } from '../src/client/model-roles-store.ts'
import type { ModelRolesSettingsStore } from '../src/client/model-roles-store.ts'
import { ModelRolesSection } from '../src/client/ModelRolesSection.tsx'
import type { ModelRolesSectionInjected } from '../src/client/ModelRolesSection.tsx'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: 'r' as never, result: { ok: true, value } }
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
]

const NAMESPACE: SettingsNamespaceView = {
  ns: MODEL_ROLES_NAMESPACE,
  schema: {},
  value: { acme: { 'acme-pro': { description: 'good at planning', subagent: true } } },
  applies: 'live',
  secrets: [],
  revision: 3,
}

/**
 * Compose the apply surface. The popup fiber always gets its three services;
 * the settings child fiber activates only when `settings` also provides
 * slots/locale/remote (the shell).
 */
async function bench(options: { settings?: boolean } = {}) {
  const ctx = new Context()
  const settings = options.settings !== false
  let slots: SlotRegistry | undefined
  let locale: LocaleRuntime | undefined
  if (settings) {
    await ctx.plugin(SlotRegistry).await()
    slots = ctx.get('slots')
    locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    new TestRemote(ctx)
  }
  let decoration: CommandDecoration | undefined
  ctx.provide('commandUi', {
    decorate: (d: CommandDecoration) => {
      decoration = d
      return () => { decoration = undefined }
    },
  })
  ctx.provide('connection', {
    api: {
      llm: { models: () => Promise.resolve(ok({ groups: GROUPS, failures: [] })) },
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [NAMESPACE] })),
        mutate: () => Promise.resolve(ok(NAMESPACE)),
      },
      sessions: {
        models: () => Promise.resolve(ok({ current: null as never, routable: true, groups: GROUPS, failures: [] })),
      },
    },
    isLoopback: true,
  } as never)
  ctx.provide('sessions', {
    scope: () => undefined,
    subagentAddress: () => undefined,
    sessionOf: () => undefined,
  } as never)
  return {
    ctx,
    slots: slots as SlotRegistry,
    locale: locale as LocaleRuntime,
    decoration: () => decoration,
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-subagent-model settings section apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['commandUi', 'connection', 'sessions'])
  })

  it('registers the section for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(ModelRolesSection)
    expect(entry.options).toMatchObject({ id: 'model-roles', order: 20 })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('子代理模型')
    const injected = (entry.inject as unknown as () => ModelRolesSectionInjected)()
    expect(injected.t('nav')).toBe('子代理模型')
    expect(typeof injected.controller.load).toBe('function')
    expect(typeof injected.useSnapshot).toBe('function')
    expect(injected.api).toBeDefined()

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')[0]!.component).toBe(ModelRolesSection)
  })

  it('the label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('子代理模型')
    const injected = b.slots.entries('settings.section')[0]!.inject as unknown as () => ModelRolesSectionInjected
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Subagent Models')
    expect(injected().t('nav')).toBe('Subagent Models')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('子代理模型')
  })

  it('re-registers after an HMR collapse re-declares the slot', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    // Declarer unload: the cascade removes our entry.
    redeclare()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')[0]!.component).toBe(ModelRolesSection)
    // The locale path recovers through the same ledger re-check.
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Subagent Models')
    b.locale.setLocale('zh')
  })

  it('registers the zh/en nav dictionaries and disposes everything with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings.model-roles')('nav')).toBe('子代理模型')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    // The (ns, locale) seats are free again — the dictionary disposers ran.
    expect(() => b.locale.register('settings.model-roles', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings.model-roles', 'en', {})).not.toThrow()
  })

  it('keeps the popup decoration when the settings shell is not composed', async () => {
    const b = await bench({ settings: false })
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The popup fiber is untouched by the absent settings shell.
    expect(b.decoration()?.name).toBe('subagent-model')
    expect(b.decoration()?.ui.kind).toBe('popupSelect')
  })
})

describe('pushed invalidations', () => {
  it('skips an idle page and routes loaded ones to the controller', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => ModelRolesSectionInjected)()
    const load = vi.spyOn(injected.controller, 'load').mockResolvedValue()

    // Idle: the model-roles invalidation does not fetch.
    b.ctx.remote.$dispatch('settings/document-updated', ['model-roles', 1])
    expect(load).not.toHaveBeenCalled()

    // Loaded: only the model-roles namespace refreshes.
    injected.controller.store.update((s) => { s.status = 'ready' })
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-deepseek', 2])
    expect(load).not.toHaveBeenCalled()
    b.ctx.remote.$dispatch('settings/document-updated', ['model-roles', 3])
    expect(load).toHaveBeenCalledTimes(1)
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    expect(load).toHaveBeenCalledTimes(2)
    b.ctx.emit('connection/reset')
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('refreshIfLoaded refreshes a loaded page and skips an idle one', () => {
    const loads: number[] = []
    const controller = {
      store: { getSnapshot: () => ({ status: 'ready' }) },
      load: () => { loads.push(1); return Promise.resolve() },
    }
    refreshIfLoaded(controller as unknown as ModelRolesSettingsStore)
    expect(loads).toHaveLength(1)
    const idle = {
      store: { getSnapshot: () => ({ status: 'idle' }) },
      load: () => { loads.push(2); return Promise.resolve() },
    }
    refreshIfLoaded(idle as unknown as ModelRolesSettingsStore)
    expect(loads).toHaveLength(1)
  })
})
