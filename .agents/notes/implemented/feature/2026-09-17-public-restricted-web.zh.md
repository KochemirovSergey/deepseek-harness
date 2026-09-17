# Agent Note: 受限 HTTPS 实例的匿名入口

Status: implemented

[English](2026-09-17-public-restricted-web.md) | 中文

## Problem

共享公开界面必须无需分发管理员启动 token 即可打开，同时保留服务端操作限制和现有私有维护流程。

## Decision

只有 root 拥有的不可变受限策略可以提供 `publicOrigin`。Connection 在该 HTTPS authority 自动签发既有的 authority 绑定签名 cookie，并设置 Secure、HttpOnly 和 SameSite=Strict。API 与 WebSocket 仍要求认证及受限策略。公开 Host 与 Origin 精确检查拒绝协议变更、额外端口、外部 origin 和 forwarded 标头伪造。Loopback 保留 token 交换，临时维护禁用匿名入口。

## Alternatives considered

全局移除认证会削弱管理员和维护 profile。在反向代理中注入启动 token 会把服务凭据放进路由配置。独立用户账号会改变已约定的共享历史产品。

## Consequences

公开访客共享全部用户历史和 workspace 文件。Cookie 是浏览器传输边界，不是个人身份或配额。TLS 终止由可信 loopback 代理负责；请求不能自行启用公开模式。新策略字段要求重建所有嵌入解析器的产物。Linux 完整组合测试使用虚拟凭据验证入口、RPC、WebSocket、文件、模拟回复和重启。
