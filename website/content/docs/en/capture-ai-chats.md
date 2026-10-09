---
title: Capture AI chats
description: Save supported AI chats and understand manual capture, auto-save, and ChatGPT Advanced capture.
---

## Supported platforms

| Platform | Capture |
| --- | --- |
| Claude, Gemini, DeepSeek, Doubao, Kimi, Yuanbao, Poe, Notion AI, z.ai | Manual + auto-save |
| ChatGPT, Google AI Studio | Manual |
| Grok | Manual; no auto-save support |

Manual capture actively retrieves the history that the current site can safely verify. For virtualized lists, paginated histories, or unfinished replies, SyncNos merges conservatively instead of replacing a complete local history with the currently visible window.

## Manual capture

1. Open the target conversation.
2. Choose **Fetch AI Chat** in the popup, or **Save current AI chat** from the context menu.
3. Confirm the result in the [local library](/docs/en/library/).

Platforms listed with auto-save can enable it under **Settings → General → Auto-save**. Auto-save only appends or updates messages that can be identified safely in the current window; it does not scroll the page to backfill older history. Use manual capture when you want SyncNos to retrieve long-chat history.

Long Grok conversations may not load fully in background tabs. Keep the conversation tab in the foreground and save manually after the reply finishes.

Notion AI file messages are saved conservatively; some attachment details may be unavailable.

## ChatGPT Advanced capture

ChatGPT uses page capture by default. **Settings → General → ChatGPT Advanced capture** enables an alternative manual capture path.

- **Page capture**: saves the conversation from the current page and loads older history when needed.
- **Advanced capture**: better for long conversations and the current branch, but it cannot recover reasoning or generation progress that ChatGPT did not keep.

Advanced capture does not silently fall back to page capture. Disable it and save again if you want the page path.

## Images and reuse

Supported platforms preserve conversation images and recognizable attachments where available. Image caching can be disabled without blocking text capture.

Saved items can also be inserted into supported AI editors with [$ insert](/docs/en/dollar-mention/).
