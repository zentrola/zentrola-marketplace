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
    ├── .mcp.json                         # Shared local MCP for Codex and Claude
    ├── .codex-plugin/plugin.json
    ├── .claude-plugin/plugin.json
    ├── commands/zusage.md                # Claude /zusage command
    ├── scripts/zusage-mcp.mjs            # Calls Zentrola using the client's environment
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

The plugin's local MCP reuses the first complete Zentrola-compatible environment variable pair inherited by the client process:

- OpenAI-compatible configuration: `OPENAI_BASE_URL` and `OPENAI_API_KEY`
- Anthropic-compatible configuration: `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`

When both pairs are complete, the `OPENAI_*` pair takes precedence. No additional `zusage`-specific endpoint or Access Key is required when either pair already points to Zentrola. Ensure the client process inherits the variables, and restart the client after changing them.

The local MCP runs with `node` resolved from the system `PATH` and requires Node.js 18 or later.

## Security

The MCP reads the Access Key only from the inherited environment and sends it as a Bearer credential only to the configured Zentrola endpoint. It never returns the key to the model or writes it to logs.

Prefer HTTPS whenever the deployment supports it. If an IP-based or internal deployment must use HTTP, run it only over a trusted, protected network. Never commit real service credentials to the repository.

## License

Licensed under the [Apache License 2.0](./LICENSE.txt).
