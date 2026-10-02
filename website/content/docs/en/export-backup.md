---
title: Export & backup
description: Export readable files or create a Backup that can later restore SyncNos.
---

- Want files you can keep or use in other tools: choose **Markdown / JSON export**
- Want to restore SyncNos later: create a **Backup**
- Want Notion, Obsidian, Feishu, or GitHub to stay updated: [use sync](/docs/en/sync/)

## Export Markdown / JSON

Select content in your local library and export it as Markdown or JSON. The result is packaged as a ZIP.

- **Markdown**: best for reading, editing, and writing
- **JSON**: best for programmatic use and structured data

Available local images are included. If an image cannot be retrieved, the text still exports normally.

## Create a Backup

Open **Settings → Backup** to create a recovery package.

A Backup stores recoverable local data such as captured content, cached images, comments and highlights, and settings.

By default, authentication secrets are excluded. When moving SyncNos to another device or browser profile, enable **Include private data (for migration)**. The resulting Full Backup also stores portable long-lived credentials such as OAuth tokens, API keys, and client secrets, and restores them during import.

This option is off by default every time and is not remembered. A Full Backup is **not additionally encrypted by SyncNos**; anyone who obtains the ZIP may be able to use the credentials inside it, so protect it like a password file.

Transient OAuth / Device Flow state and device-specific CLI identity are still excluded from Full Backup.

## Restore a Backup

Importing a Backup merges it into your current local library instead of clearing your existing data first.

Backup is primarily for restoring SyncNos. For long-term readable data, keep Markdown / JSON exports as well.
