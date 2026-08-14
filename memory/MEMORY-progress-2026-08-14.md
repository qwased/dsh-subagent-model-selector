# 子代理模型路由插件 — 交接记忆（2026-08-14 晚，阶段 C/D 完成 + 发布前校验）

> 本文件是唯一权威交接状态（MEMORY.md 仅保留目标与历史）。以下「已完成」均已在本机验证：
> `tsc -b tsconfig.host.json` 与 `tsc -b tsconfig.client.json` 绿、oxlint 绿、相关 vitest 绿、
> 新增 REAL-composition 测试绿、两个新包 src per-file 100% 覆盖、test:gui 272 通过（唯一失败为
> 已记录的 LAN authority 连接测试，与本工作无关）。

## 用户设计意图（原始需求 + 已确认决策，勿偏离）

### 用户提出的五条需求
1. **能力描述 + 指派开关**：添加第三方供应商模型时，可描述能力（「高智力适合规划」「执行力强且便宜适合做子代理」等）并加开关，允许/禁止被自动指派为子代理。
2. **会话内指定优先**：用户为当前对话指定子代理模型时，优先使用用户指定的某供应商的某模型。
3. **按描述自动指派**：用户未指定时，按描述把任务指派给合适的子代理。
4. **按复杂度选思考强度 + 返工升级**；`reasoningEffort` 不在 `AgentOptions`，已降级为「换更强模型」。
5. **热插拔、最小侵入**：全部走文档化扩展点，不碰 agent-loop。

### 已确认的三个设计决策
1. **元数据独立存放**：settings 命名空间 `model-roles`（provider → model → `{description, subagent}`）。
2. **三通道指定**：斜杠命令（`/subagent-model`）+ 对话自然表达 + 对话框 UI 控件。
3. **软执行**：固定/候选只进系统提示，主 agent 委派时带 `agentOptions`。

### 用户 UI 设计要求（阶段 C）
**选项框同时显示提供商、模型 ID、显示名称**（label=显示名，detail=`提供商 · 模型ID`）。
**选项与已填写的供应商信息保持同步**（选项来自 `session.models` 模型目录）。
**测试过程中只能使用 acme 的模型**（用户明确约束；默认 agent 模型已是 acme）。

## 现状一句话

阶段 A（seam 逐次 agentOptions）+ 阶段 B（model-roles 宿主插件）+ 阶段 D（base 全局挂载）
+ 阶段 C（/subagent-model popupSelect UI）全部完成并在本地 Web GUI 实机验证通过。本轮补齐了：
model-roles REAL-composition 测试、两个新包 src per-file 100% 覆盖、双语 README/Agent Note 配对、
全量 typecheck/oxlint/test:gui 复验。剩余：正式 PR（含阶段 C/D 的 Agent Note 增量已在仓库中更新）。

## 已完成（本会话验证）

### 阶段 B 增量：`model-roles` 会话投影单元（供 UI 读当前 pin）
`packages/subagent/model-roles/src/types.ts`：新增 `SubagentPinProjection`，声明
`SessionProjectionMap['model-roles']`（merge-extensible，plan-mode 范式）。
`src/client.ts`：客户端命名空间纯类型 re-export（`./client` 导出）。
`src/index.ts`：`ctx.inject(['sessionProjections'], ...)` 注册投影单元（key `model-roles`，
fold `model-roles/subagent-pin`，last-wins，stateVersion 1；未组合投影注册表的装配不受影响）。
package.json：新增 `./types`、`./client` 导出、`@deepseek-ai/dsh-session-projection` peer/dev、
`zod` 依赖。tsconfig 增引用。
测试：`tests/model-roles.spec.ts` 投影用例（空日志/折叠+清空/未组合无键/cold 回放）。

### 阶段 C：`packages/client/ui-subagent-model`（全新包 `@deepseek-ai/dsh-client-ui-subagent-model`）
`src/client/index.ts`：`commandUi.decorate({ name: 'subagent-model', kind: 'popupSelect' })`。
  - options：`session.models` 加载模型目录 → 每行 label=显示名、detail=`提供商 · 模型ID`；
    当前 pin（`session.projections.faceOf('model-roles').getSnapshot()`）匹配行标 active。
  - onSelect：`session.command('/subagent-model <provider>/<model>')`（复用已验证的宿主命令）。
  - available：`subagentAddress(sessionId) === undefined`（被寻址子代理会话不显示）。
三要素显示、选项与供应商同步均满足；手动带参调用不受影响（decoration 只装饰裸调用）。
包骨架齐全：package.json / tsconfig / tsdown.config.ts / src/index.ts（空 apply）/ src/invariant.ts
  / README(.zh/.i18n.yaml) / tests/browser-plugin.client.spec.ts。
注册三表面：tsconfig.client.json、packages/bundle/web-app/cordis.patch.yml、web-app/package.json。

### 阶段 D：挂载
**base bundle 全局挂载**（`packages/bundle/base/cordis.patch.yml` + package.json + pnpm-lock）：
  所有 profile 生效（headless 也挂载，插件 profile 无关）。
用户级 `$DSH_HOME/profiles/web/cordis.patch.yml` 的 model-roles 行已移除（base 提供，避免重复）。
解析链路：base/web-app deps → apps/cli closure → `$DSH_HOME/profiles/node_modules` fallback
  （heal 创建 junction，已确认 `dsh-client-ui-subagent-model` 链接存在）。

### 本轮新增：model-roles REAL-composition 测试
`packages/subagent/model-roles/tests/loader-composition.spec.ts`：cordis.yml 经真实 Loader+Include 启动
  （llm/session/system-prompt/tools/agent/agent-loop/commands/session-projection/settings-file/model-roles），
  仅 mock LLM adapter。
  - 用例 1：settings.yaml 的候选行渲染进模型可见系统提示（含 `subagent: false` 模型被排除）。
  - 用例 2：真实 commands 注册表执行 `/subagent-model` → pin 事件入日志 + 投影折叠 + 后续请求
    显示固定路由而非候选清单。
  - 用例 3/4：`/subagent-model off` 清除 / 空调用 noop / 空格分隔路由 / 畸形输入返回 usage 文本。
package.json devDependencies 新增 agent-loop/llm/tools/commands/settings-file/loader/include。

### 本轮新增：model-roles 单测补齐（覆盖门）
`tests/model-roles.spec.ts` 扩展：turn/end 后立即提交、pending pin 二次读取（noop/覆盖）、
  pre-step 接受刷新 / 拒绝保持、排队清除刷新、`model-roles:routing` 段落（无 pin 无角色为空 /
  固定路由文本 / 自定义 toolName / 无 agent 汇编为空）。
src/index.ts 两处真正不可达防御分支加了带理由的 `v8 ignore`（space 空段、toolName 兜底）。

### 本轮新增：client 单测补齐（覆盖门）
`tests/browser-plugin.client.spec.ts`：bench 增加 failModels/dead/rejectNextCommand 开关。
覆盖 scope 缺失/face 消失读无 pin、models 失败 loud、命令未接纳 loud、无斜杠 option id、
  onSelect 时会话已死 loud。

### 本轮新增：文档与记忆
`packages/subagent/model-roles/README.zh.md` 新建 + `README.i18n.yaml` 配对记录（修 verify-md-links 破链）。
Agent Note 三件套补充阶段 C/D/投影/REAL-composition/挂载内容并重新配对（en/zh/i18n.yaml）。
本文件（MEMORY-progress-2026-08-14.md）与 MEMORY.md 持续维护。

## 端到端验证（本地 Web GUI 实机，阶段 C/D 时已通过）
1. 命令菜单出现 `/subagent-model`（base 挂载生效）。
2. 裸调用 `/subagent-model` → popupSelect 打开，选项显示配置的供应商模型行
   （如 `provider-a · model-a`、`provider-b · model-b`），多个配置供应商都在——选项与供应商同步。
3. 选择某供应商模型 → 会话日志出现 `command/run subagent-model args=" provider-a/model-a"`
   与 `model-roles/subagent-pin {provider:"provider-a",model:"model-a"}`（示例值）。
4. 重新打开 popup → 匹配当前 pin 的行渲染勾选（DOM 确认），投影驱动 active 标记正常。
5. 全程只使用指定供应商的模型（用户约束）。

## 验证命令（本轮已绿）
`tsc -b tsconfig.host.json`、`tsc -b tsconfig.client.json`（注意 node 路径，见下）。
oxlint：`node --import tsx/esm scripts/run-oxlint.ts packages/client/ui-subagent-model packages/subagent/model-roles` → 0 错误。
vitest：两个新包全部用例（model-roles 23 + client 13 + loader-composition 4）绿；
  `--coverage.enabled` 下两个包 src per-file 100%（纯类型文件不触发阈值）。
`pnpm run test:gui`：272 通过 / 1 失败（唯一失败为已记录的 LAN authority 连接测试，与本工作无关）。
`pnpm run build`（tsdown 全量）绿。
`verify-md-links`、`verify-translation-pairing`（model-roles README + Agent Note 配对）绿。

## 环境/操作注意（通用）
**node 不在 PATH**：pnpm/tsc 前先把 Node 安装目录加入 PATH（便携运行时同理），
  否则 subprocess-local postinstall 失败（Windows 上本无害但会使 pnpm 命令整体失败）。
pnpm 使用工作区声明的版本（`pnpm --version` 查看；示例环境为 11.7.0）。
代理：按部署环境配置 HTTP(S)_PROXY（如 `http://127.0.0.1:<port>`），registry 需可达。
服务：按本机维护脚本重启（先按 Web GUI 端口结束进程，再启动）。
  宿主/客户端插件改动后需重启才生效；`web/cordis.patch.yml` 用户层 HMR 热加载。
前端：apps/web/dist 不内嵌客户端插件名（运行时经 registry 加载 lib/client.js），新客户端包无需重建 web dist。
git 未跟踪的非本次文件勿动：`.agents/skills/web-search/`、`newskill/`、`web-search-setup.md`、`dryrun.log.err`、`dsh-web-restart-status.txt`。

## 剩余待办（按序）
1. **PR**：master 已积累全部阶段改动（git status 列出 packages/subagent/*、client/ui-subagent-model、
   bundle/base+web-app、docs、Agent Note 三件套）。发布前跑 dsh-pre-push-checks 选最小检查集。
2. **doc-sync 全量**（可选，PR 前）：`pnpm run doc-sync` 覆盖全部文档 gate（README 双语、
   verify-translation-pairing corpus、verify-package-readme-limitations 等）。本轮已修 model-roles README 破链。
3. 可选：阶段 C 的 composer 常驻座（composer seat）尚未做（当前只有 popupSelect；用户要求聚焦选项框）。
4. 可选：popup 列出所有模型不区分 `subagent` 开关；专用 pin RPC 落地前不处理 `subagent: false`（已在 Agent Note 记录）。

## 关键架构结论（勿重复调研）
命令执行：客户端 `session.command(line)` / `commands.execute` → 宿主 commands 注册表 → model-roles 命令 handler。
当前 pin 读取：宿主投影单元 `model-roles`（whole-value fold，push frame 到客户端 projection store），
  UI 用 `faceOf('model-roles').getSnapshot()`（非 React 路径）。
选项数据源：`session.models` 返回配置供应商分组（ModelProviderGroup{id,name,models:ModelCatalogModel{id,name}}），
  天然与 settings 供应商同步（settings/document-updated 触发目录刷新）。
模型目录在多个适配器（如 llm-pi-ai、llm-deepseek）都配时会列出全部——同步即配置全集。
`SessionEvent` 经 apiproxy 宽 data 直通客户端（未知事件类型可折叠），但 UI 采用投影而非客户端折叠（官方范式）。
pre-step 排队刷新范式：plan-mode 同款（open turn 内 set() 排队，下一 accepted pre-step append）。
