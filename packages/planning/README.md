# planning/ — adaptive planning capability family

English | [中文](README.zh.md)

This family owns event-sourced session portfolios, attempts, execution slices, observations, calibration, and model-facing controls.

| Package | Role | ctx key |
|---|---|---|
| [`planning/`](planning/README.md) | Durable planning state and lifecycle | `ctx.planning` |
| [`planning-calibration/`](planning-calibration/README.md) | Rebuildable samples, estimates, and recommendations | `ctx.planningCalibration` |
| [`planning-observer/`](planning-observer/README.md) | Metadata-only job/subagent lifecycle bridge | — |
| [`planning-review/`](planning-review/README.md) | Exact-hash human review and source adapter registry | `ctx.planningReview` |
| [`planning-source-governance/`](planning-source-governance/README.md) | Local data-platform-governance transaction adapter | — |
| [`tool-planning/`](tool-planning/README.md) | Model-facing planning controls | — |

The family is opt-in and does not make Git backlog or feature contracts part of Harness authority; source adapters own those integrations.
