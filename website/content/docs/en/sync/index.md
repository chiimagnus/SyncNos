---
title: Sync overview
description: Choose Notion, Obsidian, Feishu, or GitHub, then decide between manual and automatic sync.
---

Sync is optional. Even with no external service connected, SyncNos can capture, read, search, export, and back up content locally.

## Choose a destination

| Destination | Good for | Connection |
| --- | --- | --- |
| [Notion](/docs/en/sync/notion/) | Database-style archive and Notion pages | OAuth |
| [Obsidian](/docs/en/sync/obsidian/) | Local Markdown vault | Local REST API |
| [Feishu](/docs/en/sync/feishu/) | Feishu DocX / cloud documents | OAuth (Proxy or Direct) |
| [GitHub](/docs/en/sync/github/) | Markdown repositories and Git workflows | GitHub App Device Flow |

You can configure only one destination or several. Each destination has its own enablement and configuration.

## Manual and automatic sync

Every external destination supports manual sync and can enable automatic sync independently. Both modes use the same provider sync flow; automatic sync changes when work starts, not which system owns your data.

## Sync, export, and backup are different

- **Sync** keeps a configured external service updated.
- **Markdown / JSON export** creates local files you can carry and read elsewhere.
- **Backup ZIP** stores data intended to restore SyncNos local state.

If all you need is a file, you do not need to configure a sync destination. See [Export & backup](/docs/en/export-backup/).

## When sync fails

Your local content remains available. Fix the destination's connection, permissions, or configuration, then retry the sync.

Open the destination-specific page for setup and troubleshooting. See [Privacy & data](/docs/en/privacy/) for network, credential, and authorization boundaries.
