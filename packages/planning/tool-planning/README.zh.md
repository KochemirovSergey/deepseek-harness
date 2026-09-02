# @deepseek-ai/dsh-tool-planning

[English](README.md) | 中文

面向模型的 `ctx.planning` 控制：读取状态、从精确批准的提案物化 portfolio，以及开始／结束功能 attempt 与执行 slice。特意不包含提案暂存和人工审核；来源 adapter 负责该 boundary，且没有持久 approval revision 与 hash 时服务会拒绝 portfolio。

## 模型体验

### 规划生命周期工具

#### 模型看到什么

Opt-in 包提供从 `planning_status` 到有界 attempt 与 slice transition 的六个工具。Schema 暴露 planning id、估计、终态 outcome、verifier/intervention/scope 事实与 5–15 分钟 slice 预算。结果是紧凑 JSON 快照。规划状态不会注入每次模型请求。

#### Token 影响

只有启用本包的 preset 才承担固定 tool schema prompt 成本。调用返回随数据变化的紧凑 JSON。

#### KV Cache 影响

Tool set 在 Session preset 内保持稳定，因此 planning 状态变更不会改变可复用 system-prompt 前缀。

## 已知限制与延期工作

- **通用展示** — MVP 没有丰富的 portfolio 或 proposal-diff card。
- **关注点分离** — 来源 approval、Git apply、calibration report 与自动 observation 保持为独立包。
