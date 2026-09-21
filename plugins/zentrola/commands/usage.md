---
description: Query the current Zentrola user's token usage for this month or a date range
---

Use the `usage` skill to interpret the request below, call the Zentrola MCP `get_usage` tool, and return the current user's token usage and reporting period. If the request does not specify a range, query the default current month. Report only data actually returned by the tool, respond in the user's current language, and never ask the user to paste an endpoint or Access Key.

User request: $ARGUMENTS
