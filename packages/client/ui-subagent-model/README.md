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
  never an enforced route. The popup lists every configured model regardless
  of its `subagent` switch; honoring `subagent: false` in the picker is
  deferred until a dedicated pin RPC exists.
- **Catalog absence renders an empty box**: a session whose provider catalog
  failed to load offers no rows (the shared popup shell shows its empty
  state); the typed command remains the fallback.
