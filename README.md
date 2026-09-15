# Zentrola Marketplace

English | [简体中文](./README.zh-CN.md)

The Zentrola marketplace for plugins and skills. It currently contains the `zentrola` plugin, whose skills query token usage and the current Zentrola service provider.

## Client entry points

| Client | How to invoke after installation |
| --- | --- |
| Claude Code | `/zusage` for usage; `/zprovider gpt-5.6-sol` for the provider |
| Codex | `$zentrola:usage` or `$zentrola:provider gpt-5.6-sol` |

Custom prompt slash commands have been deprecated in Codex, and regular skills cannot register custom slash commands. Codex therefore uses the namespaced native skill syntax `$zentrola:usage` and `$zentrola:provider`. Claude Code keeps `/zusage` and `/zprovider` wrappers. Both clients use the same skills packaged by the plugin.

With no parameters, the plugin queries from the start of the current UTC calendar month through the current instant. When the user gives a time range in natural language, the skill converts it into UTC RFC3339 `from` (inclusive) and `to` (exclusive) values ending in `Z`; for example, “show usage from September 1 through September 15.” A custom range can span at most 366 days. The tool preserves the UTC values returned by the service and also formats the reporting period for the device time zone used to run the plugin. Provider queries call `/api/v1/me/provider?model=<model>` and return the service-provided `data.name` value.

## Directory structure

```text
.
├── LICENSE.txt                           # Apache License 2.0
├── .agents/plugins/marketplace.json     # Codex Marketplace
├── .claude-plugin/marketplace.json      # Claude Plugin Marketplace
└── plugins/zentrola
    ├── plugin.json                       # Portable Codex/OpenAI plugin manifest
    ├── mcp.json                          # Codex MCP launcher (--client=codex)
    ├── .mcp.json                         # Claude MCP launcher (--client=claude)
    ├── .codex-plugin/plugin.json
    ├── .claude-plugin/plugin.json
    ├── commands/zusage.md                # Claude /zusage command
    ├── commands/zprovider.md             # Claude /zprovider command
    ├── scripts/zentrola-mcp.mjs          # Shared Zentrola MCP server
    └── skills
        ├── usage                         # Token usage workflow
        │   ├── SKILL.md
        │   └── agents/openai.yaml
        └── provider                      # Provider lookup workflow
            ├── SKILL.md
            └── agents/openai.yaml
```

## Installation

Install the plugin from the GitHub repository.

Claude Code:

```text
/plugin marketplace add https://github.com/zentrola/zentrola-marketplace
/plugin install zentrola@zentrola-marketplace
```

Codex CLI:

```text
codex plugin marketplace add zentrola/zentrola-marketplace
codex plugin add zentrola@zentrola-marketplace
```

You can also add this GitHub Marketplace repository in the plugin management interface, then install “Zentrola”. For internal enterprise distribution, an administrator can make the Marketplace available to the organization.

## Requirements

Codex and Claude Code use separate MCP manifests. Each manifest passes an explicit client argument to the shared server, which then rereads only that client's Zentrola gateway endpoint and Access Key. The server never infers the client from ambient environment markers, never falls through to the other client's configuration, and does not cache credentials:

- Codex: reads the active model provider's `base_url` from `~/.codex/config.toml`, then obtains its Access Key from the provider's configured environment variable or the file-backed `~/.codex/auth.json` credential store.
- Claude Code: reads `ANTHROPIC_BASE_URL` together with `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` from the current process environment or `~/.claude/settings.json`.
- Codex environment fallback: `OPENAI_BASE_URL` and `OPENAI_API_KEY`.

Users only configure Codex or Claude Code to use Zentrola as usual; `zentrola:usage` needs no separate endpoint or Access Key. A Codex invocation never reads Claude Code settings, and a Claude Code invocation never reads Codex settings. File-backed credential changes are picked up on the next query. Changes made only to the process environment still require restarting the corresponding client.

The local MCP runs with `node` resolved from the system `PATH` and requires Node.js 18 or later.

## Security

The MCP reads the gateway endpoint and Access Key only from the current client configuration and sends the key as a Bearer credential only to that endpoint. It never returns the key to the model, writes it to logs, or persists it in the plugin. Because `auth.json` contains plaintext credentials, continue to protect it like a password file.

Prefer HTTPS whenever the deployment supports it. If an IP-based or internal deployment must use HTTP, run it only over a trusted, protected network. Never commit real service credentials to the repository.

## License

Licensed under the [Apache License 2.0](./LICENSE.txt).
