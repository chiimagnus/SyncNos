---
title: Capture AI chats
description: Save supported AI chats and understand manual capture, auto-save, and ChatGPT Advanced capture.
---

## Supported platforms

| Platform | Capture |
| --- | --- |
| Gemini, DeepSeek, Doubao, Yuanbao, Poe, Notion AI | Manual + auto-save |
| ChatGPT, Claude, Google AI Studio, Kimi, z.ai | Manual |

Manual capture actively retrieves the history that the current site can safely verify. For virtualized lists, paginated histories, or unfinished replies, SyncNos merges conservatively instead of replacing a complete local history with the currently visible window.

## Manual capture

1. Open the target conversation.
2. Choose **Capture AI chat** in the popup, or save the current chat from the context menu.
3. Confirm the result in the [local library](/docs/en/library/).

Platforms listed with auto-save can enable it under **Settings → General → Auto save**. Auto-save only appends or updates messages that can be identified safely in the current window; it does not scroll the page to backfill older history. Use manual capture when you want SyncNos to retrieve long-chat history.

Notion AI currently uses the `/chat` Agent Service conversation and its full transcript. Messages containing files are kept partial-safe; complete attachment metadata is not guaranteed yet.

## ChatGPT Advanced capture

ChatGPT uses page capture by default. **Settings → General → ChatGPT Advanced capture** enables an alternative manual capture path.

- **Page capture**: keeps visible page content and handles the page loading required for long conversations.
- **Advanced capture**: better for stable current-branch identity and long conversations, but it cannot recover thinking/progress that ChatGPT did not keep.

Advanced capture does not silently fall back to page capture. Disable it and save again if you want the page path.

## Images and reuse

Supported platforms preserve conversation images and recognizable attachments where available. Image caching can be disabled without blocking text capture.

Saved items can also be inserted into supported AI editors with [$ insert](/docs/en/dollar-mention/).
