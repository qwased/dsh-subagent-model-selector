/**
 * REAL-composition guard for model-roles: a cordis.yml carrying the settings
 * provider, the loop spine, commands, session projections, and model-roles
 * boots through the actual Loader + Include path; only the LLM adapter is
 * mocked. The session's model directory does not exist here, so the test
 * drives the two model-visible outputs model-roles owns: the candidate rows
 * rendered from settings.yaml while nothing is pinned, and the fixed-route
 * guidance after `/subagent-model` executes through the real command
 * registry. The pin lands in the durable session log and the `model-roles`
 * projection.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import ModelRolesController from '@deepseek-ai/dsh-model-roles'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const ROLES_YAML = [
  'model-roles:',
  '  acme:',
  '    acme-flash:',
  '      description: execution strong and cheap, good for subagents',
  '      subagent: true',
  '    acme-pro:',
  '      description: high intelligence, good for planning',
  '      subagent: false',
  '',
].join('\n')

/** Boot the full composition and return the live context. */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-model-roles-loader-'))
  const settingsPath = join(root, 'settings.yaml')
  await writeFile(settingsPath, ROLES_YAML)

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    '- id: settings',
    "  name: '@deepseek-ai/dsh-settings-file'",
    '  config:',
    "    path: '" + settingsPath + "'",
    '    debounceMs: 10',
    "- name: '@deepseek-ai/dsh-model-roles'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-model-roles', ModelRolesController],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

function requestSystem(ctx: Context): string {
  const agent = [...ctx.agents.list()][0]
  if (agent === undefined) throw new Error('no agent registered')
  const header = agent.session.events.findLast(event => event.type === 'request/header')
  if (header === undefined || header.type !== 'request/header') throw new Error('no request/header event')
  return header.data.header.system ?? ''
}

describe('model-roles real Loader composition through cordis.yml', () => {
  it('renders candidate rows from settings.yaml into the model-visible system prompt', async () => {
    const ctx = await boot()
    expect(ctx.get('modelRoles')).toBeInstanceOf(ModelRolesController)
    const probe = { id: SessionId('probe'), options: {} } as never
    expect(ctx.commands.list(probe).map(command => command.name)).toContain('subagent-model')

    const adapter = new MockAdapter([textResponse('I will route subagents per the guidance.')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('loader-roles'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'delegate the subagent' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.system).toContain('Choose the model for each `subagent` delegation')
    expect(adapter.requests[0]?.system).toContain(
      '- provider `acme`, model `acme-flash`: execution strong and cheap, good for subagents',
    )
    expect(adapter.requests[0]?.system).not.toContain('acme-pro')
    // The same guidance is what the request/header log snapshots model-visible.
    expect(requestSystem(ctx)).toContain('Choose the model for each `subagent` delegation')
  })

  it('executes /subagent-model through the real command registry and pins the durable route', async () => {
    const ctx = await boot()
    const adapter = new MockAdapter([textResponse('Pinned, then delegates.')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('loader-pin'), { provider: 'mock', model: 'mock' })

    const outcome = await ctx.commands.execute(
      agent,
      '/subagent-model acme/acme-flash',
      new AbortController().signal,
    )
    expect(outcome?.result).toEqual({
      kind: 'success',
      text: 'Subagent model pinned to acme/acme-flash.',
    })

    const pin = agent.session.events.find(event => event.type === 'model-roles/subagent-pin')
    expect(pin?.type === 'model-roles/subagent-pin' && pin.data).toEqual({
      provider: 'acme',
      model: 'acme-flash',
    })
    const snapshot = ctx.sessionProjections.snapshot(agent.session)
    expect(snapshot.values['model-roles']).toEqual({ provider: 'acme', model: 'acme-flash' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'delegate now' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const last = adapter.requests.at(-1)
    expect(last?.system).toContain(
      "The user fixed this session's subagent model to provider `acme`, model `acme-flash`.",
    )
    expect(last?.system).not.toContain('Choose the model for each `subagent` delegation')
  })

  it('clears the pin with /subagent-model off and reports a bare call as noop', async () => {
    const ctx = await boot()
    const agent = ctx.agentLoop.create(SessionId('loader-clear'), { provider: 'mock', model: 'mock' })
    const signal = new AbortController().signal

    const empty = await ctx.commands.execute(agent, '/subagent-model', signal)
    expect(empty?.result).toEqual({ kind: 'success', text: 'No subagent model is pinned.' })

    const pinned = await ctx.commands.execute(agent, '/subagent-model acme/acme-flash', signal)
    expect(pinned?.result.text).toBe('Subagent model pinned to acme/acme-flash.')
    const cleared = await ctx.commands.execute(agent, '/subagent-model off', signal)
    expect(cleared?.result).toEqual({ kind: 'success', text: 'Subagent model pin cleared.' })
    expect(agent.session.events.findLast(event => event.type === 'model-roles/subagent-pin')
      ?.data).toEqual({ provider: null, model: null })
  })

  it('accepts a space-separated route and rejects malformed input with usage text', async () => {
    const ctx = await boot()
    const agent = ctx.agentLoop.create(SessionId('loader-space'), { provider: 'mock', model: 'mock' })
    const signal = new AbortController().signal

    const spaced = await ctx.commands.execute(agent, '/subagent-model acme acme-flash', signal)
    expect(spaced?.result).toEqual({
      kind: 'success',
      text: 'Subagent model pinned to acme/acme-flash.',
    })
    const again = await ctx.commands.execute(agent, '/subagent-model acme/acme-flash', signal)
    expect(again?.result).toEqual({
      kind: 'success',
      text: 'Subagent model already pinned to acme/acme-flash.',
    })

    for (const line of ['/subagent-model acme/', '/subagent-model lone']) {
      const malformed = await ctx.commands.execute(agent, line, signal)
      expect(malformed?.result).toEqual({
        kind: 'success',
        text: 'Usage: /subagent-model <provider>/<model>, or /subagent-model off to clear.',
      })
    }
  })
})
