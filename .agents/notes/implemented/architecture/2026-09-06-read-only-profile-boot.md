# Agent Note: Read-only profile boot

Status: implemented

English | [中文](2026-09-06-read-only-profile-boot.zh.md)

## Problem

A restricted systemd deployment can keep session-state paths writable while making `$DSH_HOME/profiles` deployment-owned and non-writable. Ordinary profile boot repairs the module fallback, initializes templates, normalizes one shipped manifest tuple, rewrites `cordis.yml`, and starts patch watchers, so it cannot safely boot that deployment tree.

## Decision

`dsh --profile <name> --profile-read-only` and `dsh web --profile-read-only` select an explicit profile-boot mode. It reads the selected profile without initialization or normalization, verifies every installation fallback link, requires the profile manifest, profile patch, and exact compiled root `cordis.yml`, then disables profile-patch watching. The mode never heals, creates, rewrites, renames, or relinks paths under `$DSH_HOME/profiles`. A missing or divergent materialized asset fails before boot with a stable instruction to run once without the flag.

The flag remains launcher-owned and applies only to profile boot. It does not add a profile selector, workspace override, capability layer, or plugin-management behavior.

## Alternatives considered

**Rely on filesystem permissions.** A failed write after normal boot begins could leave partial initialization or a less useful operating-system error, and it would not stop silent behavior such as template creation or manifest normalization.

**Reuse the writable boot path and skip only `cordis.yml` regeneration.** The module-fallback healer and shipped-profile normalization also write under the profile tree, so this would not meet the deployment constraint.

**Accept any existing root config.** The root is a compiled empty profile base whose exact content prevents persisted Loader rows from being mounted twice; accepting a divergent file would revive the writable path's corruption defense without repairing it.

## Consequences

Operators materialize a profile with an ordinary writable boot before switching to the restricted service account. Session persistence continues to use its separately writable paths. A runtime installation change that changes the expected fallback closure causes a safe startup failure until the deployment materializes matching links.

Focused profile tests cover absent and inconsistent fallback links and read-only profile assets. CLI argument tests cover both spellings and reject config-dump use. Built-bin acceptance boots a materialized non-writable profile and proves missing compiled assets fail closed.
