---
description: Query the current configured Zentrola service provider name
---

Use the `provider` skill to interpret the request below, determine the explicitly requested model or the current model exposed by the client, call the Zentrola MCP `get_provider` tool with that model, and return only the service provider name reported by Zentrola. If the model cannot be determined reliably, ask the user to specify it. Respond in the user's current language, and never expose or ask the user to paste an endpoint or Access Key.

User request: $ARGUMENTS
