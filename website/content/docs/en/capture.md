---
title: Capture content
description: What SyncNos can save, and which sources should be captured manually or can auto-save.
---

## Capture modes at a glance

| Content | Default mode |
| --- | --- |
| AI conversations | Depends on the site: ChatGPT / Google AI Studio are manual; other supported sites can auto-save |
| Web articles | Manual capture |
| YouTube / Bilibili video content | Manual capture |

Regardless of source, captured content is written to the SyncNos local library first.

## AI conversations

Currently supported:

| Platform | Default capture mode |
| --- | --- |
| ChatGPT | Manual capture |
| Gemini | Can auto-save |
| Google AI Studio | Manual capture |
| DeepSeek | Can auto-save |
| Kimi | Can auto-save |
| Doubao | Can auto-save |
| Yuanbao | Can auto-save |
| Poe | Can auto-save |
| Notion AI | Can auto-save |
| z.ai | Can auto-save |

**ChatGPT and Google AI Studio use virtualized lists.** Older turns can be removed from the live DOM when they leave the viewport, so SyncNos does not treat them as ordinary auto-save sources. Manual capture performs the preparation needed for a complete capture.

ChatGPT also has optional **Advanced capture**. When explicitly enabled, manual capture can request the current conversation through the logged-in ChatGPT session. It still runs only when you save manually; it does not become background polling or automatic capture. If ChatGPT introduces an unfamiliar backend content shape, SyncNos keeps content it can safely assign to the conversation and marks the result partial. Identity or conversation-tree errors still fail instead of guessing. Advanced capture never silently falls back to DOM capture in the same save; turn it off and save again if you want the DOM path.

## Web articles

Web articles are captured manually. SyncNos tries to extract the readable body plus useful metadata such as title, URL, author, and publication time, then converts the result into Markdown suitable for local reading and export.

Some sites have dedicated handling. A failed image download does not make the text capture fail.

## Video content

YouTube and Bilibili video pages can be saved together with subtitles / transcripts that the page has already loaded. Timing information is preserved when the source provides it.

SyncNos does not generate missing subtitles and does not download audio or video streams. A supported video can still be saved as a Video even when no transcript is currently available.

## Image caching

AI conversations and web articles can cache images locally. Text is saved independently from image downloads, so an image failure does not turn a successful text capture into a failed save.

For ChatGPT, user-uploaded images and AI-generated images are treated as conversation content; ordinary tool screenshots and visual execution artifacts are not. With automatic AI image caching enabled, the conversation is saved first and images are cached afterward. With it disabled, uncached ChatGPT images can still be resolved on demand while your ChatGPT session allows access. Existing items can be localized later with **Cache images** in the detail More menu.

For web articles, the article image-cache setting controls normal image caching. A matching anti-hotlink rule can force an image-cache attempt with the required Referer.

Export and provider sync can also materialize an uncached ChatGPT image when needed without first making it part of the permanent local cache. See [Export & backup](/docs/en/export-backup/) and [Sync to external services](/docs/en/sync/).

## After capture

- Read, search, and manage content in your [local library](/docs/en/library/).
- Add highlights, comments, and replies to articles.
- [Sync to external services](/docs/en/sync/).
- [Export Markdown / JSON or create a backup](/docs/en/export-backup/).
