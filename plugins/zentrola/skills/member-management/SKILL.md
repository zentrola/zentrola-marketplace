---
name: member-management
description: Create ordinary Zentrola members or issue ordinary member Virtual Keys through an individually authorized Access Key when the user explicitly requests those actions.
---

# Manage ordinary members

Use the Zentrola MCP `create_member` tool to create a new ordinary member. Provide a member name and first Key name; include group IDs only when specified or known. The operation creates the first Key and activates the member in one transaction. Use `issue_member_key` for an existing member ID. These tools require that the active Access Key has been individually granted member management permission.

Never use these tools to create an administrator or to grant management or upstream-quota permission to a newly issued Key. The new Key is ordinary and its full value is returned only once. Give the full Key only to the requesting user, advise them to store it securely, and do not repeat it in subsequent messages. If the request times out, check whether the operation completed before retrying; a retry can create another member or Key. Do not call a write tool based on an ambiguous request.
