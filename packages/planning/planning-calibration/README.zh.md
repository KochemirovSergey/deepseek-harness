# @deepseek-ai/dsh-planning-calibration

[English](README.md) | 中文

从终态 planning attempt 派生的可重建本地校准。服务在 `storage-domain` 表中保存仅元数据样本，生成小样本分层 p50/p90 估计，并在保留候选顺序的前提下推荐容量安全的 120 分钟 portfolio。

本包还导出 `criticalPath()`：container 提供 wall bound，leaf interval 提供 active time，最长因果 DAG path 避免对并行 job 或 subagent 重复求和。

## 模型体验

### 校准服务

#### 模型看到什么

不注册工具或请求上下文。消费方显式调用 `ctx.planningCalibration` 或渲染建议。

#### Token 影响

本包自身不增加 token。样本留在本地派生存储中，不进入 Session 消息。

#### KV Cache 影响

校准不改变 prompt 前缀，因此没有 cache 影响。

## 已知限制与延期工作

- **简单估计器** — exact/class-risk/class/global fallback 向 prior 收缩；不学习参数分布或 tag embedding。
- **仅建议** — 调度绝不重排候选项，也不导出 telemetry。
- **严格成功标签** — 首次 attempt 成功要求 attempt 1、PASS、p90 预算内、scope 未变且无介入。
