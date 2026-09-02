# @deepseek-ai/dsh-planning-calibration

English | [中文](README.zh.md)

Rebuildable local calibration derived from terminal planning attempts. The service stores metadata-only samples in a `storage-domain` table, produces a small-sample hierarchical p50/p90 estimate, and recommends a capacity-safe 120-minute portfolio while preserving candidate order.

The package also exports `criticalPath()`: containers provide wall bounds, leaf intervals provide active time, and the longest causal DAG path avoids summing parallel jobs or subagents twice.

## Model Experience

### Calibration service

#### What the model sees

No tools or request context are registered. Consumers explicitly call `ctx.planningCalibration` or render recommendations.

#### Token effect

The package adds no tokens by itself. Samples remain local derived storage and do not enter Session messages.

#### KV Cache effect

There is no cache effect because calibration does not alter prompt prefixes.

## Known Limitations and Deferred Work

- **Simple estimator** — exact/class-risk/class/global fallback shrinks toward a prior; no parametric fit or tag embedding is learned.
- **Recommendation only** — scheduling never reorders candidates and exports no telemetry.
- **Strict success label** — first-attempt success requires attempt 1, PASS, p90 budget, unchanged scope, and no intervention.
