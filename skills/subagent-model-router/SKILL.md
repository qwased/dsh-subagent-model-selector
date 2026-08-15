---
name: subagent-model-router
description: 依据任务难度为每次子代理委派选择模型（配合 dsh-model-roles 路由插件），并在 subagent 调用中携带 agentOptions。Select the subagent model by task difficulty (with dsh-model-roles) and pass agentOptions on every delegation.
whenToUse: 当需要把子任务委派给子代理（subagent / subagent_fork），或用户要求"分派 / 并行 / 让子代理去做"时；尤其是会话已安装 dsh-model-roles 路由插件、系统提示出现 model-roles:routing 段落时。
user-invocable: true
disable-model-invocation: false
---

# 子代理模型分配（Subagent Model Router）

本技能与 `@deepseek-ai/dsh-model-roles` 插件配合：插件把「固定路由（pin）」或「候选模型清单 + 能力描述」渲染进系统提示的 `model-roles:routing` 段落。本技能负责把那段指引落成每次委派前的确定性决策：**先判任务难度，再选模型，最后在工具调用里带上 `agentOptions`**。不要在委派时跳过这一步。

## 1. 委派前：先读路由上下文

调用 `subagent` / `subagent_fork` 之前，先确认 `model-roles:routing` 段落当前是哪种形态，并据此行动：

- **固定路由（pin）**：用户已用 `/subagent-model <provider>/<model>` 固定。每次都传该路由的 `agentOptions`，除非用户另行要求。
- **候选清单（provider / model: 描述）**：未固定，可自动指派。按第 2~4 节流程按难度选一个并传 `agentOptions`。
- **空**：既无 pin 也无候选。**不传** `agentOptions`，继承父路由即可，绝不臆造 provider/model 名。

优先级恒为：**用户点名 > 会话 pin > 难度判断选候选**。

## 2. 判断子任务难度（关键步骤，不要跳过）

对每个要委派的子任务，先独立评估难度，再选模型：

- **简单（routine）**：目标明确、范围小、歧义低、可快速验证。例如跑一条命令、查一个事实、格式化或小范围改写、套用已知模式、单文件小改动。→ 用**轻量 / 执行型**模型（便宜、快）。
- **中等（moderate）**：多步骤、跨几个文件、需要阅读代码或文档、有少量取舍。→ 优先**中等档**；没有明确的中档时按描述选最贴近的。
- **复杂（complex）**：架构或设计决策、跨模块改动、需求模糊、需要规划多条路径、排查棘手的并发或竞态、长自主链、新领域问题。→ 用**最强 / 规划型**模型，不要在这种任务上省钱。

快速判据：出现「不确定怎么改 / 需要先设计 / 影响面大 / 要在多个方案间权衡」→ 升档；「照着做就行 / 已知结论 / 机械重复」→ 降档。

## 3. 从候选清单中选择

- 只从 `model-roles:routing` 列出的候选里选，**不要臆造** provider/model 名。
- 候选描述就是选型依据：描述强调「执行力强 / 便宜 / 快」的模型用于简单与中等任务；强调「高智力 / 适合规划 / 复杂推理」的用于复杂任务。
- 能力相当时，优先便宜、快的那个；昂贵的强档只留给第 2 节判定为复杂的任务。

## 4. 每次委派都携带 agentOptions

调用 `subagent` / `subagent_fork` 时，把选择作为 `agentOptions` 传入，键名与路由段落一致：

```json
{ "description": "...", "prompt": "...", "agentOptions": { "provider": "<provider>", "model": "<model>" } }
```

- provider/model 必须是候选清单或用户点名的**确切字符串**（例如 `tokenrhythm` / `deepseek-v4-pro`），逐字段照抄。
- 并行委派多个独立子任务时，各自按难度选档，互不影响。
- 不要为同一任务重复开子代理；结果不理想按第 5 节处理。

## 5. 结果不理想 → 用更强模型重派（而不是接受或重复）

子代理结束后核对结果。若质量低于该难度应有的水平（漏要求、明显错误、自相矛盾、说"不确定"却未收尾），按序处理：

1. 明确差距在哪里；
2. 用**更强档**的候选，把差距说明连同原任务一起重新委派（可复用原子代理会话，也可新开）；
3. 仍不行，才考虑自己接手或向用户如实说明。

这正是插件软路由的意义：路由是建议性的，升级重派是你的责任。

## 6. 纪律与成本

- **能不分派就不分派**：只有独立、可并行的子任务才值得开子代理；简单问题直接自己做，避免无谓开销与往返。
- **档位不过度**：简单任务用便宜档，把贵模型留给真正复杂的工作。
- **数量克制**：并行子代理数量与任务规模匹配，避免碎片化。
- 本技能只决定「用哪个模型」，不改变是否分派、如何描述任务的既有判断；每次调用仍要写好自包含的 `prompt`（子代理看不到本对话）。
