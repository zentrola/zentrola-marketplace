---
name: provider
description: Query the current Zentrola service provider name from the active Codex or Claude Code configuration. Use when the user asks which Zentrola provider, gateway, or service provider is currently configured, or explicitly invokes $zentrola:provider. Claude can trigger it through /zprovider.
---

# Query provider

Call the Zentrola MCP `get_provider` tool with no arguments and report the returned service provider name in the user's current language.

Report only `providerName` from the tool result. Do not expose or infer an endpoint, Access Key, credential source, or other configuration details.

If `get_provider` is unavailable, explain that the plugin's local MCP is not loaded and ask the user to restart the client after installing or updating the plugin. If configuration resolution fails, ask the user to check the active client's existing Zentrola configuration. Never ask the user to paste a key into the conversation.
