---
name: upstream-quota
description: Query the saved quota snapshot for the subscription most recently used by the active Zentrola Access Key for a specified model. Requires that the Key has been individually granted permission.
---

# Current subscription quota

Determine the exact model identifier, then call the Zentrola MCP `get_upstream_quota` tool with `model`. The service authorizes the individual Access Key and returns only its most recently used subscription for that model. Treat `UNKNOWN` as unknown; do not infer zero or availability. State the `checkedAt` time when present, and make clear the result is a saved snapshot, not a live upstream probe. If the Key lacks permission, explain that an administrator must grant this Key the upstream quota viewing permission. Never expose or request the Access Key.
