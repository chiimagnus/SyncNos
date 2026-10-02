---
title: Capture AI chats
description: Save supported AI chats and understand manual capture, auto-save, and ChatGPT Advanced capture.
---

## Supported platforms

| Platform | Capture |
| --- | --- |
| ChatGPT, Claude, Google AI Studio | Manual |
| Gemini, DeepSeek, Kimi, Doubao, Yuanbao, Poe, Notion AI, z.ai | Auto-save available |

Manual-only platforms use virtualized histories, so the whole conversation is not always present in the page at once.

## Manual capture

1. Open the target conversation.
2. Choose **Capture AI chat** in the popup, or save the current chat from the context menu.
3. Confirm the result in the [local library](/docs/en/library/).

For supported platforms, enable auto-save under **Settings → General → Auto save**.

## ChatGPT Advanced capture

ChatGPT uses page capture by default. **Settings → General → ChatGPT Advanced capture** enables an alternative manual capture path.

- **Page capture**: best when you want content already loaded or expanded in the page.
- **Advanced capture**: better for stable current-branch identity and long conversations, but it cannot recover thinking/progress that ChatGPT did not keep.

Advanced capture does not silently fall back to page capture. Disable it and save again if you want the page path.

## Images and reuse

Image caching can be disabled without blocking text capture.

Saved items can also be inserted into supported AI editors with [$ insert](/docs/en/dollar-mention/).
