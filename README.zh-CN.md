# Zentrola Marketplace

[English](./README.md) | 简体中文

Zentrola Plugin 与 Skill Marketplace。当前包含 `zentrola` 插件，可查询 Token 使用量、当前 Zentrola 服务商，并提供第三方 Skill 推荐入口。

## 客户端入口

| 客户端 | 安装后调用方式 |
| --- | --- |
| Claude Code | `/usage` 查询用量；`/provider gpt-5.6-sol` 查询服务商 |
| Codex | `$zentrola:usage` 或 `$zentrola:provider gpt-5.6-sol` |

Codex 的自定义 prompt slash command 已废弃，普通 Skill 不能注册自定义 slash command；因此 Codex 使用带插件命名空间的原生 Skill 语法 `$zentrola:usage` 和 `$zentrola:provider`。Claude Code 使用 `/usage` 和 `/provider` 包装层，两端使用插件中相同的 Skill。

默认不传参数时查询当前 UTC 自然月起至当前时刻。用户说出时间范围时，Skill 会将自然语言转换为 `from`（含）与 `to`（不含）两个以 `Z` 结尾的 UTC RFC3339 时间并调用接口；例如“查询 9 月 1 日到 9 月 15 日的用量”。日期范围最长 366 天。工具保留服务端返回的 UTC 原始时间，同时按运行插件的设备时区生成面向用户的起止时间。服务商查询调用 `/api/v1/me/provider?model=<model>`，并返回服务端提供的 `data.name`。

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
    ├── commands/usage.md                 # Claude /usage
    ├── commands/provider.md              # Claude /provider
    ├── scripts/zentrola-mcp.mjs          # 统一的 Zentrola MCP server
    ├── skills
    │   ├── usage                         # Token 用量查询流程
    │   │   ├── SKILL.md
    │   │   └── agents/openai.yaml
    │   ├── provider                      # 服务商查询流程
    │   │   ├── SKILL.md
    │   │   └── agents/openai.yaml
    │   └── recommended                   # 第三方 Skill 推荐入口
    │       └── SKILL.md
    └── catalog
        └── recommended-skills.json       # 仅保存第三方来源元数据
```

## 第三方 Skill 推荐

`recommended` Skill 是目录和快捷入口，不是包管理器。它会根据名称或别名读取
`plugins/zentrola/catalog/recommended-skills.json`，告诉客户端目标 Skill 或 Plugin
所在的上游仓库。Zentrola 不复制或执行第三方代码，实际安装和加载仍由 Codex 或
Claude Code 客户端完成。

例如，当前已登记 `grill-me`：

```text
repository: https://github.com/mattpocock/skills.git
path: skills/productivity/grill-me
ref: c55ee46073ed923f86ce59a5eb3b6d895d1b7
```

安装 Zentrola 插件后，用户可以直接说“找一下 grill-me”或“找一下压力测试方案”，
获得来源位置和对应客户端的下一步指引。

## 开发 Plugin 与 Skill

本仓库同时作为新增 Plugin 和 Skill 的开发样板。请参考 `plugins/zentrola`，并将
每个插件完整放在 `plugins/<plugin-name>/` 下，保持插件之间相互独立。

- `plugin.json` 是跨客户端的 Plugin 清单；`.codex-plugin/plugin.json` 与
  `.claude-plugin/plugin.json` 是客户端专用清单。插件名称、版本、说明或客户端展示信息变化
  时，应同步检查并更新对应清单；如果客户端要求不同的版本格式，可以保留格式差异。
- 在 `skills/<skill-name>/SKILL.md` 中新增 Skill。YAML front matter 必须包含 Skill 的
  `name` 和准确的 `description`；需要 Codex 专用元数据时，再添加
  `agents/openai.yaml`。
- `commands/` 用于 Claude Code 的 slash command 包装层。Codex 使用带插件命名空间的
  Skill 语法（例如 `$plugin-name:skill-name`），不使用自定义 slash command。
- 共享 MCP 或其他运行时代码放在 `scripts/`；客户端需要不同启动参数时，Codex 使用
  `mcp.json`，Claude Code 使用 `.mcp.json`。
- 新插件必须同时登记到 `.agents/plugins/marketplace.json` 和
  `.claude-plugin/marketplace.json`，这样两个客户端都能发现它。

新增插件时，可以复制 `plugins/zentrola` 的目录结构，再替换名称、版本、说明、清单、
commands、skills 和 tests，并删除不需要的文件。不要把凭据写入源码、prompt、测试数据
或日志。在 `plugins/<plugin-name>/tests/` 下补充运行时测试，并使用 Node 内置测试运行器
执行，例如：

```text
node --test plugins/<plugin-name>/tests/*.test.mjs
```

Marketplace 的目录结构或客户端安装行为发生变化时，请同步更新本文件和
`README.md`。

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
