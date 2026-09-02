# @deepseek-ai/dsh-tool-planning

English | [中文](README.zh.md)

Model-facing controls over `ctx.planning`: read status, materialize a portfolio from an exact approved proposal, and start/finish feature attempts and execution slices. Proposal staging and human review are deliberately absent; a source adapter owns that boundary, and the service rejects a portfolio without its durable approval revision and hash.

## Model Experience

### Planning lifecycle tools

#### What the model sees

The opt-in package contributes six tools from `planning_status` through bounded attempt and slice transitions. Their schemas expose planning ids, estimates, terminal outcomes, verifier/intervention/scope facts, and the 5–15 minute slice budget. Results are compact JSON snapshots. No planning state is injected into every model request.

#### Token effect

Tool schemas add a fixed prompt cost only in presets that enable this package. Calls return data-dependent compact JSON.

#### KV Cache effect

The tool set is stable for the Session preset, so planning state changes do not alter the reusable system-prompt prefix.

## Known Limitations and Deferred Work

- **Generic presentation** — the MVP has no rich portfolio or proposal-diff card.
- **Separated concerns** — source approval, Git apply, calibration reports, and automatic observations remain separate packages.
