# @deepseek-ai/dsh-planning

English | [中文](README.zh.md)

Event-sourced adaptive planning for one Session: exact proposal decisions, one 120-minute portfolio, serial feature attempts, bounded execution slices, and metadata-only observations. `ctx.planning` writes complete versioned snapshots to the owning Session log and reconstructs them by strict replay.

## Contracts

- A staged proposal is immutable by SHA-256; a decision advances its exact revision.
- A portfolio admits a 0.60–0.70 load target and checks that summed `p90` plus reserve equals 120 minutes.
- Only one feature attempt may run. Retries receive the next attempt number and never rewrite terminal facts.
- A slice targets 5–15 minutes; another budget requires an explicit exception reason.
- Terminal attempts distinguish verifier result, manual intervention, scope status, and non-PASS outcomes.
- Observations retain ids, kinds, timing, and outcomes, never prompts or tool payloads.

## Model Experience

### Planning state service

#### What the model sees

The service itself registers no tools or prompt guidance. Consumers such as `@deepseek-ai/dsh-tool-planning` expose selected operations.

#### Token effect

Loading only this package adds no model tokens. Durable planning events remain outside message history unless another Consumer renders them.

#### KV Cache effect

There is no cache effect because this service does not change the request prefix.

## Known Limitations and Deferred Work

- **One portfolio** — the MVP allows one portfolio per Session and never automatically reorders features.
- **Resume timing** — monotonic starts are process-local, with wall-clock fallback after resume.
- **Separate projections** — calibration and critical-path analysis remain separate Consumers/providers.
