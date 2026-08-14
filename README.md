# DeepSeek Harness 子代理模型选择器（Subagent Model Selector）

让用户在 DeepSeek Harness 中为每个第三方模型配置「能力描述 + 是否允许被自动指派为子代理」，
并通过「斜杠命令 / 对话自然表达 / 对话框 UI」三通道指定当前会话的子代理模型；未指定时
由委派模型按描述自动选择，并在每次 subagent 工具调用时携带 `agentOptions`（软执行）。

## 功能

- **能力描述 + 指派开关**：为每个模型描述其擅长领域，并用 `subagent` 开关控制是否可被自动指派。
- **会话内指定优先**：用户指定的供应商/模型优先于自动指派。
- **按描述自动指派**：未指定时，委派模型按候选描述自行选择。
- **软执行**：固定路由与候选清单写入系统提示，由模型在每次调用时携带 `agentOptions`。
- **热插拔、最小侵入**：全部走文档化扩展点，不改动 agent-loop 与供应商适配器。

## 结构

本项目由两个 npm 包构成，均面向 DeepSeek Harness 生态：

| 包 | 角色 | 内容 |
| --- | --- | --- |
| `@deepseek-ai/dsh-model-roles` | 宿主插件 | `model-roles` settings 命名空间、会话 pin 事件、系统提示段、`/subagent-model` 命令、会话投影单元 |
| `@deepseek-ai/dsh-client-ui-subagent-model` | 浏览器 UI | 把 `/subagent-model` 装饰为 popupSelect，三要素展示 + 供应商同步 + 当前 pin 选中标记 |

```
DSH-subagent-selector/
├── README.md                          # 本说明
├── docs/                              # Agent Note（设计决策，英/中/配对记录）
├── memory/                            # 任务记忆与交接状态
└── packages/
    ├── subagent/model-roles/          # 宿主插件：源码 + 单测 + REAL-composition 测试
    └── client/ui-subagent-model/      # 浏览器 UI：源码 + 单测
```

## 快速使用

1. 在 settings.yaml 中注册供应商与模型（参考各供应商适配器文档）。
2. 为模型补充角色描述与指派开关：

```yaml
model-roles:
  acme:
    acme-flash:
      description: 执行力强且便宜，适合做子代理
      subagent: true
    acme-pro:
      description: 高智力，适合规划
      subagent: false
```

3. 在会话中输入 `/subagent-model <provider>/<model>` 固定该会话的子代理模型，
   `/subagent-model off` 清除；或在对话框选择器中点选。

## 开发与验证

在两个包的源码目录运行：

```bash
# 类型检查（需 deepseek-harness 工作区环境）
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsc -b tsconfig.client.json

# 测试 + 覆盖门（per-file 100%）
pnpm exec vitest run packages/subagent/model-roles/tests packages/client/ui-subagent-model/tests --coverage.enabled
```

> 测试与示例中的供应商/模型名（如 `acme` / `acme-flash`）是通用占位符，
> 请替换为实际注册的供应商与模型。

## 设计要点

- **路由是建议性的**：固定路由与候选清单只进系统提示，由模型协作执行；确定性强制已延期。
- **进程外提供方暂不支持**：子代理路由依赖 `agentOptions` 能力，仅进程内 spawn/fork 提供方支持。
- **路由不校验注册表**：指名未注册 provider/model 的 pin 会在委派时失败（`NO_ADAPTER`）。

设计决策的完整记录见 [docs/2026-08-14-subagent-model-routing.md](docs/2026-08-14-subagent-model-routing.md)。
