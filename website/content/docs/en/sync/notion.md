---
title: Notion
description: Connect Notion over OAuth and let SyncNos manage content under a selected parent page.
---

## Connect Notion

1. Open **SyncNos → Settings → Notion**.
2. Click **Connect** and complete Notion OAuth.
3. Select the **Parent Page** that SyncNos should use.
4. Run a manual sync; enable auto-sync separately if you want it.

SyncNos can only access content that you explicitly make available to the Notion integration.

## Parent page and managed databases

Under the selected parent page, SyncNos finds or creates the databases it manages for AI chats, web articles, and video content.

Their managed properties and sections are owned by SyncNos. Normal setup does not require manually creating or editing that schema.

When you change the parent page, SyncNos resolves the destination again instead of blindly continuing to use cached database IDs from the previous parent.

## OAuth and credentials

Notion OAuth uses a token-exchange proxy so the official client secret is not embedded in the browser extension. The proxy handles OAuth exchange data; it does not receive the conversation, article, or video bodies you sync.

The Notion token is stored in extension-local storage and excluded from SyncNos Backup ZIP files.

## Revoke access

- **Disconnect** in SyncNos clears the extension's local Notion connection state.
- To revoke authorization on the Notion side, remove SyncNos from Notion's connection settings.

## Failed syncs

The local database remains the primary record. Notion API, image-upload, or page-write failures do not replace the local source with remote state; fix the connection and sync again.
