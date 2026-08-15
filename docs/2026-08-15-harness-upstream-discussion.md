# Discussion draft — for deepseek-ai/deepseek-harness

> Publish this as a Discussion on the upstream repo. PR channel is currently
> closed, so this serves as the durable record. All names are neutralized;
> no credentials or real machine paths appear.

---

## Title: Subagent route override is silently dropped by `tool-subagent`, plus two extension gaps for out-of-repo plugins

**Context.** While installing and verifying a third-party "subagent model roles" plugin (settings-backed per-model capability descriptions + per-session subagent-model pinning that tells the delegating model to pass `agentOptions: { provider, model }` on each `subagent` call), I hit three harness-side issues worth recording. The first is a bug; the other two are extension-point gaps for out-of-repo (downstream) plugins.

### 1. `tool-subagent` drops the per-call `agentOptions` (bug)

**Symptom.** The delegating agent passes `agentOptions: { provider, model }` on the `subagent` tool call (visible in the session trace), but every spawned child still routed to the parent's **creation-time** default route — in our case an invalid route, so children failed with `subagent run failed` (HTTP 401 from the adapter) and `list_agents` showed no durable children.

**Root cause.** `packages/subagent/tool-subagent/src/index.ts`'s `execute()` only reads `args.description` and `args.prompt`. `agentOptions` was not declared in the tool schema and the argument was silently accepted-but-ignored, so `request.agentOptions` was only ever populated from the plugin's `config.agentOptions` (a fixed default). `resolveChildAgentOptions(parent, request.agentOptions, depth)` already merges a request override correctly — it is the tool that never forwards it.

**Fix (implemented + tested locally).** Declare an optional `agentOptions` parameter (`provider` / `model` / `maxTokens`) on the tool schema, and in `execute()` merge the per-call argument field-by-field over `config.agentOptions` before building the provider request. Omitting the argument preserves existing behavior exactly. Tests updated and added; the `packages/subagent/tool-subagent` suite passes 62/62. Reference commit: `fix/tool-subagent-agentoptions` @ `57ea25e` on the public fork `qwased/deepseek-harness`.

### 2. Out-of-repo plugins cannot add durable session event types (gap)

**Symptom.** A plugin that logs its own session events (e.g. a `model-roles/subagent-pin` event) makes those sessions un-resumable after restart: `SessionFormatUnsupportedError: session "…" contains event type "model-roles/subagent-pin" … unknown to this harness and not marked ignorable`.

**Root cause.** `KNOWN_SESSION_EVENT_TYPES` in `packages/core/session/src/known-event-types.ts` is a **generated** static set of in-repo `SessionEventMap` members (via `scripts/gen-persistence-catalog.ts`). The generated file's own comment states that downstream (out-of-repo) plugin events are outside the list "by construction" and that "a registration surface for them is deferred until such a consumer exists" — this plugin is that first consumer.

**Suggestion.** Add a runtime registration surface for downstream session-event types (e.g. `ctx.session.knownTypes.register(...)`), or a supported way for a plugin to mark its own events `ignorable`, so a persisted log containing plugin events stays interpretable without regenerating the catalog.

### 3. Settings namespaces exposed to configuration clients are hard-coded (gap)

**Symptom.** Saving a plugin's settings namespace from the client fails with `settings namespace "model-roles" is not exposed to configuration clients`.

**Root cause.** The host api-proxy's `PRODUCT_SETTINGS_NAMESPACES` is a fixed set; a downstream plugin cannot declare its own namespace as client-writable without patching the harness.

**Suggestion.** Make the exposable-namespace list extensible (plugins register their namespace), so third-party settings pages can persist without a harness patch.

---

**Status.** The PR channel is currently closed, so this is posted as a record. Happy to turn any of these into a PR when PRs reopen. Fix #1 is small, backward-compatible, and already covered by tests.
