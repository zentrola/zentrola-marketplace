---
name: imagegen
description: Generate PNG images through Zentrola using the active Access Key. Use when the user asks to create, draw, render, or generate an image, or explicitly invokes $zentrola:imagegen. Claude can trigger it through /imagegen.
---

# Generate an image

Use the Zentrola MCP `generate_image` tool to create the image requested by the user.

1. Turn the user's request into one complete `prompt`. Preserve all requested subjects, style, composition, dimensions, text, and background or transparency requirements. Do not add incompatible creative details.
2. Call `generate_image` with that `prompt`. Omit `model` to use `gpt-5.6-sol` unless the user explicitly requests another Zentrola model.
3. Return the image content produced by the tool. Briefly state the model only when it is useful to the user.

The MCP calls Zentrola's `/v1/responses` endpoint directly with `stream: true`, `store: false`, and the `image_generation` tool. It reads the SSE stream and returns the final PNG as MCP image content.

If the tool is unavailable, explain in the user's current language that the plugin's local MCP is not loaded and ask them to restart the client after installing or updating the plugin. For configuration or authentication failures, ask them to check the active client's existing Zentrola configuration. Never ask the user to paste an endpoint or Access Key into the conversation.
