# @deepseek-ai/dsh-planning-source-governance

English | [中文](README.zh.md)

Deployment adapter for the `data-platform-governance` repository. It registers source `data-platform-governance` on `ctx.planningReview` and invokes only `<root>/scripts/adaptive_planning.py apply` with temporary mode-0600 proposal and approval files, no shell interpolation. The Python boundary revalidates source Git/file hashes, dirty overlap, schemas, dependencies, load capacity, exact approval identity, idempotency, lock, recovery journal, and atomic publication.

`root` must be absolute. `pythonBinary` and timeout are deployment configuration; no repository mutation occurs before `planning-review` rechecks the Session's exact approved proposal hash.

## Model Experience

### Governance source registration

#### What the model sees

The adapter adds no tools of its own. It enables the source name used by `planning_apply_proposal`.

#### Token effect

There is no direct token cost; the review package accounts for its own tool schema and results.

#### KV Cache effect

There is no cache effect because source registration does not change model input.

## Known Limitations and Deferred Work

- **Local process only** — remote repository adapters are deferred to other providers.
- **Narrow mutation** — it never commits, pushes, resolves conflicts, deploys runtime changes, or exposes an arbitrary command surface.
