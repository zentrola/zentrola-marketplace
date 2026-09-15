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
    ├── .mcp.json                         # Codex/Claude 共享本地 MCP
    ├── .codex-plugin/plugin.json
    ├── .claude-plugin/plugin.json
    ├── commands/zusage.md                # Claude /zusage
    ├── scripts/zusage-mcp.mjs            # 复用客户端环境调用 Zentrola
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

Plugin 的本地 MCP 会复用客户端进程继承到的第一组完整 Zentrola 兼容环境变量：

- OpenAI 兼容配置：`OPENAI_BASE_URL` 与 `OPENAI_API_KEY`
- Anthropic 兼容配置：`ANTHROPIC_BASE_URL` 与 `ANTHROPIC_API_KEY`

两组变量都完整时，优先使用 `OPENAI_*`。只要其中一组已经指向 Zentrola，就不需要为 `zusage` 单独配置地址或 Access Key。请确保客户端进程能够继承这些变量；修改变量后需要重启客户端。

本地 MCP 通过系统 `PATH` 中的 `node` 启动，需要 Node.js 18 或更高版本。

## 安全说明

MCP 仅从客户端继承的环境变量中读取 Access Key，并只将其作为 Bearer 凭据发送到配置的 Zentrola 地址。它不会把 Access Key 返回给模型或写入日志。

部署条件允许时，建议优先使用 HTTPS。如果基于 IP 或内部网络的部署必须使用 HTTP，请确保通信只经过可信且受保护的网络。不要向仓库提交真实的服务凭据。

## 许可证

本项目采用 [Apache License 2.0](./LICENSE.txt)。
