---
description: Generate a PNG image directly through Zentrola
---

Use the `imagegen` skill to turn the request below into a complete image prompt, call the Zentrola MCP `generate_image` tool, and return the generated PNG. Preserve requested style, composition, dimensions, text, background, and transparency. Use the default model unless the user explicitly requests another one. Respond in the user's current language, and never expose or ask the user to paste an endpoint or Access Key.

User request: $ARGUMENTS
