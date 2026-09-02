# @deepseek-ai/dsh-planning

[English](README.md) | 中文

单个 Session 的事件溯源自适应规划：精确提案决定、一个 120 分钟 portfolio、串行功能 attempt、有界执行 slice，以及仅元数据 observation。`ctx.planning` 向所属 Session 日志写入完整的版本化快照，并通过严格回放重建状态。

## 约定

- 已暂存提案的 SHA-256 不可变；决定会推进其精确 revision。
- Portfolio 接受 0.60–0.70 load target，并检查 p90 总和加 reserve 等于 120 分钟。
- 同时只能运行一个功能 attempt。重试获取下一个 attempt number，且绝不重写终态事实。
- Slice 目标为 5–15 分钟；其它预算必须给出明确例外理由。
- 终态 attempt 分别记录 verifier 结果、人工介入、scope 状态和非 PASS outcome。
- Observation 只保留 id、kind、时间与 outcome，绝不包含 prompt 或 tool payload。

## 模型体验

### 规划状态服务

#### 模型看到什么

服务本身不注册工具或 prompt 指引。`@deepseek-ai/dsh-tool-planning` 等消费方会暴露选定操作。

#### Token 影响

仅加载本包不会增加模型 token。除非另一消费方显式渲染，否则持久规划事件不会进入消息历史。

#### KV Cache 影响

本服务不会改变请求前缀，因此没有 cache 影响。

## 已知限制与延期工作

- **单一 portfolio** — MVP 每个 Session 只允许一个 portfolio，且绝不自动重排功能。
- **Resume 计时** — 单调时钟起点仅在进程内有效；resume 后回退到 wall clock。
- **独立投影** — 校准与 critical-path 分析仍由独立消费方／提供方负责。
