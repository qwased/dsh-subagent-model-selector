# 交接：子代理模型选择插件 安装 + 实机验证（2026-08-15 第三轮）

> 本文件是**新对话窗口的唯一权威交接状态**。任务：把
> `@deepseek-ai/dsh-model-roles`（宿主）+ `@deepseek-ai/dsh-client-ui-subagent-model`（浏览器 UI）
> 安装进实际运行的 DeepSeek Harness，并完成实机验证（含真实子代理委派）。
> **所有记忆文件会随 <SELECTOR_DIR> 推送 GitHub 公开仓库，必须保持脱敏**
> （占位符 `<CLONE_DIR>`/`<VERIFY_HOME>`/`<USER_HOME>`/`<DESKTOP_APP_DIR>`，不写真实用户名/盘符路径/密钥值）。

## 用户指令与已确认决策（勿偏离）

1. 源码克隆完整实机验证（Part A，不碰桌面应用）+ 把宿主插件注入桌面应用 web profile（Part B）——**两者都做**。
2. Part B 动手前必须先做好**备份/回退方案**，避免 DSH 彻底损坏（见「Part B 备份/回退」节）。
3. 用户已在测试 DSH 配置了可用模型 API + 模型描述，允许测试真实分派任务唤起子代理。

## 当前进度总览

| 阶段 | 状态 |
| --- | --- |
| 代码 + 单测 + 文档 + 推送 selector 仓库 | ✅ 完成（round2，commit 已推送；历史已脱敏重写） |
| Part A：克隆内四注册 + 构建（host lib / client lib / web 前端） | ✅ 完成 |
| Part A：起独立实例（<VERIFY_HOME>） | ✅ 运行中（127.0.0.1:3080，PID 见下文） |
| Part A：设置页验证 | ✅ 通过（含保存到 settings.yaml） |
| Part A：/subagent-model popup + pin | ✅ 通过 |
| Part A：真实委派唤起子代理 | ❌ **失败**——已定位根因，**待修复重测**（见「根因调查」节） |
| Part B：注入桌面应用宿主插件 | ⏳ 未开始（备份方案已定） |

## 环境事实（脱敏）

- **<CLONE_DIR>**（<CLONE_DIR>）：deepseek-harness 克隆（commit 47f9438，0.1.0-rc.5），
  工作树已修改属正常（本地集成副本，未提交）。Node 24.19，用 **`corepack pnpm`**（裸 `pnpm` 不在 PATH）。
- **<SELECTOR_DIR>**（<SELECTOR_DIR>）：独立 GitHub 仓库（仅两个插件包 + docs + memory），
  已推送、历史已脱敏。**记忆文件写在这里会被公开，务必用占位符。**
- **<VERIFY_HOME>**（<VERIFY_HOME>）：Part A 独立测试 DSH_HOME，含用户配置：
  - `llm-pi-ai.providers.tokenrhythm`（tokenrhythm.studio/v1，openai-responses）：`deepseek-v4-pro`、`deepseek-v4-flash-0731`
  - `model-roles`：tokenrhythm 两模型 `subagent: true` + 描述；deepseek-official/deepseek-v4-flash 为 false（早期测试所留）
  - `agent-default-model: {provider: tokenrhythm, model: deepseek-v4-pro}`
  - `.credentials.yaml`：`TOKENRHYTHM_API_KEY`（**有效**）、`DEEPSEEK_API_KEY`（**无效，401**——勿依赖 deepseek-official 路由）
  - `sessions\<workspace-derived>\`：父会话 + 3 个子代理会话（zstd 压缩）
- **桌面应用**：`<DESKTOP_APP_DIR>`（打包版 Electron，非源码）；
  运行时包从 `<USER_HOME>\.dsh\profiles\node_modules\@deepseek-ai\*` 解析；web profile 在
  `<USER_HOME>\.dsh\profiles\web\`（cordis.yml 为空数组，patch 在 cordis.patch.yml）。
  `dsh-model-roles` / `dsh-client-ui-subagent-model` 均**未安装**。
- 桌面应用当前正在运行（勿随意杀；Part B 重启前先备份）。

## Part A 集成改动（全部在 <CLONE_DIR>，本地未提交）

1. `packages/bundle/base/package.json`：dependencies 增 `@deepseek-ai/dsh-model-roles`
2. `packages/bundle/base/cordis.patch.yml`：新增宿主行
   ```
   - id: model-roles
     name: '@deepseek-ai/dsh-model-roles'
     config: { toolName: subagent }
   ```
3. `packages/bundle/web-app/package.json`：dependencies 增 `@deepseek-ai/dsh-client-ui-subagent-model`
4. `packages/bundle/web-app/cordis.patch.yml`：browser roster 增
   `- id: ui-subagent-model  name: '@deepseek-ai/dsh-client-ui-subagent-model'`
5. `packages/host/apiproxy/src/api-proxy.ts`：`PRODUCT_SETTINGS_NAMESPACES` 增加 `'model-roles'`
   ——**关键**：不加则设置页保存报
   `settings namespace "model-roles" is not exposed to configuration clients`。

> 注：client 插件是**运行时动态装载**（`dsh-client-modules` 扫描 roster 经 `/plugins/<id>/client.js` 提供），
> 静态 dist 里看不到插件字符串属正常，不需要也不应据此判定失败。

## Part A 实机验证结果

- **设置页**：设置面板出现「子代理模型」选项卡；列模型目录（providerName · model）；
  描述必填拦截；编辑 + 保存 → 「已保存。」，settings.yaml 持久化
  （`model-roles: {provider: {model: {description, subagent}}}`，UTF-8 正确）。
- **popup**：composer 输入 `/subagent-model` → 候选 → 弹出 4 个模型（含 tokenrhythm 两个）；
  选 `deepseekpro` → 会话出现 "Subagent model pinned to tokenrhythm/deepseek-v4-pro"。
- **真实委派（失败）**：父代理按指引调用 `subagent` 工具并携带
  `agentOptions: {provider: tokenrhythm, model: deepseek-v4-pro}`（轨迹可见，三次都正确），
  但子代理全部报 `Error: subagent run failed`，`list_agents` 无存量子代理。

## 根因调查（关键，新窗口从这里继续）

**证据（已解码会话日志，用临时 zstd 脚本）**：
- 父会话 request/header config = `{"provider":"tokenrhythm","model":"deepseek-v4-pro"}`（工作正常）。
- **3 个子会话 request/header config 全部 = `deepseek-official/deepseek-v4-flash`**
  （maxTokens 256000, reasoningEffort high）→ 即使父代理两次都传了 agentOptions，
  子代理的 LLM 请求**没有使用传入的 tokenrhythm 路由**，落回 base `agent-default-model`
  （deepseek-official/deepseek-v4-flash），用无效的 DEEPSEEK_API_KEY → 401
  `Authentication Fails ... AUTH` → stopReason `error` → `subagent run failed`。

**已排除/已确认**：
- `tool-subagent/src/index.ts:130`：`stopReasonError('error')` → `'subagent run failed'`（子代理**已启动**，是运行报错）。
- `subagent/subagent/src/child-agent.ts` `resolveChildAgentOptions`：`...requested` 会正确覆盖父路由 ✅。
- `subagent/subagent-in-process-driver/src/index.ts:132`：把 `resolveChildAgentOptions(parent, request.agentOptions, childDepth)`
  传给 `parent.ctx.agents.create({ ..., agentOptions })` ✅。
- **缺口在 `agents.create(options)` → 子代理每轮 LLM 请求的模型选择之间**：options.provider/model 未被采用，
  且落的是 base 配置默认（连 settings.yaml 的 tokenrhythm 默认都没读到）。

**下一步（待做，按序）**：
1. 找到 agent-loop / dsh-agent 里每轮模型的解析点：它是否读 `agent.options`（AgentOptions）还是只读
   `ctx.agentDefaultModel.currentSelection()`；为什么子代理 scope 读到的是 base 配置而非 settings 覆盖。
   grep 建议：`currentSelection` 的全部消费方、`agent.options.model` 的消费方、
   `agent-default-model` 在子代理创建 scope 内的接线。
2. 修复：让子代理 LLM 路由优先采用 AgentOptions（provider/model），或把解析后的 selection 显式注入子会话。
   这是 stage A「agentOptions 覆盖父路由」承诺的核心，属 harness 侧修复（非插件包）。
3. 重建（`corepack pnpm exec tsc -b tsconfig.host.json` + `tsdown --env.DSH_BUILD_FACE host`），
   重启 <VERIFY_HOME> 实例，重发委派消息 → 子代理应走 tokenrhythm 并成功回复。
   **测试成功的判据**：子会话 request/header 显示 tokenrhythm/deepseek-v4-pro 且子代理有输出。

## 起/停 <VERIFY_HOME> 实例（新窗口操作）

```powershell
# 启动（务必重定向日志到文件，勿用 Select-Object -First 截断——会丢日志）
$env:DSH_HOME = '<VERIFY_HOME>'
corepack pnpm dsh web *> <VERIFY_HOME>\dsh-web.log
# 实例在 <CLONE_DIR> 下运行；URL http://127.0.0.1:3080；Playwright 验证
# 停止：按端口找 PID 后 Stop-Process（先杀占用 3080 的进程）
```
> 旧窗口遗留：后台 job（pwsh-9）曾用 `Select-Object -First 40` 起实例导致日志丢失——新窗口用 `*>` 重定向。
> 新窗口的 Playwright 是全新会话，需重新导航 http://127.0.0.1:3080（首次可能弹「内测声明」「API Key」对话框，
> 点「继续」/「稍后配置」）。

## Part B：注入宿主插件到桌面应用（含备份/回退）

**目标**：让桌面应用获得 `/subagent-model` 命令 + 自动路由（**无 popup/设置页 UI**——打包版前端无法注入）。

**改动面（极小，可回退）**：
1. 把 `dsh-model-roles` 包的**已构建 lib** 拷入 `<USER_HOME>\.dsh\profiles\node_modules\@deepseek-ai\dsh-model-roles\`
   （包体含 lib/index.js 等；其依赖 dsh-settings/commands/session 等已在 profiles\node_modules 就位）。
   lib 可从 <CLONE_DIR> 构建：`corepack pnpm exec tsc -b packages/subagent/model-roles` +
   宿主 tsdown（本轮已跑过，`packages/subagent/model-roles/lib/index.js` 已存在，直接拷贝即可）。
2. `<USER_HOME>\.dsh\profiles\web\cordis.patch.yml` 从 `[]` 改为注册宿主插件
   （loader patch 语法参考 <CLONE_DIR>\packages\bundle\base\cordis.patch.yml 的 `- insert:` 行）。
3. 重启桌面应用（先让用户保存工作；不要自己硬杀有打开窗口的进程）。

**备份/回退方案（动手前执行）**：
- 备份目录：`<USER_HOME>\.dsh\backup-plugin-2026-08-15\`
  - 备份 `profiles\web\cordis.patch.yml`（唯一被改的现有文件）→ 副本 + 记录原内容。
  - 记录 `profiles\node_modules\@deepseek-ai\` 现有包名清单（用于核对新增）。
- **回退 = 删除新增的 `dsh-model-roles` 目录 + 从备份还原 cordis.patch.yml**，重启应用即可。
  新增包目录是纯增量，不触碰任何现有文件。
- 回退脚本/说明写进备份目录（README.txt），并同步写入本记忆。

**风险提示**：桌面应用 node_modules 是打包产物，改它属于「越界」操作；若应用启动失败，
优先走回退。宿主插件加载失败最多是那条命令/路由不生效，不会损坏数据（settings/sessions 在 <DSH_HOME>）。

## 命令速查

```powershell
# 构建（<CLONE_DIR> 内）
corepack pnpm install
corepack pnpm exec tsc -b tsconfig.host.json
corepack pnpm exec tsdown --env.DSH_BUILD_FACE host
corepack pnpm exec tsc -b tsconfig.client.json
corepack pnpm exec tsdown --env.DSH_BUILD_FACE client
corepack pnpm --filter @deepseek-ai/dsh-web-frontend run build   # 根 build:web 里的裸 pnpm 会失败，勿用

# 测试（<CLONE_DIR> 内）
corepack pnpm exec vitest run packages/client/ui-subagent-model/tests --coverage.enabled --coverage.include='packages/client/ui-subagent-model/src/**'
corepack pnpm exec tsx scripts/run-oxlint.ts packages/client/ui-subagent-model

# 解码 zstd 会话日志（临时脚本）
node <CLONE_DIR>\.zstd-decode.tmp.mjs <session.jsonl.zstd> <out.jsonl>
```

## 临时文件（<CLONE_DIR>，可清理，勿提交）

- `.zstd-decode.tmp.mjs`：zstd 多帧解码助手（node:zlib 的 `zstdDecompressSync` 只解首帧，需按
  DSH `scanZstdFrames` 逻辑逐帧解）。
- `.parent-session.tmp.jsonl` / `.child-session-{c993,5e53,bcf4}.tmp.jsonl`：已解码会话证据。

## 注意事项

- **脱敏纪律**：memory/ 会推公开仓库，写任何内容不得出现真实用户名/盘符路径/密钥值（含掩码后缀）。
- **corepack pnpm**：仓库内一切 pnpm 命令用 `corepack pnpm`；根 `build:web` 脚本里的裸 `pnpm` 会失败。
- **日志**：起服务用 `*>` 重定向到文件，别截断。
- 已发现并修复（round2 记录）的历史脱敏/重写经验：敏感数据一旦进历史需 `reset --soft` 折叠 + 强推，
  GitHub 侧孤儿对象需联系 Support 才彻底清除。
- selector 仓库工作树应保持干净；<CLONE_DIR> 的 5 个集成改动是 harness 侧改动，
  是否/如何上流（如作为 deepseek-harness 的 PR）由后续窗口决定。
