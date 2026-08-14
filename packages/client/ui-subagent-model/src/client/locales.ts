/** Copy dictionaries for the subagent-model-roles settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Subagent Models',
  title: 'Subagent Models',
  intro: 'Describe what each model is good at. When you have not pinned a subagent model, the delegating agent auto-assigns tasks to the models you allow here, using these descriptions.',
  description: 'Capability description',
  descriptionPlaceholder: 'E.g. high intelligence, good at planning',
  allowSubagent: 'Allow automatic subagent assignment',
  save: 'Save',
  saving: 'Saving\u2026',
  saved: 'Saved.',
  clear: 'Clear',
  readOnly: 'The settings document is read-only in this deployment.',
  loadFailed: 'Loading the model directory failed',
  retry: 'Retry',
  empty: 'No models are configured yet. Add a provider and model first, then describe them here.',
  descriptionRequired: 'Enter a capability description before saving.',
  writeFailed: 'Saving failed',
}

/** The settings.model-roles namespace key union. */
export type ModelRolesKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in keyof typeof en]: string } = {
  nav: '子代理模型',
  title: '子代理模型',
  intro: '为每个模型描述其擅长领域。未固定子代理模型时，主代理会按这些描述，把任务自动指派给你在这里允许的模型。',
  description: '能力描述',
  descriptionPlaceholder: '例如：高智力，适合规划',
  allowSubagent: '允许自动指派为子代理',
  save: '保存',
  saving: '保存中…',
  saved: '已保存。',
  clear: '清除',
  readOnly: '当前部署的设置文档为只读。',
  loadFailed: '加载模型目录失败',
  retry: '重试',
  empty: '尚未配置任何模型。请先在“模型”页添加提供方与模型，再回到这里描述。',
  descriptionRequired: '请先填写能力描述，再保存。',
  writeFailed: '保存失败',
}
