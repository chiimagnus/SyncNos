---
title: Capture AI conversations
description: Save supported AI chats and understand manual capture, auto-save, and ChatGPT Advanced capture.
---

## Supported platforms

| Platform | Save method |
| --- | --- |
| ChatGPT | Manual |
| Gemini | Can auto-save |
| Google AI Studio | Manual |
| DeepSeek | Can auto-save |
| Kimi | Can auto-save |
| Doubao | Can auto-save |
| Yuanbao | Can auto-save |
| Poe | Can auto-save |
| Notion AI | Can auto-save |
| z.ai | Can auto-save |

ChatGPT and Google AI Studio use virtualized lists, so the full history may not exist in the page at once. They are therefore excluded from auto-save.

## Manual capture

1. Open the conversation and switch to the thread you want to save.
2. Choose **Capture AI chat** in the SyncNos popup, or use the context-menu action to save the current AI conversation.
3. Return to the [local library](/docs/en/library/) and confirm the conversation and messages.

For platforms that support auto-save, enable it under **Settings → General → Auto save**.

## ChatGPT Advanced capture

Under **Settings → General → ChatGPT Advanced capture**, manual save treats ChatGPT's current backend branch as the canonical history. Citations are converted into readable Markdown links, while rich widgets such as charts keep only durable titles and descriptions instead of leaking ChatGPT's internal transport markup or component payloads.

If the current turn is still reasoning or generating, reasoning summaries, progress text, and the visible reply are preserved as an awaiting-confirmation partial result when they have stable turn identity. Saving again after generation finishes reconciles that provisional content with the backend final reply instead of leaving a duplicate temporary message.

If Advanced capture fails, the same save does not silently fall back to full-page DOM capture. Turn the setting off and save again to use the default page path.

When a supported chat surface is recognized but has no capturable messages yet, the popup shows a neutral “waiting for messages” state instead of treating it as a capture error. Partial saves also distinguish reasons such as unconfirmed history and a still-changing live reply.

## Images and local reuse

AI conversation images can be cached locally. Turning automatic image caching off does not prevent the text from being saved.

After saving, you can also use [$ Mention](/docs/en/dollar-mention/) to insert local items into supported AI inputs.
