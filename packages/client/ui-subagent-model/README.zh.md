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

## 模型体验

不直接产生提示内容。选中一行执行 `/subagent-model` 命令，其处理器写入
`model-roles/subagent-pin` 日志事件；路由系统提示段落随后指示委派模型在
每次 subagent 工具调用时带上固定的 `agentOptions`。

#### KV 缓存影响

命令生命周期记录（`command/run`/`command/done`）是普通日志事件；pin 本身
从不进入模型请求体。选择已固定的行是 noop，不追加任何事件。

## 已知限制与待办

- **仅软执行**：pin 是建议性的——模型收到的是指引而非强制路由。选项框列出
  所有已配置模型，不区分其 `subagent` 开关；在专用 pin RPC 落地前，
  选择器不处理 `subagent: false`。
- **目录缺失时选项框为空**：提供商目录加载失败的会话没有可选项（共用选项框
  显示空状态）；手动输入命令仍可用作后备。
