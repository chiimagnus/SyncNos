---
title: Sync
description: Sync local content to Notion, Obsidian, Feishu, or GitHub.
---

Sync is optional; SyncNos works without any external service.

## Choose a destination

| Destination | Best for |
| --- | --- |
| [Notion](/docs/en/sync/notion/) | Databases and pages |
| [Obsidian](/docs/en/sync/obsidian/) | Local Markdown vaults |
| [Feishu](/docs/en/sync/feishu/) | Feishu cloud documents |
| [GitHub](/docs/en/sync/github/) | Markdown repositories |

Each destination supports manual sync and optional auto-sync. Local content stays in SyncNos.

Synced AI chats use one heading per message, including its number, role, and first sentence;
no AI-generated summaries are used. On the next sync, Obsidian regenerates its managed note
and GitHub updates the Markdown, while Notion uses the new headings only for newly appended
messages. Review any manual edits to synced notes before syncing.

Use [Export & backup](/docs/en/export-backup/) when you only need files or recovery.

A sync failure does not delete local content. Fix the connection or permission and retry.
