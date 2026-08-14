# 子代理模型路由插件 — 任务记忆

目标：让用户在 DeepSeek Harness 中可配置「每个模型的能力描述 + 是否允许被自动指派为子代理」，支持
「命令 / 对话自然表达 / 对话框 UI」三通道指定当前对话的子代理模型，未指定时按描述自动指派。

用户已确认的三个设计决策：
1. 元数据存放：**独立 settings 命名空间 `model-roles`**（provider → model → {description, subagent}），
   不改动 llm-pi-ai 适配器 schema，对所有供应商生效。
2. 会话内子代理模型指定：**斜杠命令 + 对话自然表达 + 对话框 UI 控件**三通道都要。
3. 固定子代理模型后的执行：**系统提示软执行**（注入固定模型/可选清单+描述，要求主 agent 委派时带 agentOptions）。

## 当前进度

> **全部完成并在本地 Web GUI 实机验证通过（2026-08-14 晚）**。权威交接状态见 `MEMORY-progress-2026-08-14.md`。
> 发布前校验（typecheck / oxlint / 覆盖门 / REAL-composition / 双语配对）已在本轮全部绿。

- [x] 阶段 A（基础能力）：`tool-subagent` 支持按次调用传入 `agentOptions`（provider/model/maxTokens），
      按 `SubagentCapabilities.agentOptions` 能力开关校验；进程外提供方拒绝（UNSUPPORTED_CAPABILITY）。
- [x] 阶段 B（model-roles 宿主插件）：settings 命名空间 + ctx.modelRoles 服务 + 系统提示段 + /subagent-model 命令 + 会话投影单元。
- [x] 阶段 C（对话框 UI 控件）：`client-ui-subagent-model` popupSelect（三要素显示 + 供应商同步 + active 标记）。
- [x] 阶段 D（部署接入）：base bundle 全局挂载 + web-app 挂 UI + 重启 + 本地 Web GUI 实机验证。
- [x] 发布前校验：model-roles REAL-composition 测试（Loader+cordis.yml+真实 commands）；
      两个新包 src per-file 100% 覆盖（含防御分支与 v8 ignore）；双语 README/Agent Note 配对。

## 阶段 A 改动清单（已完成）
- `packages/subagent/subagent/src/types.ts`：`SubagentCapabilities` 新增必填 `agentOptions: boolean`。
- `packages/subagent/subagent/src/index.ts`：`assertCapabilities` 增加 `agentOptions` 检查（fail loud）。
- `subagent-spawn-in-process` / `subagent-fork-in-process`：capabilities 增加 `agentOptions: true`。
- `subagent/src/out-of-process.ts`（NO_START_CAPABILITIES）与 `subagent-acp`：增加 `agentOptions: false`。
- `tool-subagent/src/index.ts`：`DelegationRouteOverride` 类型 + `mergeAgentOptions()`；
  mount 按 provider.capabilities.agentOptions 条件暴露 schema 参数；execute 合并/拒绝（per-call 优先）。
- 测试字面量全量补 `agentOptions`；tool-subagent.spec 覆盖合并/拒绝/schema；Codex/Claude e2e 断言 false。
- `scripts/gen-tool-catalog.ts` mock provider 补 `agentOptions: true`，docs/tool-catalog.md 已重新生成。

## 关键架构事实（探索结论）

- 模型可见的 `subagent` 工具由 `packages/subagent/tool-subagent` 提供；每个实例绑定一个子代理
  transport provider（spawn/fork/acp/sdk/codex/claude-code），`config.agentOptions` 是部署级固定路由，
  模型之前无法按次指定 → 阶段 A 解决。
- **两个「provider」概念要区分**：子代理 transport（ctx.subagents 注册名）vs LLM 路由
  （AgentOptions.provider/model，如 `acme`）。示例「acme 的 Acme Flash」是 LLM 路由：
  provider=`acme`，model=`acme-flash`（displayName `Acme Flash`）。
- 进程内提供方（spawn/fork）通过 `resolveChildAgentOptions`（subagent/src/child-agent.ts）把
  `request.agentOptions` 覆盖到继承的父路由；continuable 路径在 continuation.ts 同样处理。
- 子代理能力集 `SubagentCapabilities`：outputSchema/depthLimit/toolFilter/persona（已加 agentOptions）。
  进程内=全支持；out-of-process=NO_START_CAPABILITIES（全 false）。
- 模型目录/设置：`llm-pi-ai.providers.<p>.models` 在 `$DSH_HOME/settings.yaml`；默认路由示例
  `agent-default-model: {provider: acme, model: acme-flash, reasoningEffort: high}`。
- 会话级状态范式：`plan-mode` 用 logged session event（`plan/mode`，last-wins）+ `agent/pre-step` 在
  步骤接受时 append + `ctx.systemPrompt.section` 渲染；命令注册 `ctx.commands.register({name, description, input, handler})`。
  子代理 pin 同款：事件 `model-roles/subagent-pin`（model-hidden，因它进系统提示=模型可见，必须可重建）。
- 设置命名空间：`ctx.settings`（`packages/settings/settings`），`settings/updated` 事件；
  pi-ai 用 `registerNamespace`/validator 模式（见 llm-pi-ai/src/index.ts）。
- GUI 部署：`pnpm dsh web`（apps/cli/src/bin.ts web），web profile 组合在 `$DSH_HOME/profiles/web/`；
  后端 TS 经 tsx 直接跑源码 → 改后端代码需重启进程生效，无需前端构建；改前端才需 `pnpm run build:web` + 刷新。
- 客户端插件规范见 packages/client/AGENTS.md（槽系统、四 props share、目录制度、dsh.client manifest、
  web-app bundle 三处注册）。参考 `client-ui-model-selection`（/model 命令 + composer seat 模式）。
- tool-catalog 由 scripts/gen-tool-catalog.ts 启动每个 tool 插件生成 docs/tool-catalog.md；`pnpm run gen-tool-catalog` 重新生成。
- 仓库规范：package 命名 `@deepseek-ai/dsh-<name>`；ESM；注册走 ctx.effect；README/JSDoc 随改随更；
  非平凡改动需 Agent Note（`.agents/notes/implemented/...`）；测试走 vitest，CI 按文件 100% 覆盖率。

## 部署相关
- 视部署环境而定：可配置 HTTP(S) 代理（如 `http://127.0.0.1:<port>`），registry 需可达。
- 重启方式：按 Web GUI 端口结束进程后重新启动服务（本机维护脚本按部署约定）。
