# Agent Note: Anonymous entry for a restricted HTTPS instance

Status: implemented

English | [中文](2026-09-17-public-restricted-web.zh.md)

## Problem

A shared public UI must open without distributing an administrator launch token while retaining server-side operation restrictions and the existing private maintenance flow.

## Decision

Only the immutable root-owned restricted policy can supply `publicOrigin`. Connection bootstraps the existing authority-bound signed cookie at that HTTPS authority and marks it Secure, HttpOnly and SameSite=Strict. API and WebSocket calls still require authentication and the restricted policy. Exact public Host and Origin checks reject scheme changes, extra ports, foreign origins and forwarded-header spoofing. Loopback retains its token exchange. Ephemeral maintenance disables anonymous bootstrap.

## Alternatives considered

Removing authentication globally would also weaken administrative and maintenance profiles. Injecting a launch token at the reverse proxy would move a service credential into routing configuration. Per-user accounts would change the agreed shared-history product.

## Consequences

Public visitors share all user history and workspace files. The cookie is a browser transport boundary, not a personal identity or a quota. TLS termination belongs to a trusted loopback proxy; requests cannot opt into public mode. A new policy field requires rebuilding every artifact that embeds the parser. The Linux full-composition fixture verifies bootstrap, RPC, WebSocket, files, mock replies and restart without real credentials.
