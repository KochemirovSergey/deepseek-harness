# 自适应规划

[English](planning.md) | 中文

自适应规划是可选的 Session 状态。Git 仓库仍然是已接受 feature contract 与 backlog 变更的权威；DSH 保存审核决定、单一 Session portfolio、attempt、slice 与仅含元数据的 observation；`storage-domain` 保存可重建的校准样本。

## 持久 Session 模型

`ctx.planning` 通过 `planning/change` 与 `planning/observation` 追加带版本的完整快照。严格回放会拒绝过期 revision、非法生命周期边、多个运行中的 attempt、未进入已批准 portfolio 的 attempt、缺失的因果 parent，以及倒置的时间区间。

- `PlanningProposalSnapshot`、`StageProposalRequest`、`DecideProposalRequest` 将决定绑定到小写 SHA-256 与精确 revision。
- `PortfolioSnapshot`、`CreatePortfolioRequest` 要求当前已批准提案、120 分钟 horizon、`0.60..0.70` load target、连续优先级位置与精确 reserve 算术。
- `FeatureAttemptSnapshot`、`StartAttemptRequest`、`FinishAttemptRequest` 保留 work class/tag/risk、逐 attempt 估计、verifier 结果、人工介入、scope 状态、单调时钟 duration 与终态 outcome。
- `ExecutionSliceSnapshot`、`StartSliceRequest`、`FinishSliceRequest` 目标为 5–15 分钟；其它预算必须有理由。
- `PlanningObservation` 只携带 id、phase、因果 parent、可选 attempt/slice 关联、时间、outcome 和 JSON 元数据；不得复制 prompt、命令输出、assistant 内容、tool 输入、凭据或原始协议 payload。
- `PlanningView` 是一个精确存活 Agent 的回放视图。

## 人工审核与来源应用

`ctx.planningReview` 对完整 JSON 提案递归排序 object key、计算 SHA-256，并通过 `ctx.userQuestions` 的 plan-review intent 请求人类决定。`PlanningApproval` 记录提案 hash、Session、随机持久 review id 与时间。`applyApproved()` 在调用已注册的 `PlanningSourceAdapter` 之前再次核对全部字段；只有 provider 成功返回后，提案才进入 `applied`。`PlanningReviewResult` 携带 rejection 或精确 approval artifact。

`@deepseek-ai/dsh-planning-source-governance` 是 `data-platform-governance` 的窄本地 adapter：只以 mode-0600 临时文件调用 `scripts/adaptive_planning.py apply`。仓库脚本负责 stale source、dirty overlap、schema、dependency、capacity、幂等、锁、恢复与原子发布检查。

## 校准与调度

`ctx.planningCalibration` 从终态 attempt 派生 `CalibrationSample`。首次成功严格要求 attempt 1、PASS、在 p90 内、scope 未变且无人工介入。`CalibrationEstimateRequest` 依次使用 exact、work-class/risk、work-class、global cohort；`CalibratedEstimate` 把经验 p50/p90 向 caller/default prior 收缩，并报告 cohort、sample count、confidence、error 与 success rate。

`ScheduleCandidate` 的输入顺序就是 authority；只要 p90 总和不超过 `120 * loadTarget`，`ScheduleRecommendation` 就按原顺序接纳条目并报告 capacity exclusion 与 reserve，绝不变更或自动重排来源工作。

## Trace 语义

Job snapshot 暴露仅元数据的 progress 与单调终态 `durationMs`。Opt-in observer 把所属 job 与配对 subagent 生命周期映射为 planning observation。Trace container 提供 wall 边界，active time 是 leaf interval 的并集；critical path 是 container 权重为零的因果 DAG 最长路径，因此并行 job/subagent 不会重复计时。进程内 observer dispose 会以 `interrupted` 关闭存活 subagent 边；仅因崩溃而保持开放的边由回放／报告归类为 interrupted。

## 组合

`@deepseek-ai/dsh-adaptive-planning` 插入 planning、calibration、observer、review 与模型工具。只有 host 提供 `ctx.storageDomain` 时校准才激活。该 bundle 不属于 base，不启用出站 telemetry，也不会自动修改来源。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

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

Types: [Session](session.zh.md)

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

Types: [Agent](core.zh.md)

Source: [`packages/planning/planning-review/src/index.ts`](../../packages/planning/planning-review/src/index.ts)
<!-- END GENERATED cordis-surface -->
