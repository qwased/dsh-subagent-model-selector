# @deepseek-ai/dsh-client-ui-subagent-model

[English](README.md) | 中文

子代理模型固定（pin）UI，浏览器侧：把宿主的 `/subagent-model` 命令装饰为
popupSelect 选项框。选项从会话的模型目录（`session.models`）加载，因此选项
始终与设置中已配置的供应商信息保持同步；每行在 label 行显示显示名称，detail
行显示提供商路由 + 模型 ID，满足「提供商 / 模型 ID / 显示名称」三要素同时
展示的要求。与会话当前 pin（从 `model-roles` 会话投影读取）匹配的行带有
选中标记。选中一行会执行宿主命令 `/subagent-model <provider>/<model>`，
写入 pin 事件并在会话中渲染命令节点；手动带参调用（如
`/subagent-model acme/acme-flash`）不受影响，因为 popup 只
装饰裸命令调用。

被寻址的子代理会话（`@` 引用子会话）不显示选项框：它们的模型由委派模型
决定，而非用户。

`/client` 导出为插件主体（`apply`/`inject`）加纯函数 `optionsOf` 行构造器。

## 设置页

浏览器侧还会在设置 shell、locale 与 remote 服务齐备后，注册一个
**「子代理模型」设置部分**（`settings.section`，id `model-roles`，order 20）。
它列出整个模型目录——与「模型」设置页同源的 `llm.models`——每个模型一行。
每行编辑两个字段：

- **能力描述**：说明该模型擅长什么的自由文本。必填——空描述无法保存。这是
  路由系统提示段展示给委派模型的内容。
- **允许自动指派为子代理**：`subagent` 开关。关闭后，该模型不会出现在路由
  指引列出的自动指派候选中。

行与「模型」页保持同步，因为它们枚举同一份模型目录：在那里新增的供应商或
模型会在下次加载时出现在这里。角色值存放在 `model-roles` settings 命名空间，
每次写入都通过带 `expectedRevision` 的 `settings.mutate`，因此并发编辑会被
拒绝而不是静默覆盖。宿主插件监听自己的命名空间并即时生效——保存一行立即
生效，无需重启。推送失效（`settings/document-updated` 的 `model-roles`
命名空间、`llm/adapters-updated`、`connection/reset`）会在页面至少加载过一次后
重新拉取，让已打开的面板无需轮询即可收敛。

该部分在可选子纤程 `['slots', 'locale', 'connection', 'remote']` 内激活：
未组合设置 shell 的组合仍只获得 popup 装饰，别无其他。只读的设置提供方会禁用
全部写入控件并说明原因。

## 模型体验

不直接产生提示内容。选中一行执行 `/subagent-model` 命令，其处理器写入
`model-roles/subagent-pin` 日志事件；路由系统提示段落随后指示委派模型在
每次 subagent 工具调用时带上固定的 `agentOptions`。

#### KV 缓存影响

命令生命周期记录（`command/run`/`command/done`）是普通日志事件；pin 本身
从不进入模型请求体。选择已固定的行是 noop，不追加任何事件。

## 已知限制与待办

- **仅软执行**：pin 是建议性的——模型收到的是指引而非强制路由。设置页负责编辑
  每个模型的 `subagent` 开关（自动指派指引会尊重它），但选项框仍列出所有已配置
  模型，不区分该开关；在专用 pin RPC 落地前，选择器不处理 `subagent: false`。
- **目录缺失时选项框为空**：提供商目录加载失败的会话没有可选项（共用选项框
  显示空状态）；手动输入命令仍可用作后备。
