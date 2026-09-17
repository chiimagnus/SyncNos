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

ChatGPT uses **page capture** by default. Advanced capture is optional and can be enabled under **Settings → General → ChatGPT Advanced capture**.

It is not a “more complete” mode. It uses a different source:

|  | Default page capture | Advanced capture |
| --- | --- | --- |
| Reads from | Content currently loaded and rendered in the page | The current conversation branch saved by ChatGPT |
| Best for | Preserving expanded thinking and progress shown in the page | Stable branch and message identity, especially in long conversations |
| Main limitation | Content that has not been loaded or expanded may be missed | ChatGPT may no longer retain all thinking or progress that was previously shown in the page |

If preserving the **most complete thinking process** matters more, leave Advanced capture off and expand the thinking you want to keep before saving.

If preserving a **stable conversation structure and current branch** matters more, enable Advanced capture. Citations are converted into readable links, and rich widgets such as charts keep only useful long-term text.

A reply that is still generating can be saved as a partial result and updated by saving again after it finishes. If Advanced capture fails, SyncNos does not silently switch to page capture; turn it off and save again instead.

If the page has no capturable messages yet, SyncNos shows “waiting for messages” instead of treating it as an error.

## Images and local reuse

AI conversation images can be cached locally. Turning automatic image caching off does not prevent the text from being saved.

After saving, you can also use [$ Mention](/docs/en/dollar-mention/) to insert local items into supported AI inputs.
