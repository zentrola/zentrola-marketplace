---
name: provider
description: Query the Zentrola service provider name for a model using the active Access Key. Use when the user asks which provider serves a model, asks for the current model's provider, or explicitly invokes $zentrola:provider. Claude can trigger it through /provider.
---

# Query provider

Determine the model identifier before calling the Zentrola MCP `get_provider` tool. Use an explicitly requested model exactly as provided. Otherwise use the current model identifier exposed by the client runtime; if it cannot be determined reliably, ask the user to specify the model instead of guessing.

Pass the model as `model`. The tool requests `/api/v1/me/provider?model=<model>` using the active client's existing Zentrola endpoint and Access Key, then returns the service response's `data.name` as `name`. Report that name in the user's current language.

Report only `name` from the tool result. Do not expose or infer an endpoint, Access Key, credential source, or other configuration details.

If `get_provider` is unavailable, explain that the plugin's local MCP is not loaded and ask the user to restart the client after installing or updating the plugin. If configuration or authentication fails, ask the user to check the active client's existing Zentrola configuration. Never ask the user to paste a key into the conversation.
