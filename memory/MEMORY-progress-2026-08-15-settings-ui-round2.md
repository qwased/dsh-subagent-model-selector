# 交接：WebUI 设置选项卡「模型能力描述 + 子代理开关」（2026-08-15 第二轮，克隆副本内开发中）

> 本文件是**新对话窗口的唯一权威交接状态**。目标不变：为 webui 设置选项卡添加
> 「模型能力描述 + 是否允许被自动指派为子代理开关」，与已配置供应商/模型同步，
> 不破坏现有功能，符合 DSH 插件热插拔/动态加载设计；完成后写文档并推送 GitHub。

## 用户指令（本轮新增，勿偏离）

1. 将 https://github.com/deepseek-ai/deepseek-harness 克隆到 **<CLONE_DIR>**。
2. 所有测试都在**克隆副本**上进行；**禁止在桌面应用本体（<DESKTOP_APP_DIR>，即正在运行的 GUI）上测试**。
3. 继续遵循 DSH「插件热插拔 / 动态加载」理念：全部走文档化扩展点（`ctx.inject` 可选子纤程、
   `slots.inject`、effect 返回 disposer），不动核心循环；规范见 `<CLONE_DIR>\packages\client\AGENTS.md`
   （槽系统、四 props share、inject 规则、每文件 100% 覆盖门）。

## 环境现状（与旧交接不同处，注意）

- **<OLD_WORKSPACE> 已不存在**；上一轮写在该工作区的 settings UI 代码未找到任何副本
  （D 盘全盘搜索 `ModelRolesSection.tsx` / `model-roles-store.ts` 均无）。本轮代码
  **依据旧交接文档描述 + 实测克隆仓库 API 全部重写**。
- 桌面应用本体：`<DESKTOP_APP_DIR>`（勿动，勿在其上测试）。
- Node：`<NODE_DIR>`（v24.19.0，已在 PATH）；pnpm 不在 PATH，用 **`corepack pnpm`**（11.7.0）。
- 克隆仓库 `<CLONE_DIR>`：commit 47f9438，版本 0.1.0-rc.5；`corepack pnpm install` 已绿
  （21.5s，复用 `<PNPM_STORE>`）。工作树被修改属正常（本地测试副本，未提交）。
- `<SELECTOR_DIR>` 仓库**至今未被本轮改动**（git 状态：仅新增本记忆文件）。

## 已完成（全部位于克隆 <CLONE_DIR>）

1. 两个插件包已从 selector 仓库复制进克隆：`packages/subagent/model-roles`、
   `packages/client/ui-subagent-model`；克隆内副本 package.json 依赖 `^0.1.0-rc.5` 全部替换为
   `workspace:^`（`version` 字段保留 0.1.0-rc.5）。
2. `tsconfig.host.json` 增 `{ "path": "./packages/subagent/model-roles" }`；
   `tsconfig.client.json` 增 `{ "path": "./packages/client/ui-subagent-model" }`。
3. `packages/client/ui-subagent-model/package.json`：
   - `dsh.client.inject` 增补 `dsh-client-ui-settings` / `-locale` / `-ui-slots` / `-web-react`；
   - peer/devDependencies 增补同名四包（workspace:^）+ `react ^18.2.0`（peer）、
     `react ^18.2.0` + `@types/react ~18.3.1`（dev）。
4. `packages/client/ui-subagent-model/tsconfig.json`：references 增 `../locale` `../ui-settings`
   `../ui-slots` `../web-react`。
5. 新源码（`src/client/`）：
   - **model-roles-store.ts**：`ModelRolesSettingsStore`
     （state `{status,error,writable,revision,rows}`；`load()` 并行 `llm.models` + `settings.describe`
     并 join 目录行与角色；`saveRole/clearRole` 走 `settings.mutate`（`set`/`unset` 路径
     `[provider, model]`）+ `expectedRevision`，写后**无论成败都 reload**；generation 防止旧响应覆盖）；
     导出 `MODEL_ROLES_NAMESPACE='model-roles'`、`messageOf`、`roleOf`（防御性读取，`subagent !== false`）。
   - **locales.ts**：字典命名空间 `'settings.model-roles'`，en/zh + `ModelRolesKey`
     （nav/title/intro/description/descriptionPlaceholder/allowSubagent/save/saving/saved/clear/
     readOnly/loadFailed/retry/empty/descriptionRequired/writeFailed）。
   - **ModelRolesSection.tsx**：`ModelRolesSection`（注入面缺失返回 null）→ `Loaded`（useSnapshot 订阅）
     → `ModelRoleRow`；`useRoleDraft`（干净行跟随外部 role、脏行保留草稿，edit/reset/dirty）；
     空描述禁保存（descriptionRequired 提示）；保存失败显示 writeFailed+messageOf；
     成功 reset + onSaved（aria-live saved notice）；Clear 在无存量 role 时仅本地 reset、有则 wire unset；
     readOnly 全禁；错误态 retry；空目录 empty 文案。
   - **ModelRolesSection.module.css**：全部使用已验证的 `--dsw-alias-*` token
     （button-primary-fill、label-primary-foreground、bg-layer-1、brand-primary、label-dimmed、
     interactive-bg-hover、border-l2、state-error/success/warn 等；**禁止裸 --border/--surface**）。
   - **src/css-modules.d.ts**：`*.module.css` + `*.css` shim。
   - **src/client/index.ts**：**顶层 inject 保持 `['commandUi','connection','sessions']` 不变**
     （popup 测试 bench 不受影响）；设置页在可选子纤程
     `ctx.inject(['slots','locale','connection','remote'], ...)` 内：
     locale 字典 effect、invalidation effect（`settings/document-updated` 仅 model-roles 命名空间、
     `llm/adapters-updated`、`connection/reset` → `refreshIfLoaded`，idle 状态跳过）、
     `slots.inject('settings.section')` 注册 `{id:'model-roles', order:20, label:()=>t('nav'),
     inject:{controller,useSnapshot,api,t}}`；导出 `refreshIfLoaded`；
     `LocaleNamespaceMap['settings.model-roles']` 声明在 `@deepseek-ai/dsh-client-ui-slots` 模块。
   - **src/invariant.ts**：理由改为 popupSelect + 设置页两个注册（均 HMR 可卸）。
6. 本轮已记录的 API 结论与设计决策：见下两节。

## 关键 API 结论（克隆 v0.1.0-rc.5，勿重复调研）

- 设置页参考包：`packages/client/ui-settings-models`（apply 注册、useSnapshot、locales、
  invalidations、apply 测试全范式）；store/section 测试范式参考 `ui-agent-preset`。
- `settings.section` 是 ui-settings shell 声明的 slot（kind list / scope root / owner `{close}`）；
  contract 在 `packages/client/ui-settings/src/client/contract/slots.ts`。
- 数据通道：`connection.api.llm.models({})` → `{groups:[{id,name,models:[{id,name,...]}]], failures}`；
  `connection.api.settings.describe({})` → `{writable, hasDocument, namespaces:[{ns,schema,value,
  base,user,applies,secrets,revision}]}`；`settings.mutate({ns, ops:[{op:'set'|'unset', path, value?}],
  expectedRevision})` → 返回新的 namespace view。
- `ctx.locale`：`LocaleRuntime.register(ns, {zh, en})`、`bind(ns) → Translate`；
  `LocaleNamespaceMap` 声明位置是 `@deepseek-ai/dsh-client-ui-slots`。
- 转发事件：`ctx.remote.$on('settings/document-updated', ns => ...)`、`$on('llm/adapters-updated', ...)`、
  `ctx.on('connection/reset', ...)`（remote 面来自 `@deepseek-ai/dsh-api-remotes/client` 的 type-only 合并）。
- `bindSnapshotSelector(store) → SnapshotSelectorHook`（`@deepseek-ai/dsh-client-web-react`）；
  `createSnapshotStore`（`@deepseek-ai/dsh-client-runtime/client`）。
- 测试 bench（照抄 `ui-settings-models/tests/apply.client.spec.ts`）：`new Context()` +
  `ctx.plugin(SlotRegistry)` + `LocaleRuntime` provide + `new TestRemote(ctx)` +
  `ctx.provide('connection', {api:{}, isLoopback})` + declare('settings.section')；
  `usePinnedBrowserLanguages('zh-CN')`。
- 覆盖门：client src 每文件 100%；jsdom 用首行 `// @vitest-environment jsdom`。

## 已定设计决策（写代码时已定，勿推翻）

- 设置页放在**现有** `client-ui-subagent-model` 包（不新建包）：避免动三注册表面，热插拔不变。
- 设置部分用**可选子纤程** `ctx.inject(['slots','locale','connection','remote'], ...)`：
  顶层 `inject` 保持 `['commandUi','connection','sessions']` → 现有 popup 测试 bench 无需改动；
  cordis `ctx.inject` = 服务齐备才执行、服务变化时卸载重跑。
- 数据同步：行来自 `llm.models`（与 Models 设置页同源），角色值来自 `model-roles` 命名空间；
  写走 `settings.mutate` + `expectedRevision`；宿主 watch 命名空间即时生效（无需重启）。
- 描述必填（宿主 schema `description: z.string().required()`），空值客户端拦截；
  宿主 schema 默认 `subagent: true`（客户端默认草稿同样 true）。
- popup 部分完全不变（仍列出全部模型、不区分 subagent 开关；该 Known Limitation 保留）。

## 未完成（下一步，按序执行）

1. **写三个测试**（克隆内 `packages/client/ui-subagent-model/tests/`）：
   - `model-roles-store.client.spec.ts`：fake api（llm.models / settings.describe / settings.mutate，
     可注入业务失败、抛错、记录调用）覆盖：load 合并多 provider/模型、roleOf 缺省 true；
     models 失败 / describe 失败 → error；generation 旧响应丢弃；saveRole set 路径 +
     expectedRevision + 成功 reload；mutate 业务失败返回消息；transport 抛错；clearRole unset；
     失败后 reload 刷新 revision。
   - `model-roles-section.client.spec.tsx`（jsdom）：注入面缺失 → null；空目录 empty；
     错误态 retry；行渲染（providerName · model）；编辑描述/开关 → 保存 → saveRole 调用 →
     saved notice；空描述禁保存 + descriptionRequired；保存失败 writeFailed；清除（有/无存量 role）；
     只读禁用；外部 role 变更干净行重同步、脏行保留草稿。
   - `settings-section.client.spec.ts`：`inject` 断言 `['commandUi','connection','sessions']`；
     settings.section 注册（id/order/label 跟随 locale en/zh）；子纤程缺 slots/locale/remote 时不激活
     且 popup 仍可用；声明在 apply 前后都注册；HMR collapse 后重注册；fiber dispose 清理 section +
     locale 字典；invalidations（idle 跳过 / loaded 触发 load；model-roles ns 触发、其它 ns 不触发；
     llm/adapters-updated；connection/reset）；`refreshIfLoaded` 直测。
     现有 `tests/browser-plugin.client.spec.ts` **不改**。
2. **验证**（克隆内，工作目录 `<CLONE_DIR>`）：
   - `corepack pnpm exec tsc -b packages/client/ui-subagent-model`（再跑整棵 `tsconfig.client.json`）
   - `corepack pnpm exec vitest run packages/client/ui-subagent-model/tests`，加 `--coverage.enabled`
     查 src per-file 100%
   - oxlint：`corepack pnpm exec tsx scripts/run-oxlint.ts packages/client/ui-subagent-model`
   - 顺手 `tsc -b packages/subagent/model-roles` + 其 vitest（若与 rc.5 有 API 漂移需适配后同步回 selector）。
3. **（可选）克隆内实机验证**：补齐三注册表面后用独立 DSH_HOME 起 `dsh web`——
   `packages/bundle/web-app/cordis.patch.yml` 加 `dsh.client` 行、`web-app/package.json` 加依赖、
   `packages/bundle/base/cordis.patch.yml` 加 model-roles 宿主行；改前端后 `pnpm --filter <pkg> bundle`。
   **绝不在桌面应用上验证。**
4. **同步回 <SELECTOR_DIR>**（目前 selector 仓库未被本轮改动）：
   复制克隆内 ui-subagent-model 全部新/改文件（src/client/*、src/css-modules.d.ts、src/invariant.ts、
   tsconfig.json、README 等）；**package.json 依赖改回 `^0.1.0-rc.5`**（仅依赖区，勿全局替换）。
   测试夹具用 acme 占位符。若 model-roles 有改动同样复制并改回版本。
5. **文档**：`packages/client/ui-subagent-model/README.md/.zh.md/README.i18n.yaml` 增设置页说明
   （能力描述+子代理开关、与供应商/模型同步、热更新、Known Limitations）；
   根 `README.md` 功能清单；`docs/2026-08-14-subagent-model-routing.*` Agent Note 增补设置页小节
   并重新配对。
6. **记忆**：更新 `memory/MEMORY.md` 当前进度指针 + 本轮文件收尾。
7. **推送**：`git -C <SELECTOR_DIR> add -A && commit && push`。

## 注意

- 若工具调用层再出现 `invalid arguments: missing required property "description"` 波次故障
  （上轮记录过），按旧交接（MEMORY-progress-2026-08-15-settings-ui.md 第一节）对策处理。
- 克隆工作树已被修改（本地测试副本，未提交）属正常；selector 仓库工作树应保持干净到步骤 4。
- 上轮交接（MEMORY-progress-2026-08-15-settings-ui.md）中「已完成代码」一节所指文件已随
  <OLD_WORKSPACE> 丢失，本轮实现以本文件描述为准。
