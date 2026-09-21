---
name: usage
description: Query Zentrola token usage for the current month or a user-requested date range, including the reporting period, for the user associated with the active Access Key. Use when the user asks about Zentrola usage, asks how many tokens they used during a period, or explicitly invokes $zentrola:usage. Claude can trigger it through /usage.
---

# Query usage

Query the current Zentrola user's actual token usage for the current month or a requested time range.

## Workflow

1. Determine whether the user requested the default current month or an explicit time range.
2. Call the `get_usage` tool provided by the Zentrola MCP:
   - For the default current month, omit both `from` and `to` so the service uses its current UTC-month default.
   - For an explicit range, supply both `from` and `to` as UTC RFC3339 timestamps ending in `Z`. Offset forms such as `+08:00` are not accepted. `from` is inclusive and `to` is exclusive.
3. Resolve relative or natural-language dates using the user's current timezone and the current date supplied by the runtime. Convert both resulting instants to UTC RFC3339 values ending in `Z` before calling the tool.
   - Preserve explicit times exactly.
   - For a date-only range whose end date is intended to be included, set `to` to the start of the following day.
   - For a range ending at "now", use the current instant as `to`.
   - Do not send a range longer than 366 days. Ask for clarification when the requested boundaries cannot be resolved reliably.
4. Present the returned token usage, reporting period start, and reporting cutoff in the user's current language. Use `fromLocal`, `toLocal`, and `timezone` for display; keep the raw UTC `from` and `to` only for machine-readable processing or when the user explicitly asks for UTC.
5. Report only data actually returned by the tool. Do not add a quota, balance, cost, reset time, or assumptions about missing data.

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
