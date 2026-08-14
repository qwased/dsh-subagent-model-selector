// @vitest-environment jsdom
/** The section's rendering rules: per-model drafts, the auto-assignment switch, and the write/clear flows. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ModelRolesSection } from '../src/client/ModelRolesSection.tsx'
import type { ModelRolesSectionProps } from '../src/client/ModelRolesSection.tsx'
import type { ModelRolesSettingsStore } from '../src/client/model-roles-store.ts'
import type { ModelRolesState, RoleRow } from '../src/client/model-roles-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const ROW: RoleRow = {
  provider: 'acme',
  providerName: 'Acme',
  model: 'acme-flash',
  modelName: 'Acme Flash',
  role: undefined,
}

const ROW_WITH_ROLE: RoleRow = {
  provider: 'acme',
  providerName: 'Acme',
  model: 'acme-pro',
  modelName: 'Acme Pro',
  role: { description: 'good at planning', subagent: true },
}

interface HarnessOptions {
  saveRole?: () => Promise<string | undefined>
  clearRole?: () => Promise<string | undefined>
  load?: () => Promise<void>
}

function renderSection(state: Partial<ModelRolesState> = {}, options: HarnessOptions = {}) {
  const store = createSnapshotStore<ModelRolesState>({
    status: 'idle',
    error: null,
    writable: true,
    revision: 0,
    rows: [],
    ...state,
  })
  const controller = {
    store,
    load: vi.fn(options.load ?? (() => Promise.resolve())),
    saveRole: vi.fn(options.saveRole ?? (() => Promise.resolve(undefined))),
    clearRole: vi.fn(options.clearRole ?? (() => Promise.resolve(undefined))),
  }
  const props = {
    controller: controller as unknown as ModelRolesSettingsStore,
    useSnapshot: bindSnapshotSelector(store),
    api: {} as never,
    t: (key: keyof typeof en) => en[key],
  } as unknown as ModelRolesSectionProps
  render(<ModelRolesSection {...props} />)
  return { controller, store }
}

/** Locate a row card by the model display name it prints. */
function rowFor(name: string): HTMLElement {
  const node = screen.getByText(name)
  const row = node.closest('li')
  /* v8 ignore next -- every rendered row prints its model name */
  if (row === null) throw new Error(`no row for ${name}`)
  return row
}

describe('ModelRolesSection composition', () => {
  it('renders nothing until the shell injects its dependencies', () => {
    const { container } = render(<ModelRolesSection />)
    expect(container.firstChild).toBeNull()
    cleanup()
    // A partial inject face (one member missing) still withholds the page.
    const partial = render(
      <ModelRolesSection {...({ controller: undefined } as unknown as ModelRolesSectionProps)} />,
    )
    expect(partial.container.firstChild).toBeNull()
  })

  it('loads the page once on first render while idle', () => {
    const { controller } = renderSection()
    expect(controller.load).toHaveBeenCalledTimes(1)
  })

  it('shows the empty message when no models are configured', () => {
    renderSection({ status: 'ready', rows: [] })
    expect(screen.getByText(en.title)).toBeTruthy()
    expect(screen.getByText(en.empty)).toBeTruthy()
  })

  it('offers a retry on a load failure and reloads through the controller', () => {
    const { controller } = renderSection({ status: 'error', error: 'directory down' })
    expect(screen.getByText(`${en.loadFailed}: directory down`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(controller.load).toHaveBeenCalledTimes(1)
  })

  it('renders one row per model with the provider identity and model detail', () => {
    renderSection({
      status: 'ready',
      rows: [
        ROW,
        { provider: 'vertex', providerName: 'Vertex', model: 'gemini', modelName: 'Gemini', role: { description: 'fast', subagent: false } },
      ],
    })
    expect(screen.getByText('Acme Flash')).toBeTruthy()
    expect(screen.getByText('Acme · acme-flash')).toBeTruthy()
    expect(screen.getByText('Gemini')).toBeTruthy()
    expect(screen.getByText('Vertex · gemini')).toBeTruthy()
    // The stored role populates the second row's draft.
    const textareas = screen.getAllByRole('textbox', { name: en.description })
    expect((textareas[0] as HTMLTextAreaElement).value).toBe('')
    expect((textareas[1] as HTMLTextAreaElement).value).toBe('fast')
    expect(screen.getAllByRole('checkbox')[1]).toHaveProperty('checked', false)
  })

  it('explains a read-only document and disables every write control', () => {
    renderSection({ status: 'ready', writable: false, rows: [ROW_WITH_ROLE] })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    const row = rowFor('Acme Pro')
    expect(within(row).getByRole('textbox', { name: en.description })).toHaveProperty('disabled', true)
    expect(within(row).getByRole('checkbox')).toHaveProperty('disabled', true)
    expect(within(row).getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(within(row).getByRole('button', { name: en.clear })).toHaveProperty('disabled', true)
    // A read-only row never suggests a missing description as an error.
    expect(within(row).queryByText(en.descriptionRequired)).toBeNull()
  })
})

describe('ModelRolesSection drafts and writes', () => {
  it('blocks saving a blank description and explains why', () => {
    renderSection({ status: 'ready', rows: [ROW] })
    const row = rowFor('Acme Flash')
    expect(within(row).getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(within(row).getByText(en.descriptionRequired)).toBeTruthy()
    // The clear control is inert too: there is no stored role and no draft.
    expect(within(row).getByRole('button', { name: en.clear })).toHaveProperty('disabled', true)
  })

  it('saves an edited description and switch through the controller and shows the saved notice', async () => {
    const { controller } = renderSection({ status: 'ready', rows: [ROW] })
    const row = rowFor('Acme Flash')
    fireEvent.change(within(row).getByRole('textbox', { name: en.description }), { target: { value: 'fast and cheap' } })
    // The draft starts with auto-assignment on; this row opts it off.
    fireEvent.click(within(row).getByRole('checkbox'))
    fireEvent.click(within(row).getByRole('button', { name: en.save }))

    expect(controller.saveRole).toHaveBeenCalledWith('acme', 'acme-flash', {
      description: 'fast and cheap',
      subagent: false,
    })
    await waitFor(() => { expect(screen.getByText(en.saved)).toBeTruthy() })
    // The save button is back to its idle label once the write settles.
    expect(within(row).getByRole('button', { name: en.save })).toBeTruthy()
  })

  it('reports a write failure on the row instead of a saved notice', async () => {
    renderSection({ status: 'ready', rows: [ROW] }, {
      saveRole: () => Promise.resolve('the host refused'),
    })
    const row = rowFor('Acme Flash')
    fireEvent.change(within(row).getByRole('textbox', { name: en.description }), { target: { value: 'fast' } })
    fireEvent.click(within(row).getByRole('button', { name: en.save }))

    await waitFor(() => { expect(within(row).getByText(`${en.writeFailed}: the host refused`)).toBeTruthy() })
    expect(screen.queryByText(en.saved)).toBeNull()
  })

  it('labels an in-flight save and blocks a second click', async () => {
    let resolveSave: ((value: string | undefined) => void) | undefined
    const pending = new Promise<string | undefined>((resolve) => { resolveSave = resolve })
    const { controller } = renderSection({ status: 'ready', rows: [ROW] }, {
      saveRole: () => pending,
    })
    const row = rowFor('Acme Flash')
    fireEvent.change(within(row).getByRole('textbox', { name: en.description }), { target: { value: 'fast' } })
    const save = within(row).getByRole('button', { name: en.save })
    fireEvent.click(save)
    expect(within(row).getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
    // The in-flight write cannot be re-entered.
    fireEvent.click(within(row).getByRole('button', { name: en.saving }))
    expect(controller.saveRole).toHaveBeenCalledTimes(1)
    await act(async () => { resolveSave?.(undefined) })
  })

  it('clears a stored role through the controller and shows the saved notice', async () => {
    const { controller } = renderSection({ status: 'ready', rows: [ROW_WITH_ROLE] })
    fireEvent.click(within(rowFor('Acme Pro')).getByRole('button', { name: en.clear }))
    expect(controller.clearRole).toHaveBeenCalledWith('acme', 'acme-pro')
    await waitFor(() => { expect(screen.getByText(en.saved)).toBeTruthy() })
  })

  it('reports a clear failure on the row instead of a saved notice', async () => {
    renderSection({ status: 'ready', rows: [ROW_WITH_ROLE] }, {
      clearRole: () => Promise.resolve('the host refused'),
    })
    const row = rowFor('Acme Pro')
    fireEvent.click(within(row).getByRole('button', { name: en.clear }))
    await waitFor(() => { expect(within(row).getByText(`${en.writeFailed}: the host refused`)).toBeTruthy() })
    expect(screen.queryByText(en.saved)).toBeNull()
  })

  it('clears an unsaved draft locally without a wire call', () => {
    const { controller } = renderSection({ status: 'ready', rows: [ROW] })
    const row = rowFor('Acme Flash')
    fireEvent.change(within(row).getByRole('textbox', { name: en.description }), { target: { value: 'draft' } })
    fireEvent.click(within(row).getByRole('button', { name: en.clear }))
    expect(controller.clearRole).not.toHaveBeenCalled()
    expect(within(row).getByLabelText(en.description)).toHaveProperty('value', '')
  })

  it('resyncs clean rows and keeps dirty drafts when the stored role changes externally', () => {
    const store = createSnapshotStore<ModelRolesState>({
      status: 'ready',
      error: null,
      writable: true,
      revision: 0,
      rows: [
        ROW_WITH_ROLE,
        { provider: 'vertex', providerName: 'Vertex', model: 'gemini', modelName: 'Gemini', role: undefined },
      ],
    })
    const controller = {
      store,
      load: vi.fn(() => Promise.resolve()),
      saveRole: vi.fn(() => Promise.resolve(undefined)),
      clearRole: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as ModelRolesSettingsStore
    render(<ModelRolesSection controller={controller} useSnapshot={bindSnapshotSelector(store)} api={{} as never} t={key => en[key]} />)

    // Dirty the first row's draft.
    fireEvent.change(within(rowFor('Acme Pro')).getByRole('textbox', { name: en.description }), { target: { value: 'edited draft' } })

    act(() => {
      store.update((s) => {
        s.rows = [
          { ...ROW_WITH_ROLE, role: { description: 'external A', subagent: false } },
          { provider: 'vertex', providerName: 'Vertex', model: 'gemini', modelName: 'Gemini', role: { description: 'external B', subagent: true } },
        ]
      })
    })

    // The dirty row keeps its draft; the untouched row follows the new value.
    expect(within(rowFor('Acme Pro')).getByLabelText(en.description)).toHaveProperty('value', 'edited draft')
    expect(within(rowFor('Gemini')).getByLabelText(en.description)).toHaveProperty('value', 'external B')
  })
})
