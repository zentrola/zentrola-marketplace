# Zentrola Marketplace

English | [简体中文](./README.zh-CN.md)

The Zentrola marketplace for plugins and skills. It currently contains the `zentrola` plugin, whose skills query token usage, the current Zentrola service provider, and recommended third-party skills.

## Client entry points

| Client | How to invoke after installation |
| --- | --- |
| Claude Code | `/usage` for usage; `/provider gpt-5.6-sol` for the provider |
| Codex | `$zentrola:usage` or `$zentrola:provider gpt-5.6-sol` |

Custom prompt slash commands have been deprecated in Codex, and regular skills cannot register custom slash commands. Codex therefore uses the namespaced native skill syntax `$zentrola:usage` and `$zentrola:provider`. Claude Code uses `/usage` and `/provider` wrappers. Both clients use the same skills packaged by the plugin.

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
    ├── commands/usage.md                 # Claude /usage command
    ├── commands/provider.md              # Claude /provider command
    ├── scripts/zentrola-mcp.mjs          # Shared Zentrola MCP server
    ├── skills
    │   ├── usage                         # Token usage workflow
    │   │   ├── SKILL.md
    │   │   └── agents/openai.yaml
    │   ├── provider                      # Provider lookup workflow
    │   │   ├── SKILL.md
    │   │   └── agents/openai.yaml
    │   └── recommended                   # Third-party Skill directory shortcut
    │       └── SKILL.md
    └── catalog
        └── recommended-skills.json       # Third-party source metadata only
```

## Recommended third-party skills

The `recommended` Skill is a directory and shortcut, not a package manager. It matches a
name or alias in `plugins/zentrola/catalog/recommended-skills.json` and tells the client
where the upstream Skill or Plugin lives. Zentrola does not copy or execute third-party
code; Codex or Claude Code remains responsible for the actual installation and loading
flow.

For example, `grill-me` is currently registered as:

```text
repository: https://github.com/mattpocock/skills.git
path: skills/productivity/grill-me
ref: main
```

Ask for `grill-me` after installing the Zentrola plugin to receive the source location
and the client-specific next step.

## Developing plugins and skills

This repository also serves as a starter template for new plugins and skills. Use
`plugins/zentrola` as the reference implementation and keep each plugin self-contained
under `plugins/<plugin-name>/`.

- `plugin.json` is the portable plugin manifest. Update the client-specific manifests in
  `.codex-plugin/plugin.json` and `.claude-plugin/plugin.json` whenever the plugin name,
  version, description, or client-facing metadata changes; client-specific version formats
  may differ when required by that client.
- Add a skill under `skills/<skill-name>/SKILL.md`. The YAML front matter must include
  the skill `name` and a precise `description`; add `agents/openai.yaml` when the skill
  needs Codex-specific metadata.
- Put Claude Code slash-command wrappers in `commands/`. Codex invokes namespaced
  skills such as `$plugin-name:skill-name` and does not use custom slash commands.
- Put shared MCP or other runtime code in `scripts/`, and use `mcp.json` for Codex and
  `.mcp.json` for Claude Code when the clients need different launch arguments.
- Register every new plugin in both `.agents/plugins/marketplace.json` and
  `.claude-plugin/marketplace.json` so it is discoverable by both clients.

When adding a plugin, copy the `plugins/zentrola` layout, replace its name, version,
description, manifests, commands, skills, and tests, then remove files that are not
needed. Keep credentials out of source, prompts, fixtures, and logs. Add runtime tests
under `plugins/<plugin-name>/tests/` and run them with Node's built-in test runner, for
example:

```text
node --test plugins/<plugin-name>/tests/*.test.mjs
```

Update this README and `README.zh-CN.md` when the marketplace layout or client
installation behavior changes.

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
