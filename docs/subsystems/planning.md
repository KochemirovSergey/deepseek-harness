# Adaptive planning

English | [中文](planning.zh.md)

Adaptive planning is opt-in Session state. Git repositories remain authoritative for accepted feature contracts and backlog mutation; DSH owns review decisions, one Session portfolio, attempts, slices, and metadata-only observations; `storage-domain` holds rebuildable calibration samples.

## Durable Session model

`ctx.planning` appends versioned complete snapshots under `planning/change` and `planning/observation`. Strict replay rejects stale revisions, invalid lifecycle edges, multiple running attempts, attempts outside the approved portfolio, missing causal parents, and inverted timing intervals.

- `PlanningProposalSnapshot`, `StageProposalRequest`, and `DecideProposalRequest` bind decisions to a lowercase SHA-256 and exact revision.
- `PortfolioSnapshot` and `CreatePortfolioRequest` require the current approved proposal, a 120-minute horizon, load target `0.60..0.70`, contiguous priority positions, and exact reserve arithmetic.
- `FeatureAttemptSnapshot`, `StartAttemptRequest`, and `FinishAttemptRequest` retain work class/tags/risk, per-attempt estimates, verifier result, manual intervention, scope status, monotonic duration, and terminal outcome.
- `ExecutionSliceSnapshot`, `StartSliceRequest`, and `FinishSliceRequest` target 5–15 minutes; another budget requires a reason.
- `PlanningObservation` carries ids, phase, causal parents, optional attempt/slice correlation, timing, outcome, and lossless-JSON metadata. It must not carry prompts, command output, assistant content, tool inputs, credentials, or raw protocol payloads.
- `PlanningView` is the replayed proposal, portfolio, attempts, slices, and observations for one exact live Agent.

## Human review and source apply

`ctx.planningReview` canonicalizes a complete JSON proposal with recursively sorted object keys, computes SHA-256, and asks through `ctx.userQuestions` using plan-review intent. An approval artifact (`PlanningApproval`) names the proposal hash, Session, random durable review id, and decision time. `applyApproved()` rechecks all fields against the durable proposal before invoking a registered `PlanningSourceAdapter`; only successful provider return advances the proposal to `applied`. `PlanningReviewResult` carries either the rejection or the exact approval artifact.

`@deepseek-ai/dsh-planning-source-governance` is the narrow local adapter for `data-platform-governance`: it invokes only `scripts/adaptive_planning.py apply` with mode-0600 temporary files. The repository script owns stale-source, dirty-overlap, schema, dependency, capacity, idempotency, lock, recovery, and atomic-publication checks.

## Calibration and scheduling

`ctx.planningCalibration` derives `CalibrationSample` rows from terminal attempts. A first-attempt success means attempt 1, PASS, within p90, unchanged scope, and no manual intervention. `CalibrationEstimateRequest` falls through exact, work-class/risk, work-class, and global cohorts; `CalibratedEstimate` shrinks empirical p50/p90 toward caller/default priors and reports cohort, sample count, confidence, error, and success rate.

`ScheduleCandidate` order is authority. `ScheduleRecommendation` admits entries in that order while summed p90 remains within `120 * loadTarget`; it reports capacity exclusions and reserve but never mutates or automatically reorders source work.

## Trace semantics

Job snapshots expose metadata-only progress and monotonic terminal `durationMs`. The opt-in observer maps owned jobs and subagent lifecycle pairs into planning observations. Trace containers provide wall bounds; active time is the union of leaf intervals. The critical path is the longest causal DAG path with container weight zero, so parallel jobs/subagents are not double-counted. An in-process observer disposal closes live subagent edges as `interrupted`; crash-only open edges are classified as interrupted by replay/reporting.

## Composition

`@deepseek-ai/dsh-adaptive-planning` inserts planning, calibration, observer, review, and model tools. Calibration activates when a host provides `ctx.storageDomain`. The bundle is deliberately absent from base and contributes no outbound telemetry or automatic source mutation.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxplanning--planningservice"></a>

### `ctx.planning` — `PlanningService`

Planning state owned by the exact live agent's Session log.

```ts cordis-catalog
/**
 * Read current durable planning state.
 * @param agent - Exact live owner.
 * @returns Replayed planning view for its Session.
 */
get(agent: Agent): PlanningView

/**
 * Stage one immutable proposal.
 * @param agent - Exact live owner.
 * @param request - Immutable proposal identity.
 * @returns Staged revision.
 */
stageProposal(agent: Agent, request: StageProposalRequest): PlanningProposalSnapshot

/**
 * Decide the exact current proposal revision.
 * @param agent - Exact live owner.
 * @param request - Exact revision/hash decision.
 * @returns Advanced proposal.
 */
decideProposal(agent: Agent, request: DecideProposalRequest): PlanningProposalSnapshot

/**
 * Materialize an approved capacity plan.
 * @param agent - Exact live owner.
 * @param request - Approved capacity plan.
 * @returns Created portfolio.
 */
createPortfolio(agent: Agent, request: CreatePortfolioRequest): PortfolioSnapshot

/**
 * Start one portfolio feature attempt.
 * @param agent - Exact live owner.
 * @param request - Portfolio feature attempt.
 * @returns Running attempt.
 */
startAttempt(agent: Agent, request: StartAttemptRequest): FeatureAttemptSnapshot

/**
 * Close the exact running feature attempt.
 * @param agent - Exact live owner.
 * @param request - Terminal attempt facts.
 * @returns Terminal attempt.
 */
finishAttempt(agent: Agent, request: FinishAttemptRequest): FeatureAttemptSnapshot

/**
 * Start one bounded execution slice.
 * @param agent - Exact live owner.
 * @param request - Bounded execution slice.
 * @returns Running slice.
 */
startSlice(agent: Agent, request: StartSliceRequest): ExecutionSliceSnapshot

/**
 * Close the exact running execution slice.
 * @param agent - Exact live owner.
 * @param request - Terminal slice facts.
 * @returns Terminal slice.
 */
finishSlice(agent: Agent, request: FinishSliceRequest): ExecutionSliceSnapshot

/**
 * Append one metadata-only lifecycle fact.
 * @param agent - Exact live owner.
 * @param observation - Metadata-only fact.
 * @returns Durable observation snapshot.
 */
observe(agent: Agent, observation: Omit<PlanningObservation, 'id' | 'observedAt'>): PlanningObservation
```

Types: [Agent](core.md)

Source: [`packages/planning/planning/src/index.ts`](../../packages/planning/planning/src/index.ts)

<a id="ctxplanningcalibration--planningcalibrationservice"></a>

### `ctx.planningCalibration` — `PlanningCalibrationService`

Storage-backed derived calibration provider.

```ts cordis-catalog
/**
 * Read current immutable samples from the derived cache.
 * @returns Detached sample snapshots.
 */
samples(): CalibrationSample[]

/**
 * Estimate one work cohort.
 * @param request - Work cohort and optional prior.
 * @returns Hierarchically calibrated estimate.
 */
estimate(request: CalibrationEstimateRequest): CalibratedEstimate

/**
 * Recommend work without changing candidate priority.
 * @param candidates - Priority-ordered work.
 * @param loadTarget - Fraction from 0.60 to 0.70.
 * @returns Capacity-safe recommendation.
 */
schedule(candidates: readonly ScheduleCandidate[], loadTarget: number = 0.65): ScheduleRecommendation

/**
 * Upsert one derived calibration row.
 * @param sample - Full derived calibration row.
 * @returns Resolution after durable storage.
 */
async record(sample: CalibrationSample): Promise<void>

/**
 * Idempotently derive terminal attempts from one Session log.
 * @param session - Authoritative planning log.
 * @returns Number of terminal attempts upserted.
 */
async ingestSession(session: Session): Promise<number>
```

Types: [Session](session.md)

Source: [`packages/planning/planning-calibration/src/index.ts`](../../packages/planning/planning-calibration/src/index.ts)

<a id="ctxplanningreview--planningreviewservice"></a>

### `ctx.planningReview` — `PlanningReviewService`

Portable authority boundary; deployment adapters own source mutation.

```ts cordis-catalog
/**
 * Register one deployment-owned source boundary.
 * @param adapter - Named deployment source boundary.
 * @returns Registration disposer.
 */
registerSource(adapter: PlanningSourceAdapter): () => void

/**
 * List available source boundaries.
 * @returns Registered source names in stable order.
 */
listSources(): string[]

/**
 * Ask a human to decide one complete canonical proposal.
 * @param agent - Exact live human-facing owner.
 * @param request - Complete proposal and source identity.
 * @returns Durable exact-hash review result.
 */
async review(agent: Agent, request: { readonly source: string readonly summary: string readonly proposal: Record<string, unknown> readonly signal?: AbortSignal }): Promise<PlanningReviewResult>

/**
 * Apply one exact durably approved proposal.
 * @param agent - Exact live approval owner.
 * @param request - Proposal plus approval artifact.
 * @returns Source adapter result.
 */
async applyApproved(agent: Agent, request: { readonly source: string readonly proposal: Record<string, unknown> readonly approval: PlanningApproval }): Promise<unknown>
```

Types: [Agent](core.md)

Source: [`packages/planning/planning-review/src/index.ts`](../../packages/planning/planning-review/src/index.ts)
<!-- END GENERATED cordis-surface -->
