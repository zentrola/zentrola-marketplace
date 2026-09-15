# Zentrola Marketplace

[English](./README.md) | 简体中文

Zentrola Plugin 与 Skill Marketplace。当前包含 `zentrola` 插件，可查询 Token 使用量和当前 Zentrola 服务商。

## 客户端入口

| 客户端 | 安装后调用方式 |
| --- | --- |
| Claude Code | `/zusage` 查询用量；`/zprovider` 查询服务商 |
| Codex | `$zentrola:usage` 或 `$zentrola:provider` |

Codex 的自定义 prompt slash command 已废弃，普通 Skill 不能注册自定义 slash command；因此 Codex 使用带插件命名空间的原生 Skill 语法 `$zentrola:usage` 和 `$zentrola:provider`。Claude Code 保留 `/zusage` 和 `/zprovider` 包装层，两端使用插件中相同的 Skill。

默认不传参数时查询当前 UTC 自然月起至当前时刻。用户说出时间范围时，Skill 会将自然语言转换为 `from`（含）与 `to`（不含）两个以 `Z` 结尾的 UTC RFC3339 时间并调用接口；例如“查询 9 月 1 日到 9 月 15 日的用量”。日期范围最长 366 天。工具保留服务端返回的 UTC 原始时间，同时按运行插件的设备时区生成面向用户的起止时间。服务商查询调用 `/api/v1/me/provider`，并返回服务端提供的 `data.name`。

## 目录结构

```text
.
├── LICENSE.txt                           # Apache License 2.0
├── .agents/plugins/marketplace.json     # Codex Marketplace
├── .claude-plugin/marketplace.json      # Claude Plugin Marketplace
└── plugins/zentrola
    ├── plugin.json                       # Codex/OpenAI portable Plugin 清单
    ├── mcp.json                          # Codex MCP 启动配置（--client=codex）
    ├── .mcp.json                         # Claude MCP 启动配置（--client=claude）
    ├── .codex-plugin/plugin.json
    ├── .claude-plugin/plugin.json
    ├── commands/zusage.md                # Claude /zusage
    ├── commands/zprovider.md             # Claude /zprovider
    ├── scripts/zentrola-mcp.mjs          # 统一的 Zentrola MCP server
    └── skills
        ├── usage                         # Token 用量查询流程
        │   ├── SKILL.md
        │   └── agents/openai.yaml
        └── provider                      # 服务商查询流程
            ├── SKILL.md
            └── agents/openai.yaml
```

## 安装

从 GitHub 仓库安装插件。

Claude Code：

```text
/plugin marketplace add https://github.com/zentrola/zentrola-marketplace
/plugin install zentrola@zentrola-marketplace
```

Codex CLI：

```text
codex plugin marketplace add zentrola/zentrola-marketplace
codex plugin add zentrola@zentrola-marketplace
```

也可以在 Plugin 管理界面添加该 GitHub Marketplace 仓库，然后安装“Zentrola”。企业内部分发时，可以由管理员将 Marketplace 配置为组织可用。

## 使用条件

Codex 与 Claude Code 使用各自独立的 MCP 清单，由清单向共享服务传入明确的客户端参数；服务随后只重新读取对应客户端的 Zentrola 网关地址和 Access Key。服务不会根据环境标记猜测客户端，不会回退到另一客户端的配置，也不会在 Plugin 中缓存凭据：

- Codex：读取 `~/.codex/config.toml` 中当前 Model Provider 的 `base_url`，并从该 Provider 指定的环境变量或文件凭据存储 `~/.codex/auth.json` 获取 Access Key。
- Claude Code：读取当前进程环境或 `~/.claude/settings.json` 中的 `ANTHROPIC_BASE_URL`，以及 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`。
- Codex 环境变量兜底：`OPENAI_BASE_URL` 与 `OPENAI_API_KEY`。

用户只需像平常一样将 Codex 或 Claude Code 配置为使用 Zentrola，不需要为 `zentrola:usage` 再配置地址或 Access Key。Codex 调用不会读取 Claude Code 配置，Claude Code 调用也不会读取 Codex 配置。更新文件凭据后，下一次查询会直接使用新值；更新仅存在于进程环境中的变量后，仍需重启对应客户端。

本地 MCP 通过系统 `PATH` 中的 `node` 启动，需要 Node.js 18 或更高版本。

## 安全说明

MCP 只从当前客户端配置中读取网关地址和 Access Key，并只将 Access Key 作为 Bearer 凭据发送到该地址。它不会把 Access Key 返回给模型、写入日志或持久化到 Plugin 中。由于 `auth.json` 包含明文凭据，应继续按照密码文件保护它。

部署条件允许时，建议优先使用 HTTPS。如果基于 IP 或内部网络的部署必须使用 HTTP，请确保通信只经过可信且受保护的网络。不要向仓库提交真实的服务凭据。

## 许可证

本项目采用 [Apache License 2.0](./LICENSE.txt)。
