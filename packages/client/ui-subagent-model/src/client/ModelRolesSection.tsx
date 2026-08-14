/**
 * Subagent model roles settings section: one row per model in the directory,
 * each carrying a capability-description draft and an auto-assignment
 * checkbox. Rows come from the model directory (`llm.models`), so they stay
 * in sync with the providers configured on the Models page; role values come
 * from the `model-roles` namespace, and every write goes through
 * `settings.mutate` with the expected revision. The host plugin hot-applies
 * its namespace, so a saved row is effective without a restart. A row without
 * a stored role falls back to the schema defaults (empty description,
 * `subagent: true`).
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { messageOf } from './model-roles-store.ts'
import type { ModelRole, ModelRolesSettingsStore, ModelRolesState, RoleRow } from './model-roles-store.ts'
import type { en } from './locales.ts'
import styles from './ModelRolesSection.module.css'

/** Injected dependencies of {@link ModelRolesSection} (slot `inject`). */
export interface ModelRolesSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelRolesSettingsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<ModelRolesState>
  /** Wire faces the editor writes through. */
  api: Pick<IApiClient, 'settings' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelRolesSectionProps = Partial<ModelRolesSectionInjected>

/** One editable role draft held by a row. */
interface RoleDraft {
  description: string
  subagent: boolean
}

/** The schema defaults a row with no stored role edits from. */
function defaultDraft(): RoleDraft {
  return { description: '', subagent: true }
}

/**
 * Per-row draft state: while clean, the value follows the external role (an
 * external change — a pushed invalidation reload, another editor — resyncs
 * the row); once the user edits, the draft stays until saved or cleared.
 * @param role - the row's stored role, if any.
 * @returns the displayed draft plus `edit` (mark dirty) and `reset` (clean).
 */
function useRoleDraft(role: ModelRole | undefined): {
  value: RoleDraft
  dirty: boolean
  edit: (next: RoleDraft) => void
  reset: () => void
} {
  const [draft, setDraft] = useState<RoleDraft | undefined>(undefined)
  const [dirty, setDirty] = useState(false)
  const value = dirty && draft !== undefined ? draft : role ?? defaultDraft()
  return {
    value,
    dirty,
    edit: (next) => {
      setDirty(true)
      setDraft(next)
    },
    reset: () => {
      setDirty(false)
      setDraft(undefined)
    },
  }
}

interface ModelRoleRowProps {
  /** The joined directory/role row this editor targets. */
  row: RoleRow
  /** Whether every write control is disabled (read-only settings provider). */
  readOnly: boolean
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** The page store, written through on save/clear. */
  controller: ModelRolesSettingsStore
  /** Called when a write lands, so the section can show the saved notice. */
  onSaved: () => void
  /** Called on the first edit of a draft, so the saved notice clears. */
  onEdit: () => void
}

/**
 * Render one model row: identity line, description draft, auto-assignment
 * switch, and the save/clear actions. Editing only touches the local draft —
 * the wire write happens on Save, so a row never leaks keystrokes into the
 * settings document.
 * @param props - row data and callbacks.
 * @returns the row card.
 */
function ModelRoleRow({ row, readOnly, t, controller, onSaved, onEdit }: ModelRoleRowProps): ReactNode {
  const { value, dirty, edit, reset } = useRoleDraft(row.role)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const descriptionBlank = value.description.trim() === ''
  // A description is only meaningful for auto-assigned subagent candidates.
  // Excluding a model (subagent off) needs no prose, so a blank description
  // only blocks a checked row.
  const descriptionRequired = descriptionBlank && value.subagent
  const saveable = !readOnly && !saving && !descriptionRequired
  const clearable = !readOnly && !saving && (row.role !== undefined || dirty)

  const save = (): void => {
    /* v8 ignore next -- the button only renders enabled when saveable */
    if (saving || descriptionRequired) return
    setSaving(true)
    setFailure(undefined)
    void controller.saveRole(row.provider, row.model, {
      description: value.description.trim(),
      subagent: value.subagent,
    }).then((writeFailure) => {
      if (writeFailure !== undefined) {
        setFailure(writeFailure)
        return
      }
      reset()
      onSaved()
    }).finally(() => { setSaving(false) })
  }

  const clear = (): void => {
    /* v8 ignore next -- the button only renders enabled when clearable */
    if (saving) return
    // No stored role: the draft is the only state, so clearing it is local.
    if (row.role === undefined) {
      reset()
      return
    }
    setSaving(true)
    setFailure(undefined)
    void controller.clearRole(row.provider, row.model).then((writeFailure) => {
      if (writeFailure !== undefined) {
        setFailure(writeFailure)
        return
      }
      reset()
      onSaved()
    }).finally(() => { setSaving(false) })
  }

  return (
    <li className={styles['rowCard']}>
      <div className={styles['rowHead']}>
        <span className={styles['rowIdentity']}>
          <span className={styles['rowName']}>{row.modelName}</span>
          <span className={styles['rowDetail']}>{row.providerName} · {row.model}</span>
        </span>
      </div>
      <label className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('description')}</span>
        <textarea
          className={styles['input']}
          rows={2}
          value={value.description}
          disabled={readOnly || saving}
          placeholder={t('descriptionPlaceholder')}
          aria-label={t('description')}
          onChange={(event) => {
            setFailure(undefined)
            onEdit()
            edit({ ...value, description: event.target.value })
          }}
        />
      </label>
      <label className={styles['switchRow']}>
        <input
          type="checkbox"
          checked={value.subagent}
          disabled={readOnly || saving}
          onChange={(event) => {
            setFailure(undefined)
            onEdit()
            edit({ ...value, subagent: event.target.checked })
          }}
        />
        <span>{t('allowSubagent')}</span>
      </label>
      {descriptionRequired && !readOnly ? <p className={styles['validation']}>{t('descriptionRequired')}</p> : null}
      {failure !== undefined ? <p className={styles['error']}>{`${t('writeFailed')}: ${messageOf(failure)}`}</p> : null}
      <div className={styles['rowActions']}>
        <button
          type="button"
          className={styles['primaryButton']}
          disabled={!saveable}
          onClick={save}
        >
          {saving ? t('saving') : t('save')}
        </button>
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={!clearable}
          onClick={clear}
        >
          {t('clear')}
        </button>
      </div>
    </li>
  )
}

/**
 * Render the subagent-model-roles section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelRolesSection(props: ModelRolesSectionProps): ReactNode {
  const { controller, useSnapshot, api, t } = props
  if (controller === undefined || useSnapshot === undefined || api === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, api, t }} />
}

function Loaded({ injected }: { injected: ModelRolesSectionInjected }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [saved, setSaved] = useState(false)

  if (state.status === 'idle') void controller.load()
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      {!state.writable && state.status === 'ready' ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
      {saved ? <p className={styles['savedNotice']} role="status" aria-live="polite">{t('saved')}</p> : null}
      {state.rows.length === 0
        ? <p className={styles['empty']}>{t('empty')}</p>
        : (
          <ul className={styles['rows']}>
            {state.rows.map(row => (
              <ModelRoleRow
                key={`${row.provider}/${row.model}`}
                row={row}
                readOnly={!state.writable}
                t={t}
                controller={controller}
                onSaved={() => { setSaved(true) }}
                onEdit={() => { setSaved(false) }}
              />
            ))}
          </ul>
        )}
    </div>
  )
}
