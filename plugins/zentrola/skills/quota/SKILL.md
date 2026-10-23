---
name: quota
description: Query the current-month Zentrola token quota and usage for the active Access Key. Use when the user asks for their monthly limit, remaining tokens, or model-specific effective quota.
---

# My Token quota

Call the Zentrola MCP `get_quota` tool. Omit `model` for this month's all-model usage and personal limit. Supply the exact model identifier when the user asks how many tokens they can still use for one model; the service calculates the minimum remaining amount across personal and applicable group limits. A null limit or remaining value means unlimited, not zero. Report the UTC reporting month and do not claim that this balance guarantees a successful upstream request. Respond in the user's language. Never expose or request the Access Key.
