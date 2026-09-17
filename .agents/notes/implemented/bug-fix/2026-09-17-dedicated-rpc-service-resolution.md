# Agent Note: Dedicated RPC service resolution

Status: implemented

English | [中文](2026-09-17-dedicated-rpc-service-resolution.zh.md)

## Problem

Dedicated RPC registration fails with `cannot get property "webServer" without inject` when a consumer and the Web server are sibling plugins. Cordis traces the caller for effect ownership but checks property access through the Connection service's construction context. Connection only requires credentials; its optional Web injection is a child context. Adding `webServer` to the consumer does not grant it to that construction context. Root-context tests bypass this dependency walk and conceal the failure.

## Decision

Connection resolves the active optional server through `owner.get('webServer')` before registering the route through `owner.effect()`. Missing Web service produces an explicit error. Authentication and request validation remain in the existing route handler; shared carrier-neutral registries do not acquire a Web dependency.

## Alternatives considered

**Require Web service on Connection.** This prevents non-Web compositions from using shared registries.

**Require Web service only on the consumer.** The reproduced failure persists because the property lookup checks Connection's construction context.

## Consequences

Dedicated channels work from plugin-owned contexts and retain caller-owned disposal. The sibling-plugin regression covers consumers with and without explicit Web injection, and the serverless case preserves shared registration while rejecting a dedicated channel. No Cordis checks are disabled.
