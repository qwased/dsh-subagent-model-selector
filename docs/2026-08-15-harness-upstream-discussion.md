# Discussion draft（双语版 / Bilingual）— for deepseek-ai/deepseek-harness

> 发布到上游仓库的 Discussion；PR 通道当前关闭，本贴作为存档记录。
> 全部内容已脱敏（无凭据、无真实机器路径、无真实 provider 名）。
>
> Publish as a Discussion on the upstream repo; the PR channel is currently
> closed, so this serves as a durable record. All content is sanitized (no
> credentials, real machine paths, or real provider names).

---

## 标题 / Title

**中文：** `tool-subagent` 静默丢弃子代理路由覆盖（每调用 `agentOptions`）+ 两个面向仓库外（下游）插件的扩展点缺口

**English:** Subagent route override is silently dropped by `tool-subagent` (per-call `agentOptions`), plus two extension gaps for out-of-repo (downstream) plugins

---

## 背景 / Context

**中文：** 在安装并实机验证一个第三方「子代理模型角色」插件（基于 settings 的每模型能力描述 + 每会话子代理模型固定，指引委派模型在每次 `subagent` 调用时携带 `agentOptions: { provider, model }`）的过程中，遇到了三个 harness 侧问题，值得记录。第一个是 bug；另外两个是仓库外插件的扩展点缺口。

**English:** While installing and verifying a third-party "subagent model roles" plugin (settings-backed per-model capability descriptions + per-session subagent-model pinning that tells the delegating model to pass `agentOptions: { provider, model }` on each `subagent` call), I hit three harness-side issues worth recording. The first is a bug; the other two are extension-point gaps for out-of-repo (downstream) plugins.

---

## 1) `tool-subagent` 丢弃每调用 `agentOptions`（bug） / drops the per-call `agentOptions` (bug)

**症状 / Symptom**

**中文：** 委派模型在 `subagent` 工具调用中传入了 `agentOptions: { provider, model }`（会话轨迹中可见），但每个子代理仍路由到父代理**创建时**的默认路由——本例中是一条无效路由，导致子代理报 `subagent run failed`（适配器返回 HTTP 401），`list_agents` 也没有持久化的子代理。

**English:** The delegating agent passes `agentOptions: { provider, model }` on the `subagent` tool call (visible in the session trace), but every spawned child still routed to the parent's **creation-time** default route — in our case an invalid route, so children failed with `subagent run failed` (HTTP 401 from the adapter) and `list_agents` showed no durable children.

**根因 / Root cause**

**中文：** `packages/subagent/tool-subagent/src/index.ts` 的 `execute()` 只读取 `args.description` 与 `args.prompt`。`agentOptions` 未在工具 schema 中声明，参数被「接受但忽略」；于是 `request.agentOptions` 只可能来自插件 `config.agentOptions`（固定默认值）。`resolveChildAgentOptions(parent, request.agentOptions, depth)` 本身已经能正确合并请求级覆盖——问题在于工具层从未把它转发出去。

**English:** `packages/subagent/tool-subagent/src/index.ts`'s `execute()` only reads `args.description` and `args.prompt`. `agentOptions` was not declared in the tool schema and the argument was silently accepted-but-ignored, so `request.agentOptions` was only ever populated from the plugin's `config.agentOptions` (a fixed default). `resolveChildAgentOptions(parent, request.agentOptions, depth)` already merges a request override correctly — it is the tool that never forwards it.

**修复（本地已实现 + 已测试）/ Fix (implemented + tested locally)**

**中文：** 在工具 schema 中声明可选参数 `agentOptions`（`provider` / `model` / `maxTokens`），并在 `execute()` 中把每次调用的参数**逐字段合并覆盖** `config.agentOptions` 后再构造 provider 请求；不传该参数时行为与之前完全一致。更新并新增了测试，`packages/subagent/tool-subagent` 套件 **62/62 通过**。参考提交：公共 fork `qwased/deepseek-harness` 的 `fix/tool-subagent-agentoptions` @ `57ea25e`。

**English:** Declare an optional `agentOptions` parameter (`provider` / `model` / `maxTokens`) on the tool schema, and in `execute()` merge the per-call argument field-by-field over `config.agentOptions` before building the provider request. Omitting the argument preserves existing behavior exactly. Tests updated and added; the `packages/subagent/tool-subagent` suite passes 62/62. Reference commit: `fix/tool-subagent-agentoptions` @ `57ea25e` on the public fork `qwased/deepseek-harness`.

---

## 2) 仓库外插件无法新增持久化会话事件类型（缺口） / Out-of-repo plugins cannot add durable session event types (gap)

**症状 / Symptom**

**中文：** 插件写入自己的会话事件（例如 `model-roles/subagent-pin`）后，重启恢复该会话会失败：`SessionFormatUnsupportedError: session "…" contains event type "model-roles/subagent-pin" … unknown to this harness and not marked ignorable`。

**English:** A plugin that logs its own session events (e.g. a `model-roles/subagent-pin` event) makes those sessions un-resumable after restart: `SessionFormatUnsupportedError: session "…" contains event type "model-roles/subagent-pin" … unknown to this harness and not marked ignorable`.

**根因 / Root cause**

**中文：** `packages/core/session/src/known-event-types.ts` 中的 `KNOWN_SESSION_EVENT_TYPES` 是由 `scripts/gen-persistence-catalog.ts` 生成的**静态集合**，只收录仓库内的 `SessionEventMap` 成员。生成文件自身的注释写明：仓库外插件的自定义事件「按构造不在列表内」，且「为它们提供的注册面推迟到出现这样的消费者」——本插件正是第一个这样的消费者。

**English:** `KNOWN_SESSION_EVENT_TYPES` in `packages/core/session/src/known-event-types.ts` is a **generated** static set of in-repo `SessionEventMap` members (via `scripts/gen-persistence-catalog.ts`). The generated file's own comment states that downstream (out-of-repo) plugin events are outside the list "by construction" and that "a registration surface for them is deferred until such a consumer exists" — this plugin is that first consumer.

**建议 / Suggestion**

**中文：** 为下游会话事件类型提供**运行时注册面**（例如 `ctx.session.knownTypes.register(...)`），或提供受支持的方式让插件把自己的事件标记为 `ignorable`，使包含插件事件的持久化日志无需重新生成目录即可被解释。

**English:** Add a runtime registration surface for downstream session-event types (e.g. `ctx.session.knownTypes.register(...)`), or a supported way for a plugin to mark its own events `ignorable`, so a persisted log containing plugin events stays interpretable without regenerating the catalog.

---

## 3) 暴露给配置客户端的 settings 命名空间是硬编码的（缺口） / Settings namespaces exposed to configuration clients are hard-coded (gap)

**症状 / Symptom**

**中文：** 从客户端保存插件的 settings 命名空间失败：`settings namespace "model-roles" is not exposed to configuration clients`。

**English:** Saving a plugin's settings namespace from the client fails with `settings namespace "model-roles" is not exposed to configuration clients`.

**根因 / Root cause**

**中文：** 宿主 api-proxy 的 `PRODUCT_SETTINGS_NAMESPACES` 是一个固定集合；下游插件无法在不改 harness 的前提下把自己的命名空间声明为客户端可写。

**English:** The host api-proxy's `PRODUCT_SETTINGS_NAMESPACES` is a fixed set; a downstream plugin cannot declare its own namespace as client-writable without patching the harness.

**建议 / Suggestion**

**中文：** 让「可暴露命名空间列表」可扩展（插件自行注册命名空间），使第三方设置页无需打 harness 补丁即可持久化。

**English:** Make the exposable-namespace list extensible (plugins register their namespace), so third-party settings pages can persist without a harness patch.

---

## 状态 / Status

**中文：** PR 通道当前关闭，故以本贴存档。若 PR 重新开放，乐意把上述任何一项转为 PR；修复 #1 改动小、向后兼容、已有测试覆盖。

**English:** The PR channel is currently closed, so this is posted as a record. Happy to turn any of these into a PR when PRs reopen. Fix #1 is small, backward-compatible, and already covered by tests.
