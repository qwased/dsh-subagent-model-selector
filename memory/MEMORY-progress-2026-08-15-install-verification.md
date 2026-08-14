# 交接：子代理模型选择插件 安装 + 实机验证（2026-08-15 第五轮）

> 本文件是**新对话窗口的唯一权威交接状态**。任务：把
> `@deepseek-ai/dsh-model-roles`（宿主）+ `@deepseek-ai/dsh-client-ui-subagent-model`（浏览器 UI）
> 安装进实际运行的 DeepSeek Harness，并完成实机验证（含真实子代理委派）。
> **所有记忆文件会随 <SELECTOR_DIR> 推送 GitHub 公开仓库，必须保持脱敏**
> （占位符 `<CLONE_DIR>`/`<VERIFY_HOME>`/`<USER_HOME>`/`<DESKTOP_APP_DIR>`，不写真实用户名/盘符路径/密钥值）。

## 用户指令与已确认决策（勿偏离）

1. 源码克隆完整实机验证（Part A，不碰桌面应用）+ 把宿主插件注入桌面应用 web profile（Part B）——**两者都做**。
2. Part B 动手前必须先做好**备份/回退方案**，避免 DSH 彻底损坏（见「Part B 备份/回退」节）。
3. 用户已在测试 DSH 配置了可用模型 API + 模型描述，允许测试真实分派任务唤起子代理。
4. （第四轮新增）后续测试**选用 deepseekflash（tokenrhythm/deepseek-v4-flash-0731）模型**进行委派。
5. （第五轮）任务收尾：完成桌面端实机委派验证；整理插件修复、文档与记忆；**脱敏后推送 GitHub 仓库**。

## 当前进度总览

| 阶段 | 状态 |
| --- | --- |
| 代码 + 单测 + 文档 + 推送 selector 仓库 | ✅ 完成（round2 commit；第五轮再推送插件 UX 修复 + 第五轮记忆） |
| Part A：克隆内四注册 + 构建（host lib / client lib / web 前端） | ✅ 完成 |
| Part A：起独立实例（<VERIFY_HOME>） | ✅ 运行中（127.0.0.1:3080，日志在 <VERIFY_HOME>\dsh-web.log） |
| Part A：设置页验证 | ✅ 通过（含保存到 settings.yaml） |
| Part A：/subagent-model popup + pin | ✅ 通过 |
| Part A：真实委派唤起子代理 | ✅ **通过（第四轮修复后）**——详见「第四轮修复与验证」 |
| Part B：注入桌面应用宿主插件 | ✅ **完成**（宿主 `/subagent-model` 命令已验证）——详见「Part B 完成情况」 |
| Part B：注入桌面应用客户端 UI | ✅ **完成（第五轮尝试成功）**——设置页「子代理模型」选项卡 + popup 出现 |
| Part B：桌面端保存「取消勾选允许作为子代理」 | ✅ **修复（第五轮）+ 实机验证通过**——详见「第五轮」 |
| Part B：桌面端真实 3 子代理委派（广州/北京/上海天气） | ✅ **通过（第五轮）**——详见「第五轮」 |
| 文档/记忆整理 + 脱敏 + 推送 GitHub | ✅ 完成（第五轮） |

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
  - `sessions\<workspace-derived>\`：父会话 + 若干子代理会话（zstd 压缩）
- **桌面应用**：`<DESKTOP_APP_DIR>`（打包版 Electron，非源码）；
  运行时包从 `<USER_HOME>\.dsh\profiles\node_modules\@deepseek-ai\*` 解析（多数为指向
  `resources\app\node_modules\@deepseek-ai\*` 的 junction）；web profile 在
  `<USER_HOME>\.dsh\profiles\web\`（cordis.yml 为空数组，patch 在 cordis.patch.yml）。
  **已注入**：`dsh-model-roles`（宿主）、`dsh-client-ui-subagent-model`（客户端 UI，真实目录，
  非 junction）+ `cordis.patch.yml` 两行注册；**已补丁**打包版 `dsh-host-apiproxy\lib\index.js`
  （`PRODUCT_SETTINGS_NAMESPACES` 加 `model-roles`，junction 直达应用安装文件）。
  备份在 `<USER_HOME>\.dsh\backup-plugin-2026-08-15\`
  （`cordis.patch.yml.bak`、`dsh-host-apiproxy-lib-index.js.bak`、包清单、README）。
  回退：删两个注入目录 + 还原 patch 与 api-proxy 备份 + 重启。
- 桌面应用当前运行中；其 web profile 监听 **127.0.0.1 随机端口**（`--port 0`，重启即变，勿写死）。

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

## Part A 实机验证结果（第三轮修复前）

- **设置页**：设置面板出现「子代理模型」选项卡；列模型目录（providerName · model）；
  描述必填拦截；编辑 + 保存 → 「已保存。」，settings.yaml 持久化
  （`model-roles: {provider: {model: {description, subagent}}}`，UTF-8 正确）。
- **popup**：composer 输入 `/subagent-model` → 候选 → 弹出 4 个模型（含 tokenrhythm 两个）；
  选 `deepseekpro` → 会话出现 "Subagent model pinned to tokenrhythm/deepseek-v4-pro"。
- **真实委派（第三轮失败）**：父代理按指引调用 `subagent` 工具并携带
  `agentOptions: {provider: tokenrhythm, model: deepseek-v4-pro}`（轨迹可见，三次都正确），
  但子代理全部报 `Error: subagent run failed`，`list_agents` 无存量子代理。

## 根因（第四轮已确认并修复，勿再重复排查）

**根因 1（主，`tool-subagent` 丢弃每调用 agentOptions）**：
- `packages/subagent/tool-subagent/src/index.ts` 的 `execute` **只读 `args.description`/`args.prompt`**，
  **从不读 `args.agentOptions`**；工具 schema 也**未声明** `agentOptions`（模型多传的键只是被宽容放行）。
  于是 `request.agentOptions` 只会来自插件 `config.agentOptions`（本部署未配置 → undefined）。
- 父代理**创建/恢复时**的 `options` 来自 `agent-default-model.currentSelection()`（api-proxy `agentOptions()`），
  是**创建时刻的旧值**；而父代理**每轮真实路由**由 api-proxy 的 `installModelSelection`（`agent/request` 瀑布）
  用**当前** selection 覆盖。本测试家中父会话创建于 default 还是 `deepseek-official/deepseek-v4-flash` 时，
  于是父 `options` 陈旧 = deepseek-official，而其实际请求走 tokenrhythm。
- `resolveChildAgentOptions(parent, request.agentOptions=undefined, depth)` 继承 `parent.options`（陈旧 deepseek-official）
  → 子代理用无效 `DEEPSEEK_API_KEY` → 401 → stopReason `error` → `subagent run failed`。
  **判据**：3 个旧子会话 request/header = `deepseek-official/deepseek-v4-flash`（maxTokens 256000 / reasoningEffort high
  是 deepseek-official 适配器在 `prepareCall` 填的默认值，非 options 所带）。

**根因 2（附带，`model-roles/subagent-pin` 事件未进生成目录）**：
- `model-roles` 在 `packages/subagent/model-roles/src/types.ts` 用 `declare module '@deepseek-ai/dsh-session/types'`
  合并 `SessionEventMap` 增加 `'model-roles/subagent-pin'`；但运行时 `KNOWN_SESSION_EVENT_TYPES`
  （`packages/core/session/src/known-event-types.ts`）是 **`scripts/gen-persistence-catalog.ts` 生成的静态集合**，
  未重新生成 → 任何含 pin 事件的持久化会话在 resume 时报
  `SessionFormatUnsupportedError: ... event type "model-roles/subagent-pin" ... unknown to this harness`。
- 影响：旧会话（第三轮 pin 过的会话）恢复失败；新会话因无 pin 事件不受影响。

**修复（第四轮，harness 侧，全部在 <CLONE_DIR> 本地未提交）**：
1. `packages/subagent/tool-subagent/src/index.ts`：
   - 工具 schema 增加可选 `agentOptions` 参数（`additionalProperties: false`，含 provider/model/maxTokens）。
   - `execute` 中 `const agentOptions = args.agentOptions === undefined ? config.agentOptions
     : { ...config.agentOptions, ...args.agentOptions }`，再 `...agentOptions !== undefined ? { agentOptions } : {}`
     传入 provider request（每调用覆盖配置默认，逐字段）。
2. `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts`：更新两处 schema 键断言（加 `agentOptions`），
   新增「每调用 agentOptions 透传 + 覆盖配置默认」测试；**62 个测试全过**。
3. 运行 `corepack pnpm exec tsx scripts/gen-persistence-catalog.ts`，重新生成
   `packages/core/session/src/known-event-types.ts`（新增 `model-roles/subagent-pin`）与
   `docs/persistence-catalog.md`；`--check` 通过（`up to date`）。
4. 重建 host：`corepack pnpm exec tsc -b tsconfig.host.json` + `corepack pnpm exec tsdown --env.DSH_BUILD_FACE host`；
   重启 <VERIFY_HOME> 实例（第四轮 PID 8372）。

## 第四轮实机验证结果（全部通过）

- **全新会话（父 options = tokenrhythm/deepseek-v4-pro）**：委派成功，子会话
  request/header = `{"provider":"tokenrhythm","model":"deepseek-v4-pro"}`，turn/end `completed`，
  父收到子代理回复 `1+1=2`。
- **旧会话（父 options 陈旧 = deepseek-official）显式 agentOptions=deepseekflash**：
  模型在 Turn 2 显式传 `agentOptions: {provider:"tokenrhythm", model:"deepseek-v4-flash-0731"}`
  → 子会话 request/header = `{"provider":"tokenrhythm","model":"deepseek-v4-flash-0731"}`，
  turn/end `completed`，工具行显示 `→ 1+1=2`，父报告子代理回复 `1+1=2`。
  **这是主修复（agentOptions 透传）的确定性判据**——同样的父会话在第三轮必失败。
- **旧会话 resume**：含 `model-roles/subagent-pin` 事件的旧会话在目录修复后**正常恢复并成功跑完 Turn 2**（无 SessionFormatUnsupportedError）。
- 浏览器（Edge, Playwright 连 msedge）当前打开 <VERIFY_HOME> 实例 127.0.0.1:3080。

## 第五轮：桌面端收尾（客户端 UI 注入 + 两处修复 + 实机委派验证）

**5.1 客户端 UI 注入桌面版（尝试成功）**
- 机制：客户端插件是运行时动态装载（`dsh-client-modules` 扫描 loader 条目 → `dsh.client.platform==='web'`
  → 经 `/plugins/<id>/client.js` 提供）。把 `dsh-client-ui-subagent-model` 构建包拷入
  `profiles\node_modules\@deepseek-ai\`（真实目录，含 `dsh.client` 声明与 `./client` 导出），
  并在 `cordis.patch.yml` 加 `- id: ui-subagent-model` roster 行 → 重启后设置页出现
  「子代理模型」选项卡、composer `/subagent-model` popup 可用。
- **推翻第三轮「打包版前端无法注入」的假设**：客户端插件无需改打包 dist，走运行时装载即可。

**5.2 打包版 api-proxy 补丁（保存 `model-roles` 命名空间）**
- 桌面端保存设置报 `settings namespace "model-roles" is not exposed to configuration clients`：
  打包版 `dsh-host-apiproxy\lib\index.js` 的 `PRODUCT_SETTINGS_NAMESPACES`
  = `new Set(["ui-onboarding", SETTINGS_NAMESPACE])`，缺 `model-roles`。
- 修复：备份后精确改写为 `new Set(["ui-onboarding", SETTINGS_NAMESPACE, "model-roles"])`
  （注意 Set-Content 会引入 UTF-8 BOM，需用 Node 重写去 BOM；备份
  `dsh-host-apiproxy-lib-index.js.bak` 已入备份目录）。重启后保存描述正常。

**5.3 UX 修复：仅勾选「允许自动指派」时要求能力描述（插件包，已同步 selector 仓库）**
- 现象：deepseek 官方模型无描述 → 「保存」被禁用（`请先填写能力描述，再保存。`），无法保存
  「取消勾选允许作为子代理」的状态。
- 根因：客户端 `ModelRolesSection.tsx` 的 `saveable` 无条件要求描述非空；宿主
  `ModelRoleSchema` 的 `description: z.string().required()` 也强制要求。
- 修复（`<CLONE_DIR>` + selector 仓库 `packages/` 均已改，**已推送**）：
  1. 客户端：`descriptionRequired = descriptionBlank && value.subagent`；
     `saveable`/`save()`/校验文案均改用 `descriptionRequired`。
  2. 宿主：`ModelRoleSchema.description` 改 `z.string().default('')`；`routeCandidates`
     仅纳入 `subagent && description.trim() !== ''` 的模型。
  3. 测试：新增「未勾选时允许空描述保存」用例（写 `{ description: '', subagent: false }`）；
     两包共 **76 个测试全过**。
  4. 重建 host/client、重注入桌面版 → 实机验证：DeepSeek-V4-Pro（无描述、未勾选）直接
     「保存」成功，settings.yaml 写入 `deepseek-official/deepseek-v4-pro: {description:"", subagent:false}`。

**5.4 桌面端真实 3 子代理委派（通过）**
- 在桌面应用新建会话，要求「3 个子代理分别用 duckduckgo 搜索广州/北京/上海天气」。
- 父代理（deepseekflash）委派 3 个后台子代理（id 形如 `cd17b65f…`/`34f5ed44…`/`8ff1c745…`），
  三者并行运行、各自完成并回传，父代理汇总成三城天气汇报（约 07:47）。
- 说明：子代理尝试 `web_search_ddg`/DuckDuckGo 时遭反爬拦截（HTML 验证码、API 202/空），
  改由多个气象源交叉核验——这是外部站点限制，非插件缺陷；委派链路本身完全正常。
- **意义**：证明桌面端宿主插件 + 子代理委派 + 结果回收整条链路可用。

**5.5 最终状态**
- selector 仓库（<SELECTOR_DIR>）已推送：插件 UX 修复（3 文件）+ 第五轮记忆（脱敏）。
- `<CLONE_DIR>` harness 侧改动仍本地未提交（tool-subagent agentOptions、事件目录重生成等，
  是否上流由后续窗口决定）。
- 桌面应用保持注入状态运行；回退方案见备份目录 README。

## 起/停 <VERIFY_HOME> 实例（新窗口操作）

```powershell
# 启动（务必重定向日志到文件，勿用 Select-Object -First 截断——会丢日志）
$env:DSH_HOME = '<VERIFY_HOME>'
corepack pnpm dsh web *> <VERIFY_HOME>\dsh-web.log
# 实例在 <CLONE_DIR> 下运行；URL http://127.0.0.1:3080；Playwright 验证
# 停止：按端口找 PID 后 Stop-Process（先杀占用 3080 的进程；旧窗口曾留 pwsh job 被杀，属正常）
```
> 第四轮实测：日志文件只捕获到 pnpm 引导输出，服务端输出未必进文件——判活以端口 3080 为准。
> 重启后 Playwright 需要重新导航 http://127.0.0.1:3080（新会话是全新 Playwright 上下文）。

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
> 第四轮提示：桌面应用若含 pin 事件会话，其 `KNOWN_SESSION_EVENT_TYPES` 是打包版静态目录，
> 未包含 `model-roles/subagent-pin` → 注入后旧 pin 会话 resume 可能报 SessionFormatUnsupportedError。
> 桌面端若遇此问题属预期（打包版目录无法注入），回退即可；不影响注入功能本身验证。

## Part B 完成情况（第四轮）

**已执行**：
1. **备份**：创建 `<USER_HOME>\.dsh\backup-plugin-2026-08-15\`，含
   `cordis.patch.yml.bak`（原内容 `[]`）、`node_modules-@deepseek-ai-before.txt`（注入前包清单）、
   `README.txt`（回退说明）。
2. **拷贝包**：`<CLONE_DIR>\packages\subagent\model-roles\{package.json, lib\*, README*}`
   → `<USER_HOME>\.dsh\profiles\node_modules\@deepseek-ai\dsh-model-roles\`（未拷贝其 workspace
   node_modules；运行时依赖 cordis/schemastery/zod/dsh-settings 在 profiles\node_modules 均已就位）。
3. **改 patch**：`<USER_HOME>\.dsh\profiles\web\cordis.patch.yml` 由 `[]` 改为 `- insert:` 注册
   `model-roles`（`name: '@deepseek-ai/dsh-model-roles'`, `config: { toolName: subagent }`）。
4. **重启**：用户确认后，桌面应用已重启（主进程 `DeepSeek Harness.exe`，web profile 以
   `--profile web --host 127.0.0.1 --port 0` 启动，监听随机端口）。

**验证结果（第四轮宿主注入）**：
- 桌面应用 web UI（Edge/Playwright 访问其随机端口）中，composer 输入 `/subagent-model`
  → 触发候选显示 **"subagent-model Pin the subagent model for this session"**，
  证明 `dsh-model-roles` 宿主插件在打包应用中**成功加载**。
- 第四轮曾认为「打包版前端无法注入客户端 UI / 设置页不可达」——**第五轮已推翻**：
  客户端插件走运行时装载注入成功，设置页「子代理模型」选项卡 + popup 均可用（见「第五轮」）。

**回退**（如后续要还原）：
- 删除 `profiles\node_modules\@deepseek-ai\dsh-model-roles\` 与
  `profiles\node_modules\@deepseek-ai\dsh-client-ui-subagent-model\`；
- 用备份的 `cordis.patch.yml.bak` 还原 `profiles\web\cordis.patch.yml`；
- 用备份的 `dsh-host-apiproxy-lib-index.js.bak` 还原打包版 `dsh-host-apiproxy\lib\index.js`
  （junction 直达 `resources\app\node_modules\...`）；
- 重启桌面应用。

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
corepack pnpm exec vitest run packages/subagent/tool-subagent/tests/tool-subagent.spec.ts
corepack pnpm exec vitest run packages/client/ui-subagent-model/tests --coverage.enabled --coverage.include='packages/client/ui-subagent-model/src/**'
corepack pnpm exec tsx scripts/run-oxlint.ts packages/client/ui-subagent-model

# 会话事件目录（新增了自定义事件类型时必须重新生成）
corepack pnpm exec tsx scripts/gen-persistence-catalog.ts
corepack pnpm exec tsx scripts/gen-persistence-catalog.ts --check

# 解码 zstd 会话日志（临时脚本）
node <CLONE_DIR>\.zstd-decode.tmp.mjs <session.jsonl.zstd> <out.jsonl>
```

## 临时文件（<CLONE_DIR>，可清理，勿提交）

- `.zstd-decode.tmp.mjs`：zstd 多帧解码助手（node:zlib 的 `zstdDecompressSync` 只解首帧，需按
  DSH `scanZstdFrames` 逻辑逐帧解）。
- `.parent-session.tmp.jsonl` / `.child-session-{c993,5e53,bcf4}.tmp.jsonl`：第三轮已解码会话证据。
  （第四轮的解码产物 `.new-parent/.new-child/.flash-child.tmp.jsonl` 与 `.summarize*.tmp.cjs` 已清理。）

## 注意事项

- **脱敏纪律**：memory/ 会推公开仓库，写任何内容不得出现真实用户名/盘符路径/密钥值（含掩码后缀）。
- **corepack pnpm**：仓库内一切 pnpm 命令用 `corepack pnpm`；根 `build:web` 脚本里的裸 `pnpm` 会失败。
- **日志**：起服务用 `*>` 重定向到文件，别截断；判活以端口 3080 为准。
- **模型选择**：用户已指示后续测试用 deepseekflash（deepseek-v4-flash-0731）。
- 已发现并修复（round2 记录）的历史脱敏/重写经验：敏感数据一旦进历史需 `reset --soft` 折叠 + 强推，
  GitHub 侧孤儿对象需联系 Support 才彻底清除。
- selector 仓库工作树应保持干净；<CLONE_DIR> 的集成改动（含第四轮 tool-subagent + 会话目录修复）是
  harness 侧改动，是否/如何上流（如作为 deepseek-harness 的 PR）由后续窗口决定。
