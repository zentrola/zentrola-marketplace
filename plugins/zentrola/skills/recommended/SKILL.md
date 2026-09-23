---
name: recommended
description: Find a recommended third-party Skill or Plugin from the Zentrola catalog and provide its official repository, path, version, and client-specific installation guidance. Use when the user asks to install, find, add, or enable a recommended skill or plugin, including grill-me.
---

# Recommended third-party skills

Use this skill as a directory and shortcut. Zentrola does not copy or execute third-party code; the target client remains responsible for installing and loading the referenced Skill or Plugin.

## Workflow

1. Match the user's exact name or alias against `catalog/recommended-skills.json` shipped with this plugin.
2. If there is no match, say that the item is not in the Zentrola recommended catalog. Do not invent a repository or install an arbitrary URL.
3. If more than one item matches, show the candidates and ask the user to choose.
4. Show the matched item's repository, subdirectory, ref, supported clients, and description.
5. Give the client-specific next step using the official Codex or Claude Code installation flow. Do not claim that Zentrola installed the third-party code.
6. If the user only asks where the skill is, return the repository and path without suggesting that an installation already happened.

For `grill-me`, the catalog entry currently points to:

```text
repository: https://github.com/mattpocock/skills.git
path: skills/productivity/grill-me
ref: c55ee46073ed923f86ce59a5eb3b6d895095d1b7
```

The upstream repository is the source of truth for the Skill contents and any changes to its installation instructions.
