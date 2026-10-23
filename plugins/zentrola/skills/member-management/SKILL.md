---
name: member-management
description: List groups, create ordinary Zentrola members, issue ordinary member Virtual Keys, or enable and disable ordinary members through an individually authorized Access Key when the user explicitly requests those actions.
---

# Manage ordinary members

These Zentrola MCP tools require that the active Access Key has been individually granted member management permission. They act on ordinary members across the whole Zentrola instance, but never on the caller or on members holding management permission.

- `list_groups` lists active groups, newest first. Pass `nextCursor` as `after` to read more pages.
- `create_member` creates an ordinary member with an active first Key. Provide a member name, first Key name, and at least one group ID. Call `list_groups` first and let the user choose the groups; do not guess group IDs. Member creation, group assignment, and first-Key issuance commit together.
- `issue_member_key` issues an ordinary Key for an existing member ID. It never changes member status: a disabled member returns `MEMBER_DISABLED`. Enable the member with `set_member_status` first only when the user asks for that.
- `set_member_status` enables (`ACTIVE`) or disables (`DISABLED`) an ordinary member. Disabling immediately blocks all of that member's Keys without revoking them, and enabling restores them. Enabling requires at least one valid Key (`MEMBER_ACCESS_KEY_REQUIRED` otherwise).

Never use these tools to create an administrator or to grant management or upstream-quota permission to a newly issued Key. A new Key is ordinary and its full value is returned only once. Give the full Key only to the requesting user, advise them to store it securely, and do not repeat it in subsequent messages. If a write request times out, check whether the operation completed before retrying; a retry can create another member or Key. Do not call a write tool based on an ambiguous request, and confirm the member before disabling it.
