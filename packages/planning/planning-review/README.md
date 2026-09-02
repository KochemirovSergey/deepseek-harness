# @deepseek-ai/dsh-planning-review

English | [中文](README.zh.md)

Exact-hash human review and source-application authority boundary. `planning_review_proposal` canonicalizes a complete JSON proposal, stages its SHA-256 in the Session, and uses `ctx.userQuestions` with plan-review intent. Approval returns a durable artifact carrying proposal/session/review identities. `planning_apply_proposal` rechecks that artifact against Session state before calling a named deployment adapter, then marks the proposal applied only after the adapter succeeds.

Ordinary conversational approval cannot produce the artifact. Source adapters register imperatively and own repository-specific stale-source, dirty-overlap, transaction, and idempotency checks.

## Model Experience

### Proposal review and apply tools

#### What the model sees

`planning_review_proposal` and `planning_apply_proposal` accept proposal and approval documents as JSON strings so their schemas stay source-neutral. The human review UI shows the full proposal and canonical hash.

#### Token effect

The fixed schemas add prompt tokens only when this package is loaded; proposal bodies and compact results are data-dependent tool-call content.

#### KV Cache effect

The schema prefix stays stable because proposal bodies are call data, not persistent prompt context.

## Known Limitations and Deferred Work

- **One current proposal** — each Session exposes one proposal lifecycle at a time.
- **Review identity** — authentication identity is not inferred; a random durable review id ties the UI answer to the Session event.
- **Deployment-owned sources** — each deployment decides which source adapters are available.
