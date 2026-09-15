---
name: zusage
description: Query the current-month Zentrola token usage and reporting period for the user associated with the active Access Key. Use when the user asks about Zentrola usage, asks how many tokens they have used, or explicitly invokes $zusage. Claude can trigger it through /zusage.
---

# Query usage

Query the current Zentrola user's actual token usage for the current month.

## Workflow

1. Call the `get_usage` tool provided by the Zentrola Usage MCP. The tool takes no arguments.
2. Present the returned token usage, reporting period start, and reporting cutoff in the user's current language.
3. Report only data actually returned by the tool. Do not add a quota, balance, cost, reset time, or assumptions about missing data.

## Authentication and fallback behavior

- The MCP reuses the `OPENAI_BASE_URL`/`OPENAI_API_KEY` or `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` environment already present when the client starts.
- Never read, echo, or log API keys, tokens, Authorization headers, or other secrets.
- If `get_usage` is unavailable, explain in the user's current language that the plugin's local MCP is not loaded. Ask them to ensure the client process inherits a complete Zentrola environment variable pair and to restart the client after changing those variables.
- If the service returns an authentication error, ask the user to check whether their existing Zentrola Access Key has expired or been revoked. Never ask them to paste the key into the conversation.

## Output

- Respond in the user's current language. Do not show multiple languages unless the user explicitly requests them.
- Prefer the tool's `structuredContent` values over reproducing its fallback text verbatim.
- Use a compact table when formatting is helpful, with localized labels for token usage, reporting period start, and reporting cutoff.
