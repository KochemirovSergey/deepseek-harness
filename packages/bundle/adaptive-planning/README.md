# `@deepseek-ai/dsh-adaptive-planning`

English | [中文](README.zh.md)

Opt-in profile bundle that inserts `dsh-planning`, `dsh-planning-calibration`, `dsh-planning-observer`, `dsh-planning-review`, and `dsh-tool-planning`. It is intentionally absent from the base bundle: deployments choose whether the planning tool schemas and local planning data exist.

Storage-backed calibration activates only in compositions that already provide `ctx.storageDomain` (the web-app bundle does). Core Session planning and tools remain available without it.

## Model Experience

### Adaptive-planning capability set

#### What the model sees

The bundle adds the controls documented by `@deepseek-ai/dsh-tool-planning` and `@deepseek-ai/dsh-planning-review`; no extra prompt text is injected. It recommends and records work but never automatically reorders a portfolio or applies Git changes.

#### Token effect

Fixed tool schemas add prompt tokens only in profiles that enable this bundle. Tool-call proposals and results add data-dependent tokens.

#### KV Cache effect

The schema set stays fixed for the profile; Session planning changes do not mutate the reusable prompt prefix.

## Known Limitations and Deferred Work

- **Deployment-specific source** — the governance repository adapter must be added separately with an explicit root.
- **No automatic mutation** — the bundle supplies portable planning and review, not automatic source changes or outbound telemetry.
