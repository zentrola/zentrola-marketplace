---
name: provider
description: Query the current Zentrola service provider name for the user associated with the active Access Key. Use when the user asks which Zentrola provider or service provider is currently active, or explicitly invokes $zentrola:provider. Claude can trigger it through /zprovider.
---

# Query provider

Call the Zentrola MCP `get_provider` tool with no arguments. The tool requests `/api/v1/me/provider` using the active client's existing Zentrola endpoint and Access Key, then returns `data.name` as `providerName`. Report that name in the user's current language.

Report only `providerName` from the tool result. Do not expose or infer an endpoint, Access Key, credential source, or other configuration details.

If `get_provider` is unavailable, explain that the plugin's local MCP is not loaded and ask the user to restart the client after installing or updating the plugin. If configuration or authentication fails, ask the user to check the active client's existing Zentrola configuration. Never ask the user to paste a key into the conversation.
