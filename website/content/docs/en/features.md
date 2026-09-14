---
title: Core features
description: Local-first storage, backup and restore, comments, image caching, Insight, $ Mention, and more.
---

## Local-first storage

Captured content is written to browser IndexedDB first. Sync providers and exported files are derived copies; they do not become a second SyncNos business database.

## Manual and automatic sync

Notion, Obsidian, Feishu, and GitHub use the same provider sync lifecycle for manual and automatic work. You can keep everything manual or enable auto-sync independently for the providers you need.

## Backup and restore

**Settings → Backup** exports and imports a recovery package. A Backup can include captured content, recoverable sync mappings, cached images, article comments, and non-sensitive settings.

Authentication secrets are excluded, including provider access / refresh tokens, client secrets, the Obsidian API key, and GitHub Device Flow credentials.

## Article comments

Saved web articles can carry quoted comments and replies. Comments are stored with local content and participate in Backup / Restore; supported providers can incorporate the relevant content into their sync output.

## `$` Mention

Type `$` in a supported AI chat input to search local saved items and insert the selected content as a Markdown snippet.

## Chat with AI

From saved content, Chat with AI copies content to the clipboard and opens the AI platform you configured. It does not silently submit a new AI message for you.

## Image caching

AI-chat and article images can be cached according to your settings. Anti-hotlink rules can adjust Referer while requesting selected image hosts. Image failures never block saving the text.

## Insight

Insight computes capture counts, source distributions, trends, and selected rankings from local data. It does not require uploading your library to a SyncNos service.

## Reading and display

SyncNos provides Markdown reading profiles and theme preferences. These change presentation, not the stored content itself.

## Local CLI

If local agents or automation need access to the running browser profile, explicitly enable the Native Messaging / CLI integration. See [Local CLI](/docs/en/cli/).
