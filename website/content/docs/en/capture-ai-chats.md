---
title: Capture AI chats
description: Save AI chats with manual capture, auto-save, or ChatGPT Advanced capture.
---

## Supported platforms

| Platform | Capture |
| --- | --- |
| Claude, Gemini, DeepSeek, Doubao, Kimi, Yuanbao, Poe, Notion AI, z.ai | Manual and auto-save |
| ChatGPT, Google AI Studio, Grok | Manual only |

## Save a conversation

1. Open the conversation.
2. Choose **Fetch AI Chat** in the popup, or use the in-page button, context menu, or a configured shortcut.
3. Check the result in the [local library](/docs/en/library/).

On supported platforms, enable **Settings → General → Auto-save** to save new messages.
To retrieve older history, run a manual capture.

Long chats may not be captured in full, but an incomplete capture will not overwrite
previously saved history. Keep long Grok conversations in the foreground and wait
for the reply to finish before capturing.
Some Notion AI attachment details may be unavailable.

Control image caching under **Settings → General → Auto-save AI chat images locally**.
Disabling it does not prevent text from being saved.

## ChatGPT Advanced capture

Normal capture mainly saves messages available from the current page.
To retrieve older messages, enable **Settings → General → ChatGPT Advanced capture**.

You must be signed in to ChatGPT. Shared links and temporary chats are not supported.
Advanced capture tries to retrieve older messages, including available reasoning summaries
and charts. Content ChatGPT does not provide cannot be recovered.

If capture is interrupted, previously saved content remains available. Check your sign-in and retry.
