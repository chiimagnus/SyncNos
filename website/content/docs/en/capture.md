---
title: Capture
description: Supported AI chats, web articles, and video transcripts, including manual and automatic capture boundaries.
---

## AI conversations

Current supported AI sites are:

| Platform | Default capture model |
| --- | --- |
| ChatGPT | Manual capture |
| Gemini | Auto-save capable |
| Google AI Studio | Manual capture |
| DeepSeek | Auto-save capable |
| Kimi | Auto-save capable |
| Doubao | Auto-save capable |
| Yuanbao | Auto-save capable |
| Poe | Auto-save capable |
| Notion AI | Auto-save capable |
| z.ai | Auto-save capable |

**ChatGPT and Google AI Studio use virtualized lists.** Older turns can be unmounted outside the viewport, so SyncNos deliberately excludes them from ordinary auto-save and prepares a complete capture only when you explicitly save.

ChatGPT also has an optional **Advanced capture** mode. When explicitly enabled, a manual capture can use the current signed-in ChatGPT session to request the current conversation. This does not turn into background polling or automatic ChatGPT capture.

## Web articles

Article capture is user-initiated. SyncNos attempts to extract the main content plus useful metadata such as title, URL, author, and publication time, then stores a Markdown-oriented representation locally.

Image caching is optional. Failure to download an image does not block saving the text; configured anti-hotlink rules can adjust the Referer header for selected image hosts.

## Video transcripts

On YouTube and Bilibili, SyncNos can capture **already-loaded subtitles / transcripts**, preserving timing information when the source provides it.

Availability depends on data actually loaded by the page. SyncNos does not promise to generate a transcript when the page has no transcript data available.

## After capture

Captured content goes into the browser-local database first. From there you can:

- read, search, and manage it in SyncNos;
- add quotes and comments to articles;
- [sync to an external provider](/docs/en/sync/);
- export Markdown / JSON;
- create a restorable Backup ZIP.
