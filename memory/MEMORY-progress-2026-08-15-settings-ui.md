# 交接：WebUI 设置选项卡「模型能力描述 + 子代理开关」功能（2026-08-15）

> 本文件记录任务当前进展与中断原因，供修复基础设施问题后无缝继续。
> 任务：读取 <SELECTOR_DIR>，将「用户填写对模型能力的描述」功能添加到
> webui 设置选项卡（含「是否允许该模型被用作子代理」开关），与已配置供应商/模型
> 保持同步，不破坏现有功能，符合 DSH 插件热插拔设计；完成后写文档并推送 GitHub。

## 一、紧急基础设施问题（必须先处理）

**DeepSeek Harness 工具调用层出现严重间歇性故障**：大量工具调用（pwsh / run_code /
甚至 read / write / glob）随机抛出：

    invalid arguments: missing required property "description"

- 现象：同一命令有时成功、有时失败；失败呈「波次」且随时间加重，最严重时连
  `console.log("alive")` 的 run_code 程序都被拒。
- 已知成功窗口：会话早期大量调用正常；中后期几乎全拒，偶有短暂恢复
  （如 `pwd`、trivial read 成功过一次）。
- 触发特征：无法确定性地复现；与命令/描述内容无关（已用最小程序验证）。
- **怀疑**：run_code/pwsh 的参数校验服务存在资源泄漏或竞态，随时间/调用量恶化。
- 对策：请修复后重启/重置该校验服务；或告知本会话可用的替代执行通道。

**环境事实（供恢复后使用）**：
- Node 运行时：`<APP_RESOURCES>\
  runtime\developer\windows-x64\node\node.exe`（v24.18.1），目录内含 pnpm / corepack / npm。
- `node` 不在 PATH；pwsh 命令中直接写字面 `<USER_HOME>\...` 曾被拒（疑似被过滤），
  改用 `$env:LOCALAPPDATA` / `$env:USERPROFILE` 构造路径更稳。
- run_code 内可通过 `await import('node:child_process')` + `process.execPath` 执行命令
  （pwsh 故障时的备用通道；spawnSync/execFileSync 早前可用）。
- 已写 `<OLD_WORKSPACE>\.dsh-env-check.ps1`：设置 PATH 后 node -v / corepack --version。
- DSH_HOME = `<USER_HOME>\.dsh`（web profile node_modules 已 heal，含 ui-subagent-model 链接）。

## 二、任务背景与架构结论（勿重复调研）

- **DSH-subagent-selector**（<SELECTOR_DIR>）是独立 GitHub 仓库
  （origin = https://github.com/<OWNER>/dsh-subagent-model-selector.git，分支 main，工作树干净）。
  含两个插件包 + docs + memory，使用 `acme`/`acme-flash` 通用占位符。
- **deepseek-harness**（<OLD_WORKSPACE>）是构建/测试工作区：两个包以未跟踪目录集成
  （tsconfig.client.json、packages/bundle/web-app/cordis.patch.yml、web-app/package.json 均已注册）。
  该副本测试夹具使用真实供应商名（tokenrhythm 等）。
- 两仓库包内容差异仅测试夹具名（acme vs tokenrhythm），其余一致。
- 宿主插件 `@deepseek-ai/dsh-model-roles` 已实现：settings 命名空间 `model-roles`
  （provider → model → {description: string 必填, subagent: boolean 默认 true}）、
  系统提示段、/subagent-model 命令、会话投影。宿主 watch 命名空间 → 写即生效（热更新）。
- 现有浏览器插件 `@deepseek-ai/dsh-client-ui-subagent-model`：/subagent-model popupSelect。

## 三、已完成（deepseek-harness 工作区内的代码改动）

全部改动位于 `<OLD_WORKSPACE>\packages\client\ui-subagent-model\`：

1. **新建 `src/client/model-roles-store.ts`**（数据层）：
   - `ModelRolesSettingsStore`：join `llm.models`（session 无关模型目录，同步配置的供应商/模型）
     与 `settings.describe`（model-roles 命名空间值 + revision + writable）。
   - `saveRole(provider, model, role)`：`settings.mutate` 整条 set `[provider, model]`，带 expectedRevision；
     `clearRole`：unset；失败/成功后均 reload。
   - 导出 `MODEL_ROLES_NAMESPACE = 'model-roles'`、`messageOf`、`roleOf`、类型。
2. **新建 `src/client/locales.ts`**：en/zh 双语字典 + `ModelRolesKey` 类型
   （nav/title/intro/description/allowSubagent/save/saved/clear/readOnly/loadFailed/retry/empty/
   descriptionRequired/writeFailed）。
3. **新建 `src/client/ModelRolesSection.tsx`**（设置页组件）：
   - `ModelRolesSection`（props=注入面）+ `Loaded`（useSnapshot 订阅 store）+ `ModelRoleRow`
     （本地草稿：描述输入 + 子代理 checkbox + 保存/清除）。
   - `useRoleDraft`：外部 role 变化时干净行重同步、脏行保留草稿。
   - 空描述客户端校验（descriptionRequired）、保存失败展示、保存成功提示、只读禁用。
4. **新建 `src/client/ModelRolesSection.module.css`**：settings-panel 设计语言（--dsw-alias-* token）。
5. **新建 `src/client/css-modules.d.ts`**：CSS module 类型 shim。
6. **更新 `src/client/index.ts`**：
   - 新增 `settings.section` 注册（id='model-roles'，order=20，label 跟随 locale，inject 注入面）；
   - 注册在可选子纤程 `ctx.inject(['slots','locale','connection','remote'], ...)` 内
     （热插拔：服务齐备才激活，随纤程卸载）；
   - 失效订阅：settings/document-updated、llm/adapters-updated、connection/reset → refreshIfLoaded；
   - 声明 LocaleNamespaceMap `'settings.model-roles'`；
   - 新增 `refreshIfLoaded` 导出；popupSelect 部分保持不变（顶层 inject 不变）。
7. **更新 `src/invariant.ts`**：原因说明改为「popupSelect + 设置页注册，均 HMR 可卸」。
8. **更新 `package.json`**：peer/dev 增补 `@deepseek-ai/dsh-client-locale`、`-ui-settings`、
   `-ui-slots`、`-web-react`、`react`（workspace:^）、`@types/react`；
   `dsh.client.inject` 同步增补。
9. **更新 `tsconfig.json`**：新增 references：../locale、../ui-settings、../ui-slots、../web-react。

> 注：deepseek-harness 的 package.json 依赖用 `workspace:^`（DSH-subagent-selector 副本用
> `^0.1.0-rc.5`），两处分别适配。

## 四、尚未完成

1. **测试**（未写）：需在 deepseek-harness 包内新增并运行：
   - `tests/model-roles-store.client.spec.ts`（store：load 合并/错误/并发代际、save/clear 成功与失败、revision 传递）
   - `tests/model-roles-section.client.spec.tsx`（jsdom：行渲染/编辑保存/开关/空描述/失败/清除/只读/外部变更重同步/空目录/错误重试）
   - `tests/settings-section.client.spec.ts`（apply/HMR：slot 注册、locale 跟随、无效化、dispose 移除、HMR 重注册）
   - 现有 `tests/browser-plugin.client.spec.ts` 无需改动（设置部分在可选子纤程，缺服务不激活）。
2. **验证命令**（等工具恢复后运行）：
   - `tsc -b tsconfig.client.json`（或 `pnpm exec tsc -b packages/client/ui-subagent-model`）
   - `pnpm exec vitest run packages/client/ui-subagent-model/tests --coverage.enabled`
   - oxlint：`pnpm exec tsx scripts/run-oxlint.ts packages/client/ui-subagent-model`
   - 覆盖门：src per-file 100%（纯类型文件不触发）。
3. **同步到 DSH-subagent-selector**：把上述新/改文件复制到
   `<SELECTOR_DIR>\packages\client\ui-subagent-model\`（测试夹具用 acme 占位符，
   package.json 依赖用 `^0.1.0-rc.5`）。
4. **文档**：
   - `packages/client/ui-subagent-model/README.md` / `README.zh.md` / `README.i18n.yaml`
     （新增设置页说明：能力描述 + 子代理开关、与供应商/模型同步、热更新、Known Limitations）。
   - 根 `README.md`（功能清单补设置页）。
   - `docs/2026-08-14-subagent-model-routing.*` Agent Note 增补或新增小节。
   - `memory/MEMORY.md` 与 `memory/MEMORY-progress-2026-08-14.md` 或新建当日进展文件。
5. **推送 GitHub**：`git -C <SELECTOR_DIR> add -A && commit && push`。

## 五、关键设计决策（写代码时已定）

- 设置页放在**现有** `client-ui-subagent-model` 包（不新建包）：避免动三注册表面，热插拔不变。
- 设置部分用**可选子纤程** `ctx.inject(['slots','locale','connection','remote'], ...)`：
  - 顶层 `inject` 保持 `['commandUi','connection','sessions']` 不变 → 现有 popup 测试 bench 无需改动。
  - cordis `ctx.inject` = 服务齐备才执行、服务变化时卸载重跑（已读 vendor/cordis registry.d.ts 确认）。
- 数据同步：行来自 `llm.models`（与 Models 设置同源），角色值来自 `model-roles` 命名空间；
  写走 `settings.mutate` + expectedRevision；宿主 watch 命名空间即时生效（无需重启）。
- 描述必填（宿主 schema 要求 `description: z.string().required()`），空值客户端拦截。

## 六、恢复后的第一步

1. 先跑 `.dsh-env-check.ps1`（或直接 `node -v; pnpm --version`）确认执行通道恢复。
2. 写三个测试文件（见上），然后按「四、验证命令」逐个跑绿。
3. 全部绿后同步到 DSH-subagent-selector + 写文档 + push。
