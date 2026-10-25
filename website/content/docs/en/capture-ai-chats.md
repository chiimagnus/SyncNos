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
2. Use **Fetch AI Chat** in the popup, the in-page floating icon, the context menu, or a configured capture shortcut.
3. The in-page icon bounces during capture and displays a result or error bubble afterward; the popup still shows textual progress. Verify the saved content in the [local library](/docs/en/library/).

Platforms listed with auto-save can enable it under **Settings → General → Auto-save**. Auto-save only appends or updates messages that can be identified safely in the current window; it does not scroll the page to backfill older history. Use manual capture when you want SyncNos to retrieve long-chat history.

Long Grok conversations may not load fully in background tabs. Keep the conversation tab in the foreground and save manually after the reply finishes.

Notion AI file messages are saved conservatively; some attachment details may be unavailable.

## ChatGPT Advanced capture

ChatGPT saves messages from the current page by default. For longer history, enable **Settings → General → ChatGPT Advanced capture**. You must be signed in to ChatGPT; shared links and temporary chats are not supported.

- **Page capture**: attempts to load accessible older messages but cannot guarantee the full history. Previously saved messages are not deleted.
- **Advanced capture**: fetches history page by page, preserving recognizable reasoning summaries, generation progress, charts, and other content when ChatGPT provides them. Content ChatGPT no longer exposes cannot be recovered.

If capture stops partway through, already saved messages remain. Unfinished replies or ambiguous branches do not overwrite existing history. Check your sign-in and retry after a failure. Advanced capture does not silently switch to page capture; disabling it uses the page path, which may still miss older messages.

## Images and reuse

Supported platforms preserve conversation images and recognizable attachments where available. Image caching can be disabled without blocking text capture.

Saved items can also be inserted into supported AI editors with [$ insert](/docs/en/dollar-mention/).
