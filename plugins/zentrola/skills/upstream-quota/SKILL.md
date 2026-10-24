---
name: upstream-quota
description: Query the quota of the provider subscription accounts reachable by the active Zentrola Access Key, for example OpenAI quota. Requires that the Key has been individually granted permission.
---

# Provider subscription quota

Call the Zentrola MCP `get_upstream_quota` tool. Do not ask for or pass a model: quota belongs to the provider subscription account, not to a model. When the user names a provider, such as OpenAI or Anthropic, pass it as `provider`; otherwise omit it to list every account.

The tool returns one entry per subscription account in a single request, so do not split the query per account. Zentrola serves snapshots younger than 5 minutes as is and refreshes older accounts from the upstream on demand; do not call the tool repeatedly to force a refresh. Report every returned account separately, headed by provider and subscription name. For each quota window, state the window length, the remaining percentage, and the reset time in the user's local time, for example "7-day window · 99% remaining · resets 2026-10-30 10:45". Use the device-local times from the tool text; keep UTC only if the user asks.

`KNOWN` is a current quota. `STALE` means the refresh failed, is cooling down, or timed out: report the previous values together with the last checked time and the refresh error code, and say they may be outdated. Treat `UNKNOWN` as unknown; do not infer zero or availability, and pass on the refresh error code when present. State the last checked time when present. If no account matches the provider, say so. If the Key lacks permission, explain that an administrator must grant this Key the upstream quota viewing permission. Never expose or request the Access Key.
