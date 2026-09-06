# Agent Note: Read-only profile boot

Status: implemented

[English](2026-09-06-read-only-profile-boot.md) | 中文

## Problem

受限的 systemd 部署可以让会话状态路径保持可写，同时将 `$DSH_HOME/profiles` 交给部署方并设为进程用户不可写。普通 profile 启动会修复模块后备、初始化模板、规范化一个随附 manifest 元组、重写 `cordis.yml` 并启动 patch watcher，因此无法安全启动该部署树。

## Decision

`dsh --profile <name> --profile-read-only` 与 `dsh web --profile-read-only` 选择显式的 profile 启动模式。它读取选中的 profile 而不初始化或规范化，验证每个安装后备链接，要求 profile manifest、profile patch 和内容精确的已编译根 `cordis.yml`，并禁用 profile patch 监视。该模式绝不修复、创建、重写、重命名或重建 `$DSH_HOME/profiles` 下的链接。缺失或不一致的已物化资产会在启动前失败，并稳定地提示用户先在没有该 flag 的情况下运行一次。

该 flag 仍由启动器拥有，只适用于 profile 启动。它不增加 profile 选择器、workspace 覆盖、能力层或插件管理行为。

## Alternatives considered

**依赖文件系统权限。** 正常启动开始后才发生的写入失败可能留下部分初始化或不够有用的操作系统错误，也不会阻止模板创建或 manifest 规范化等静默行为。

**复用可写启动路径，只跳过 `cordis.yml` 再生成。** 模块后备修复器和随附 profile 规范化同样会写入 profile 树，因此不能满足部署约束。

**接受任何现有根配置。** 根配置是已编译的空 profile 基础，其精确内容可避免持久化的 Loader 行被重复挂载；接受不一致文件会重新引入可写路径的损坏防御，却不进行修复。

## Consequences

运维人员在切换到受限服务账户前，先通过一次普通可写启动来物化 profile。会话持久化继续使用其单独可写的路径。运行时安装发生变化并改变预期后备闭包时，启动会安全失败，直到部署物化匹配的链接。

聚焦的 profile 测试覆盖缺失与不一致的后备链接以及只读 profile 资产。CLI 参数测试覆盖两种拼写并拒绝配置 dump 使用。构建后 bin 的验收会启动一个已物化的不可写 profile，并证明缺失的已编译资产会安全失败。
