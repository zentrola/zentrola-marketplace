---
description: List groups, create ordinary members, issue ordinary member Keys, or enable and disable ordinary members through an authorized Zentrola Key
---

Use the `member-management` skill and the Zentrola MCP `list_groups`, `create_member`, `issue_member_key`, or `set_member_status` tool for the user's explicit request. Creating a member requires at least one group chosen from `list_groups`. Use only member IDs the user stated or `create_member` returned; never guess an ID from a name, and confirm the ID before issuing a Key or changing status. Never retry a write automatically. Never create administrators. A resulting Key is returned once; present it only to the requesting user.

User request: $ARGUMENTS
