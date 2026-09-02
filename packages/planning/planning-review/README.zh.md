# @deepseek-ai/dsh-planning-review

[English](README.md) | 中文

精确 hash 人工审核与来源应用 authority boundary。`planning_review_proposal` canonicalize 完整 JSON 提案，把 SHA-256 暂存到 Session，并通过 `ctx.userQuestions` 使用 plan-review intent。批准会返回包含 proposal/session/review identity 的持久 artifact。`planning_apply_proposal` 在调用具名 deployment adapter 前，对照 Session 状态重新检查 artifact；仅 adapter 成功后才把提案标记为 applied。

普通对话中的批准无法生成该 artifact。来源 adapter 以 imperative 方式注册，并负责仓库特定的 stale-source、dirty-overlap、事务与幂等检查。

## 模型体验

### 提案审核与应用工具

#### 模型看到什么

`planning_review_proposal` 与 `planning_apply_proposal` 通过 JSON 字符串接收 proposal 和 approval 文档，使 schema 保持 source-neutral。人工审核 UI 展示完整提案与 canonical hash。

#### Token 影响

仅加载本包时固定 schema 才增加 prompt token；提案正文和紧凑结果属于随调用数据变化的 tool-call 内容。

#### KV Cache 影响

提案正文是调用数据而非持久 prompt 上下文，因此 schema 前缀保持稳定。

## 已知限制与延期工作

- **单一当前提案** — 每个 Session 同时暴露一个提案生命周期。
- **审核 identity** — 不推断 authentication identity；随机持久 review id 把 UI 回答绑定到 Session event。
- **Deployment-owned source** — 每个 deployment 决定可用的来源 adapter。
