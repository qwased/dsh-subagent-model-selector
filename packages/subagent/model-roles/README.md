# @deepseek-ai/dsh-model-roles

English | [中文](README.zh.md)

Settings-backed subagent model routing: a `model-roles` settings namespace of per-model capability roles plus a per-session pinned subagent model, surfaced to the delegating model as advisory guidance. Nothing routes inside the loop, and no provider adapter schema is touched.

## Roles and pinning

The `model-roles` settings namespace maps provider route → model id → `{ description, subagent }`. `description` is the capability text used for task-based routing; `subagent` (default `true`) toggles whether that model may be auto-assigned when the user names none.

The `/subagent-model <provider>/<model>` command pins the session's subagent model; `/subagent-model off` clears it. The pin is logged (`model-roles/subagent-pin`, last wins), so resume and fork restore it, and it is rendered into the `model-roles:routing` system-prompt section. Routing is soft: the section tells the delegating model to pass `agentOptions` on each `subagent` tool call, which requires a subagent provider with the `agentOptions` capability (in-process `spawn`/`fork`).

## Config

| Key | Meaning |
|---|---|
| `toolName` | The model-facing subagent tool the guidance names, default `subagent`. |

## Model Experience

### Prompt section

#### What the model sees

When a pin is logged, one short instruction naming the pinned provider/model and the `agentOptions` to pass. Otherwise, when role candidates exist, a list of `provider / model: description` rows plus the rule to pick by task fit, pass `agentOptions`, and re-delegate with a stronger candidate on an unsatisfactory result. No pin and no candidates render nothing.

#### Token effect

One short section only while a pin or at least one auto-assignable role exists; its length scales with the number of described models.

#### KV Cache effect

Prefix-stable while roles and the pin are unchanged; a role edit or pin flip changes the section text for subsequent requests.

### Command

#### What the model sees

`/subagent-model` runs as a slash command and never reaches the model; its success text is the state-change feedback shown to the user.

#### Token effect

None beyond the logged `model-roles/subagent-pin` event, which is log-only and not in model history.

#### KV Cache effect

None; the event is log-only.

## Known Limitations and Deferred Work

- **Routing is advisory** — the pin and candidate list are enforced only through the model's cooperation; a misbehaving model can ignore them. Deterministic routing would require intercepting the `subagent` tool call.
- **Routes are not validated against the LLM registry** — a pin or role naming an unregistered provider/model fails at delegation time (`NO_ADAPTER`), not at pin time.
- **Reasoning effort per child is out of scope** — `agentOptions` carries `provider`/`model`/`maxTokens` only; escalating thinking intensity means choosing a stronger model.
