# @deepseek-ai/dsh-client-ui-subagent-model

English | [中文](README.zh.md)

Subagent model pinning UI, browser half: decorates the host `/subagent-model`
command with a popupSelect. Options load from the session's model directory
(`session.models`), so the box always reflects the providers configured in
settings; each row shows the display name on the label line and the provider
route plus model id on the detail line, satisfying the three-field rule
(provider / model id / display name). The row matching the session's current
pin — read from the `model-roles` session projection — carries the active
check. Picking a row executes the host command
`/subagent-model <provider>/<model>`, which logs the pin event and renders
the command node in the conversation; the argued manual invocation keeps
working unchanged because the popup only decorates the bare command.

Addressed subagent sessions (the `@`-referenced children) expose no popup:
their pins are decided by the delegating model, not the user.

The `/client` exports are the plugin body (`apply`/`inject`) plus the pure
`optionsOf` row builder.

## Settings page

The browser half also registers a **Subagent Models** settings section
(`settings.section`, id `model-roles`, order 20) once the settings shell,
locale, and remote services are composed. It lists the whole model directory —
the same `llm.models` source the Models settings page renders — with one row
per model. Each row edits two fields:

- **Capability description**: free text describing what the model is good at.
  It is required — an empty description cannot be saved. This is the text the
  routing system-prompt section shows the delegating model.
- **Allow automatic subagent assignment**: the `subagent` switch. A model with
  the switch off is excluded from the auto-assignment candidates the routing
  guidance lists.

Rows stay in sync with the Models page because they enumerate the same model
directory: a provider or model added there appears here on the next load. Role
values live in the `model-roles` settings namespace, and every write goes
through `settings.mutate` with the expected revision, so a concurrent edit is
refused rather than silently overwritten. The host plugin watches its namespace
and hot-applies it — a saved row is effective immediately, no restart. Pushed
invalidations (`settings/document-updated` for the `model-roles` namespace,
`llm/adapters-updated`, `connection/reset`) refetch the page after it has
loaded at least once, so an open panel converges without polling.

The section activates in an optional child fiber over
`['slots', 'locale', 'connection', 'remote']`: a composition without the
settings shell still gets the popup decoration and nothing else. A read-only
settings provider disables every write control and says why.

## Model Experience

No direct prompt content. Picking a row runs the `/subagent-model` command,
whose handler appends the `model-roles/subagent-pin` log event; the routing
system-prompt section then instructs the delegating model to pass the pinned
`agentOptions` on each subagent tool call.

#### KV Cache effect

The command lifecycle records (`command/run`/`command/done`) are ordinary
log events; the pin never enters a model request body by itself. Selecting an
already-pinned row is a no-op that appends nothing.

## Known Limitations and Deferred Work

- **Soft execution only**: the pin is advisory — the model receives guidance,
  never an enforced route. The settings page edits each model's `subagent`
  switch (which the auto-assignment guidance honors), but the popup still lists
  every configured model regardless of that switch; filtering `subagent:
  false` models out of the picker is deferred until a dedicated pin RPC exists.
- **Catalog absence renders an empty box**: a session whose provider catalog
  failed to load offers no rows (the shared popup shell shows its empty
  state); the typed command remains the fallback.
