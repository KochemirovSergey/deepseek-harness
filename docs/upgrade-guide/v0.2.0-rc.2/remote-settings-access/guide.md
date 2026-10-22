---
kind: upgrade-guide
description: "Remote browser settings now use authenticated Host permissions instead of hostname-based memory-only preferences."
---
# Remote settings access

English | [中文](guide.zh.md)

## Change

Remote Web pages no longer disable Host settings solely because the browser uses an external hostname. They check `settings.access()` before loading settings. When allowed, preferences such as Coding Tools and the preview-notice acknowledgement persist in the connected instance, just as they do for loopback Web and Desktop. Explicit memory-mode consumers remain process-local.

Client and Host must both support the new access method. An unsupported method refuses settings access instead of falling back to a hostname check. Restricted instances retain their server-side write prohibitions. Deployment authentication and role-based routing remain responsible for selecting the administrative or isolated user instance; the new method does not assign account roles.

## Migration

1. Update the Host and browser bundles together; do not deploy only the settings UI bundle onto an older Host.
2. Preserve browser authentication, origin checks, deployment role routing, and restricted-instance policy. Do not expose an unauthenticated internal Host port to make settings work.
3. Reload the browser, sign in through the existing deployment entry, and open Settings → Models. Confirm that settings load for the permitted instance and that a harmless preference persists after reload. Previously process-local remote preferences are not migrated; choose them again if needed.
4. Confirm that unauthenticated requests and restricted-instance writes remain refused. No settings-file or Session-data migration is required.
