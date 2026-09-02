# planning/ — 自适应规划能力系列

[English](README.md) | 中文

本系列负责事件溯源的 Session portfolio、attempt、执行 slice、observation、校准与面向模型的控制。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`planning/`](planning/README.zh.md) | 持久规划状态与生命周期 | `ctx.planning` |
| [`planning-calibration/`](planning-calibration/README.zh.md) | 可重建样本、估计与建议 | `ctx.planningCalibration` |
| [`planning-observer/`](planning-observer/README.zh.md) | 仅元数据的 job/subagent 生命周期桥接 | — |
| [`planning-review/`](planning-review/README.zh.md) | 精确 hash 人工审核与来源适配器注册表 | `ctx.planningReview` |
| [`planning-source-governance/`](planning-source-governance/README.zh.md) | 本地 data-platform-governance 事务适配器 | — |
| [`tool-planning/`](tool-planning/README.zh.md) | 面向模型的规划控制 | — |

本系列为 opt-in，且不会把 Git backlog 或功能约定纳入 Harness authority；这些集成由来源适配器负责。
