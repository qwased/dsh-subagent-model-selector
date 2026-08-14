# @deepseek-ai/dsh-model-roles

[English](README.md) | 中文

基于设置（settings）的子代理模型路由：一个 `model-roles` settings 命名空间保存每个模型的能力角色，
外加一个会话级固定的子代理模型（pin），以建议性指引的形式呈现给委派模型。循环内部不做任何路由，
也不触碰任何供应商适配器的 schema。

## 角色与固定（Roles and pinning）

`model-roles` settings 命名空间按「提供商路由 → 模型 ID → `{ description, subagent }`」组织。
`description` 是用于按任务路由的能力描述；`subagent`（默认 `true`）控制该模型在用户未指定时
是否可以被自动指派为子代理。

`/subagent-model <provider>/<model>` 命令固定当前会话的子代理模型；`/subagent-model off` 清除固定。
pin 被记录为 `model-roles/subagent-pin`（last wins），因此恢复与 fork 会还原它，并被渲染进
`model-roles:routing` 系统提示段落。路由是软执行：该段落指示委派模型在每次 `subagent` 工具调用时
带上 `agentOptions`，这要求子代理提供方具备 `agentOptions` 能力（进程内 `spawn`/`fork`）。

## 配置

| 键 | 含义 |
|---|---|
| `toolName` | 指引所指向的面向模型的子代理工具名，默认 `subagent`。 |

## 模型体验

### 提示段落

#### 模型看到什么

当存在 pin 时，是一段简短的指令，指名固定的 provider/model 以及要传递的 `agentOptions`。
否则，当存在角色候选时，是一份 `provider / model: description` 列表，外加「按任务匹配度选择、
传递 `agentOptions`、结果不理想时用更强的候选重新委派」的规则。无 pin 且无候选时渲染为空。

#### Token 影响

仅在存在 pin 或至少一个可自动指派角色时出现一个短段落；长度随描述的模型数量增长。

#### KV 缓存影响

角色与 pin 不变时前缀稳定；角色编辑或 pin 切换会改变后续请求的段落文本。

### 命令

#### 模型看到什么

`/subagent-model` 以斜杠命令运行，永不进入模型；其成功文本是展示给用户的状态变更反馈。

#### Token 影响

除 `model-roles/subagent-pin` 日志事件外无其他；该事件仅入日志，不在模型历史中。

#### KV 缓存影响

无；该事件仅入日志。

## 已知限制与待办

- **路由是建议性的** —— pin 与候选列表只靠模型配合执行；不配合的模型可以忽略它们。
  确定性路由需要拦截 `subagent` 工具调用。
- **路由不针对 LLM 注册表校验** —— 指名未注册 provider/model 的 pin 或角色会在委派时失败
  （`NO_ADAPTER`），而非在固定时失败。
- **每个子代理的推理强度不在范围内** —— `agentOptions` 只携带 `provider`/`model`/`maxTokens`；
  提升思考强度意味着选择更强的模型。
