# `@deepseek-ai/dsh-adaptive-planning`

[English](README.md) | 中文

插入 `dsh-planning`、`dsh-planning-calibration`、`dsh-planning-observer`、`dsh-planning-review` 和 `dsh-tool-planning` 的 opt-in profile bundle。它特意不属于 base bundle：deployment 自行决定是否提供 planning tool schema 与本地 planning 数据。

只有已提供 `ctx.storageDomain` 的 composition（web-app bundle 会提供）才启用 storage-backed calibration。没有该服务时，核心 Session planning 与工具仍可用。

## 模型体验

### 自适应规划能力集

#### 模型看到什么

Bundle 添加 `@deepseek-ai/dsh-tool-planning` 与 `@deepseek-ai/dsh-planning-review` 文档所述控制，不注入额外 prompt 文本。它推荐并记录工作，但绝不自动重排 portfolio 或应用 Git 变更。

#### Token 影响

只有启用此 bundle 的 profile 才承担固定 tool schema prompt token。Tool-call 提案与结果添加随数据变化的 token。

#### KV Cache 影响

Schema set 在 profile 内固定；Session planning 变更不会改变可复用 prompt 前缀。

## 已知限制与延期工作

- **Deployment-specific source** — governance 仓库 adapter 必须使用显式 root 单独添加。
- **无自动变更** — bundle 提供 portable planning 与 review，不自动更改来源，也不发送 outbound telemetry。
