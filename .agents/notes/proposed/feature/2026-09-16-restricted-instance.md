# Agent Note: Administrator-owned restricted instance

Status: proposed

English | [中文](2026-09-16-restricted-instance.zh.md)

## Problem

A shared browser must not give its users the host process's authority over credentials, plugins, model routing, or arbitrary host files. The ordinary workspace-write policy limits writes but allows reads. Hiding controls cannot protect direct Remote calls.

## Proposal

The fork's implementation reads `DSH_INSTANCE_POLICY` before project environment files or profiles. The Linux-only JSON file and its ancestors must be canonical, root-owned, and not writable by group or others. Invalid configuration stops launch. The immutable policy pins workspace, model, preset, optional reasoning effort and output limit. The launch `DSH_HOME` must be explicitly protected. Restricted launches ignore project `.env`; ordinary launches retain their existing behavior.

Remote dispatch uses a deny-by-default operation list before Agent activation. Session owners reject execution controls, and model dispatch and sandbox owners enforce the administrator's values independently. Settings writes, credential writes, OAuth UI, plugin administration, slash commands, Cordis and workflow execution are unavailable. Subagent execution and continuation are disabled in this first implementation because external providers do not all inherit the same OS restrictions.

Shell and fixed filesystem workers use full Landlock with explicit read grants and a clean environment. The filesystem worker delegates to LocalFileSystem inside the child; lexical checks alone are not the security mechanism. Content-addressed attachments stay in private storage. A separate confined publisher streams verified attachment bytes to workspace copies; later requests can restore these copies from the original IDs.

The browser receives immutable capabilities in its boot manifest. It retains navigation and the flat conversation list, hides administrative controls, and shows the fixed model. `DSH_MAINTENANCE_AUTH=1` in the inherited launch environment selects an ephemeral browser signing secret without replacing ordinary browser credentials. Deployment must stop the user service and hold the same profile lock during maintenance.

## Alternatives considered

**UI controls only.** Direct requests and agent tools would retain administrative powers.

**Path validation in the host process.** Symlink replacement between validation and open would retain access to credentials. The OS must reject the actual child syscall.

**Grant attachment storage to shell.** This would extend general file access into state. Only verified IDs are read by the host, then copied into the user's workspace.

## Acceptance criteria

The implementation is not installed on the user service. Acceptance requires ordinary-mode regression, real Linux denials, keyless built snapshots and browser flows, followed by Sol, token refresh, OV read-only access, restart, maintenance and rollback on a separately published build. Existing session history must remain byte-for-byte intact; new request records must describe the effective model and sandbox policy.

## Risks

This is a shared workspace, not per-user isolation. Network destination limits and resource quotas are outside scope. Read grants must exclude every credential and state root. Trusted administrative plugins still execute in the main process. Workspace attachment copies are user-writable; they are not the durable originals. No release is accepted while the required integration checks remain incomplete.
