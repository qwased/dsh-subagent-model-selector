# Agent Note：子代理模型路由

Status: implemented

[English](2026-08-14-subagent-model-routing.md) | 中文

## 问题

在配置了多个第三方供应商与模型时，父 agent 会把每个子代理委派到同一条路由上：父级自己的模型，或一个部署级固定的 `tool-subagent` `agentOptions`。既无法描述每个模型擅长什么、无法为当前会话固定某个供应商/模型、无法禁止某个模型被自动指派，也无法让委派模型按任务选择——面向模型的 `subagent` 工具不暴露任何逐次调用路由。

## 决策

### `agentOptions` 启动能力

`SubagentCapabilities` 新增必填的 `agentOptions` 标志，由 `assertCapabilities` 在 `start` 之前校验。进程内提供方（`spawn`/`fork`）声明 `true`；`NO_START_CAPABILITIES` 与 ACP 提供方声明 `false`，因此一个进程外提供方原本会静默忽略的请求现在会被明确拒绝（`UNSUPPORTED_CAPABILITY`）。

### 委派工具的逐次调用路由

`tool-subagent` 仅在绑定的提供方具备该能力时，公开一个可选的 `agentOptions` 对象参数（`provider`/`model`/`maxTokens`）。逐次字段覆盖部署级 `config.agentOptions`；无该能力时的配置或逐次覆盖会导致挂载或调用失败。

### `model-roles` 路由插件

`@deepseek-ai/dsh-model-roles` 拥有一个 `model-roles` settings 命名空间（provider → model → `{ description, subagent }`），以及一个按会话记录的 pin（`model-roles/subagent-pin`，整体值替换、后者胜出）。系统提示段渲染被固定的路由，或 `subagent: true` 候选及其描述，指示委派模型传递 `agentOptions`。`/subagent-model <provider>/<model>` 固定，`/subagent-model off` 清除。路由是建议性的（软执行）：模型通过逐次 `agentOptions` 协作，没有任何机制拦截工具调用。pin 切换在回合之间立即提交，在回合进行中保持排队，并在下一个被接受的 `agent/pre-step` 处刷新（与 plan-mode 相同的模式）。

### `model-roles` 会话投影

同一插件注册一个 `model-roles` 会话投影单元（pin 的整体值折叠，`stateVersion` 1），使客户端表面能从投影 store 读取当前 pin，而无需自行折叠日志。该单元子项仅在组合了投影注册表时激活；headless 装配不受影响。

### 基于模型目录的浏览器选择器

`@deepseek-ai/dsh-client-ui-subagent-model` 把宿主的 `/subagent-model` 命令装饰为 `popupSelect`。选项来自会话的模型目录（`session.models`），因此选项框始终与已配置的供应商同步；每行在 label 行显示显示名称，在 detail 行显示 `提供商 · 模型ID`，与当前 pin（从 `model-roles` 投影读取）匹配的行标为选中。选择一行会执行宿主命令行，因此手动带参调用不受影响。被寻址的子代理会话不显示选项框。

### 全局挂载

`packages/bundle/base` 同时挂载 `model-roles` 与 `client-ui-subagent-model`，使每个 profile（含 headless）都获得路由接缝；`web-app` 为 web profile 添加浏览器侧。

## 考虑过的替代方案

- **确定性路由**：通过 `tools/pre-execute` 改写工具参数——首版被否决，因为它把决策从转录中隐藏起来，并干扰模型自身的判断；软路由让选择保持模型可见且可记录。
- **用 `reasoningEffort` 扩展 `AgentOptions`** 以实现逐子代思考强度——被否决：`reasoningEffort` 位于 `ModelSelection`/`LlmCallConfig`，而非 `AgentOptions`，逐子代接入会触及核心循环。思考强度升级改为选择更强的模型来表达。

## 测试

`tool-subagent` 测试覆盖逐次合并、逐次拒绝、挂载期拒绝与 schema 暴露。`model-roles` 测试覆盖 pin 折叠、`set` 的 commit/queue/noop、排队清除路径、pre-step 刷新与路由指引段落。REAL-composition 套件通过 Loader 启动一个 cordis.yml，包含设置提供方、循环主干、命令、会话投影与 model-roles，然后通过 mock adapter 驱动模型可见的系统提示，并通过真实命令注册表驱动 `/subagent-model` 命令。`client-ui-subagent-model` 测试覆盖选项行、选中标记、命令执行与失败分支（会话已死、模型目录失败、命令未被接纳）。subagent、sdk/server 与 workflow 测试套件中的 `SubagentCapabilities` 字面量均已更新；Codex 与 Claude Code 的 loader-composition e2e 断言 `agentOptions: false`。

## 后果

- 进程外提供方（ACP、Codex、Claude Code、dsh-sdk）会明确拒绝逐子代路由；当前只有进程内 `spawn`/`fork` 支持路由。
- pin 与候选清单是建议性的：模型可以忽略它们。确定性强制已延期。
- 角色路由不针对 LLM 注册表校验；命名未注册路由的 pin 或角色会在委派时失败（`NO_ADAPTER`）。
- 选项框列出所有已配置模型，不区分其 `subagent` 开关；专用 pin RPC（让选择器能拒绝 `subagent: false` 模型）已延期。
