# Zentrola Marketplace

English | [简体中文](./README.zh-CN.md)

The Zentrola marketplace for plugins and skills. It currently contains its first plugin, `zusage`, which queries the current Zentrola user's token usage for the current month and the corresponding reporting period.

## Client entry points

| Client | How to invoke after installation |
| --- | --- |
| Claude Code | `/zusage` |
| Codex | `$zusage`, or select “Zentrola Usage” from `/skills` |

Custom prompt slash commands have been deprecated in Codex, and regular skills cannot register a real `/zusage` command. Codex therefore uses the native skill syntax `$zusage`. For Claude Code, `commands/zusage.md` provides the `/zusage` wrapper. Both clients share the same `skills/zusage/SKILL.md` file.

## Directory structure

```text
.
├── LICENSE.txt                           # Apache License 2.0
├── .agents/plugins/marketplace.json     # Codex Marketplace
├── .claude-plugin/marketplace.json      # Claude Plugin Marketplace
└── plugins/zusage
    ├── plugin.json                       # Portable Codex/OpenAI plugin manifest
    ├── mcp.json                          # Codex MCP launcher (--client=codex)
    ├── .mcp.json                         # Claude MCP launcher (--client=claude)
    ├── .codex-plugin/plugin.json
    ├── .claude-plugin/plugin.json
    ├── commands/zusage.md                # Claude /zusage command
    ├── scripts/zusage-mcp.mjs            # Calls Zentrola using live client gateway configuration
    └── skills/zusage
        ├── SKILL.md                      # Skill shared by Codex and Claude
        └── agents/openai.yaml            # Codex display metadata
```

## Installation

Install the plugin from the GitHub repository.

Claude Code:

```text
/plugin marketplace add https://github.com/zentrola/zentrola-marketplace
/plugin install zusage@zentrola-marketplace
```

Codex CLI:

```text
codex plugin marketplace add zentrola/zentrola-marketplace
codex plugin add zusage@zentrola-marketplace
```

You can also add this GitHub Marketplace repository in the plugin management interface, then install “Zentrola Usage”. For internal enterprise distribution, an administrator can make the Marketplace available to the organization.

## Requirements

Codex and Claude Code use separate MCP manifests. Each manifest passes an explicit client argument to the shared server, which then rereads only that client's Zentrola gateway endpoint and Access Key. The server never infers the client from ambient environment markers, never falls through to the other client's configuration, and does not cache credentials:

- Codex: reads the active model provider's `base_url` from `~/.codex/config.toml`, then obtains its Access Key from the provider's configured environment variable or the file-backed `~/.codex/auth.json` credential store.
- Claude Code: reads `ANTHROPIC_BASE_URL` together with `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` from the current process environment or `~/.claude/settings.json`.
- Codex environment fallback: `OPENAI_BASE_URL` and `OPENAI_API_KEY`.

Users only configure Codex or Claude Code to use Zentrola as usual; `zusage` needs no separate endpoint or Access Key. A Codex invocation never reads Claude Code settings, and a Claude Code invocation never reads Codex settings. File-backed credential changes are picked up on the next query. Changes made only to the process environment still require restarting the corresponding client.

The local MCP runs with `node` resolved from the system `PATH` and requires Node.js 18 or later.

## Security

The MCP reads the gateway endpoint and Access Key only from the current client configuration and sends the key as a Bearer credential only to that endpoint. It never returns the key to the model, writes it to logs, or persists it in the plugin. Because `auth.json` contains plaintext credentials, continue to protect it like a password file.

Prefer HTTPS whenever the deployment supports it. If an IP-based or internal deployment must use HTTP, run it only over a trusted, protected network. Never commit real service credentials to the repository.

## License

Licensed under the [Apache License 2.0](./LICENSE.txt).
