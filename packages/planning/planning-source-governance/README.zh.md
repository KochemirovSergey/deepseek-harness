# @deepseek-ai/dsh-planning-source-governance

[English](README.md) | 中文

`data-platform-governance` 仓库的 deployment adapter。它在 `ctx.planningReview` 上注册来源 `data-platform-governance`，并仅通过无 shell 插值的 mode-0600 临时 proposal 与 approval 文件调用 `<root>/scripts/adaptive_planning.py apply`。Python boundary 会重新验证来源 Git/file hash、dirty overlap、schema、dependency、load capacity、精确 approval identity、幂等、锁、recovery journal 与原子发布。

`root` 必须是绝对路径。`pythonBinary` 与 timeout 属于 deployment 配置；在 `planning-review` 重新检查 Session 精确批准的 proposal hash 之前，不会发生仓库变更。

## 模型体验

### Governance 来源注册

#### 模型看到什么

Adapter 自身不添加工具。它启用 `planning_apply_proposal` 使用的来源名称。

#### Token 影响

没有直接 token 成本；review 包负责自己的 tool schema 与结果。

#### KV Cache 影响

来源注册不改变模型输入，因此没有 cache 影响。

## 已知限制与延期工作

- **仅本地进程** — 远程仓库 adapter 延期到其它 provider。
- **窄变更能力** — 它绝不 commit、push、解决 conflict、deploy runtime 变更或暴露任意 command surface。
