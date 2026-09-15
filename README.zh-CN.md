# Zentrola Marketplace

[English](./README.md) | 简体中文

Zentrola Plugin 与 Skill Marketplace。当前包含第一个插件 `zusage`，用于查询当前 Zentrola 用户本月的 Token 使用量和统计起止时间。

## 客户端入口

| 客户端 | 安装后调用方式 |
| --- | --- |
| Claude Code | `/zusage` |
| Codex | `$zusage`，或先通过 `/skills` 选择“Zentrola Usage” |

Codex 的自定义 prompt slash command 已废弃，普通 Skill 不能注册真正的 `/zusage`；因此 Codex 使用原生 Skill 语法 `$zusage`。Claude 的 `commands/zusage.md` 提供 `/zusage` 包装层，两端共享同一份 `skills/zusage/SKILL.md`。

## 目录结构

```text
.
├── LICENSE.txt                           # Apache License 2.0
├── .agents/plugins/marketplace.json     # Codex Marketplace
├── .claude-plugin/marketplace.json      # Claude Plugin Marketplace
└── plugins/zusage
    ├── plugin.json                       # Codex/OpenAI portable Plugin 清单
    ├── mcp.json                          # Codex MCP 启动配置（--client=codex）
    ├── .mcp.json                         # Claude MCP 启动配置（--client=claude）
    ├── .codex-plugin/plugin.json
    ├── .claude-plugin/plugin.json
    ├── commands/zusage.md                # Claude /zusage
    ├── scripts/zusage-mcp.mjs            # 动态复用客户端网关配置调用 Zentrola
    └── skills/zusage
        ├── SKILL.md                      # Codex/Claude 共享 Skill
        └── agents/openai.yaml            # Codex 展示元数据
```

## 安装

从 GitHub 仓库安装插件。

Claude Code：

```text
/plugin marketplace add https://github.com/zentrola/zentrola-marketplace
/plugin install zusage@zentrola-marketplace
```

Codex CLI：

```text
codex plugin marketplace add zentrola/zentrola-marketplace
codex plugin add zusage@zentrola-marketplace
```

也可以在 Plugin 管理界面添加该 GitHub Marketplace 仓库，然后安装“Zentrola Usage”。企业内部分发时，可以由管理员将 Marketplace 配置为组织可用。

## 使用条件

Codex 与 Claude Code 使用各自独立的 MCP 清单，由清单向共享服务传入明确的客户端参数；服务随后只重新读取对应客户端的 Zentrola 网关地址和 Access Key。服务不会根据环境标记猜测客户端，不会回退到另一客户端的配置，也不会在 Plugin 中缓存凭据：

- Codex：读取 `~/.codex/config.toml` 中当前 Model Provider 的 `base_url`，并从该 Provider 指定的环境变量或文件凭据存储 `~/.codex/auth.json` 获取 Access Key。
- Claude Code：读取当前进程环境或 `~/.claude/settings.json` 中的 `ANTHROPIC_BASE_URL`，以及 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`。
- Codex 环境变量兜底：`OPENAI_BASE_URL` 与 `OPENAI_API_KEY`。

用户只需像平常一样将 Codex 或 Claude Code 配置为使用 Zentrola，不需要为 `zusage` 再配置地址或 Access Key。Codex 调用不会读取 Claude Code 配置，Claude Code 调用也不会读取 Codex 配置。更新文件凭据后，下一次查询会直接使用新值；更新仅存在于进程环境中的变量后，仍需重启对应客户端。

本地 MCP 通过系统 `PATH` 中的 `node` 启动，需要 Node.js 18 或更高版本。

## 安全说明

MCP 只从当前客户端配置中读取网关地址和 Access Key，并只将 Access Key 作为 Bearer 凭据发送到该地址。它不会把 Access Key 返回给模型、写入日志或持久化到 Plugin 中。由于 `auth.json` 包含明文凭据，应继续按照密码文件保护它。

部署条件允许时，建议优先使用 HTTPS。如果基于 IP 或内部网络的部署必须使用 HTTP，请确保通信只经过可信且受保护的网络。不要向仓库提交真实的服务凭据。

## 许可证

本项目采用 [Apache License 2.0](./LICENSE.txt)。
