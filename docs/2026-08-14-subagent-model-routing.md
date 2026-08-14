# Agent Note: Subagent model routing

Status: implemented

English | [中文](2026-08-14-subagent-model-routing.zh.md)

## Problem

With several third-party providers and models configured, a parent agent delegates every subagent to the same route: the parent's own model, or one deployment-fixed `tool-subagent` `agentOptions`. There is no way to describe what each model is good at, to pin one provider/model for the current session, to forbid a model from auto-assignment, or to let the delegating model choose per task — the model-facing `subagent` tool exposes no per-call route.

## Decision

### An `agentOptions` start capability

`SubagentCapabilities` gains a required `agentOptions` flag, checked by `assertCapabilities` before `start`. In-process providers (`spawn`/`fork`) advertise `true`; `NO_START_CAPABILITIES` and the ACP provider advertise `false`, so a request an out-of-process provider would otherwise silently ignore is rejected loud (`UNSUPPORTED_CAPABILITY`).

### A per-call route on the delegation tool

`tool-subagent` exposes an optional `agentOptions` object parameter (`provider`/`model`/`maxTokens`) only when the bound provider has the capability. A per-call field overrides the deployment `config.agentOptions`; a configured or per-call override without the capability fails the mount or the call.

### A `model-roles` routing plugin

`@deepseek-ai/dsh-model-roles` owns a `model-roles` settings namespace mapping provider → model → `{ description, subagent }`, and a per-session pin logged as `model-roles/subagent-pin` (whole-value, last wins). A system-prompt section renders either the pinned route or the `subagent: true` candidates with their descriptions, telling the delegating model to pass `agentOptions`. `/subagent-model <provider>/<model>` pins and `/subagent-model off` clears. Routing is advisory (soft): the model cooperates through the per-call `agentOptions`; nothing intercepts the tool call. The pin flips commit immediately between turns and stay queued during an open turn, flushing at the next accepted `agent/pre-step` (plan-mode's pattern).

### A `model-roles` session projection

The same plugin registers a `model-roles` session-projection unit (whole-value fold of the pin, `stateVersion` 1) so client surfaces read the current pin from the projection store instead of folding the log themselves. The unit child activates only when a projection registry is composed; headless assemblies stay unaffected.

### A browser picker over the model directory

`@deepseek-ai/dsh-client-ui-subagent-model` decorates the host `/subagent-model` command with a `popupSelect`. Rows come from the session model directory (`session.models`), so the box stays in sync with the configured providers; each row shows the display name on the label line and `provider · model id` on the detail line, and the row matching the current pin (read from the `model-roles` projection) is marked active. Picking a row executes the host command line, so a manual argued invocation keeps working. Addressed subagent sessions expose no popup.

### A settings page for model roles

The browser half also registers a **Subagent Models** settings section (`settings.section`, id `model-roles`, order 20) that manages the same `model-roles` namespace the routing plugin reads. It enumerates the session-independent model directory (`llm.models` — the same source the Models settings page renders), joins each row with its stored role, and writes through `settings.mutate` with the expected revision, so a concurrent edit is refused rather than silently overwritten. The section lives in an optional child fiber over `['slots', 'locale', 'connection', 'remote']`: a composition without the settings shell keeps the popup decoration and nothing else, and a read-only settings provider disables every write control. The host plugin watches its namespace, so a saved row is effective immediately; pushed invalidations (`settings/document-updated` for the `model-roles` namespace only, `llm/adapters-updated`, `connection/reset`) refetch the page after it has loaded at least once.

### Global mounting

`packages/bundle/base` mounts both `model-roles` and `client-ui-subagent-model` so every profile (headless included) gets the routing seam; `web-app` adds the browser half to the web profile.

## Alternatives considered

- **Deterministic routing** through `tools/pre-execute` rewriting the tool arguments — rejected for the first cut because it hides the decision from the transcript and fights the model's own judgment; the soft route keeps the choice model-visible and logged.
- **Extending `AgentOptions` with `reasoningEffort`** for per-child thinking intensity — rejected: `reasoningEffort` lives on `ModelSelection`/`LlmCallConfig`, not `AgentOptions`, and wiring it per child touches the core loop. Escalating intensity is expressed as choosing a stronger model instead.

## Testing

`tool-subagent` tests cover per-call merge, per-call rejection, mount-time rejection, and schema exposure. `model-roles` tests cover the pin fold, `set` commit/queue/noop, the queued-clear path, the pre-step flush, and the routing guidance section. A REAL-composition suite boots a cordis.yml through the Loader with the settings provider, the loop spine, commands, session projections, and model-roles, then drives the model-visible system prompt through a mock adapter and the `/subagent-model` command through the real command registry. `client-ui-subagent-model` tests cover the popup rows, the active marker, the command execution, the failure arms (dead session, failed model directory, unadmitted command), and — for the settings page — the section registration (id/order/locale-following label), HMR re-registration, pushed-invalidation routing, and the per-model draft/save/clear flows including read-only, empty-description blocking, and write-failure arms. `SubagentCapabilities` literals across the subagent, sdk/server, and workflow test suites are updated; the Codex and Claude Code loader-composition e2e asserts `agentOptions: false`.

## Consequences

- Out-of-process providers (ACP, Codex, Claude Code, dsh-sdk) reject per-child routes loudly; routing works only on in-process `spawn`/`fork` today.
- The pin and candidate list are advisory: a model can ignore them. Deterministic enforcement is deferred.
- Role routes are not validated against the LLM registry; a pin or role naming an unregistered route fails at delegation (`NO_ADAPTER`).
- The settings page edits each model's `subagent` switch (which the auto-assignment guidance honors), but the popup still lists every configured model regardless of that flag; a dedicated pin RPC (so the picker can refuse `subagent: false` models) is deferred.
