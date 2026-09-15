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

- The Codex and Claude Code MCP manifests pass different explicit client arguments to the shared server. On every `get_usage` call, the server resolves only the selected client's configuration and does not cache an endpoint or Access Key.
- For Codex, it reads the active provider from `config.toml` and obtains its key from the configured provider environment variable or file-backed `auth.json`.
- For Claude Code, it reads `ANTHROPIC_BASE_URL` with `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` from the current process environment or `settings.json`.
- Never fall back from Codex configuration to Claude Code configuration or from Claude Code configuration to Codex configuration.
- Never read, echo, or log API keys, tokens, Authorization headers, or other secrets.
- If `get_usage` is unavailable, explain in the user's current language that the plugin's local MCP is not loaded and ask them to restart the client after installing or updating the plugin.
- If the service returns an authentication error, ask the user to check whether their existing Zentrola Access Key has expired or been revoked. Never ask them to paste the key into the conversation.

## Output

- Respond in the user's current language. Do not show multiple languages unless the user explicitly requests them.
- Prefer the tool's `structuredContent` values over reproducing its fallback text verbatim.
- Use a compact table when formatting is helpful, with localized labels for token usage, reporting period start, and reporting cutoff.
