# Agent Note: 独立 RPC 服务解析

Status: implemented

[English](2026-09-17-dedicated-rpc-service-resolution.md) | 中文

## 问题

当调用方与 Web 服务器是同级插件时，独立 RPC 注册会报错 `cannot get property "webServer" without inject`。Cordis 跟踪调用方以确定副作用的归属，但通过 Connection 服务的构造上下文检查属性访问。Connection 仅要求凭据服务；其可选 Web 注入位于子上下文中。给调用方添加 `webServer` 并不会将其授予该构造上下文。根上下文测试绕过此依赖查找，因此掩盖了故障。

## 决策

Connection 通过 `owner.get('webServer')` 解析活动的可选服务器，再通过 `owner.effect()` 注册路由。缺少 Web 服务时返回明确错误。身份验证与请求校验仍由原有路由处理程序负责；共享的传输无关注册表不增加 Web 依赖。

## 考虑过的替代方案

**要求 Connection 依赖 Web 服务。** 这会阻止非 Web 组合使用共享注册表。

**仅要求调用方依赖 Web 服务。** 已复现的故障仍然存在，因为属性查找检查的是 Connection 的构造上下文。

## 影响

独立通道可以从插件所属的上下文中注册，并保留调用方负责的清理。同级插件回归测试覆盖显式注入和未注入 Web 服务的调用方；无服务器场景保留共享注册，同时拒绝独立通道。没有禁用任何 Cordis 检查。
