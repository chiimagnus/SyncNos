---
title: Sync targets
description: Sync local SyncNos content to Notion, Obsidian, Feishu, or GitHub.
---

All SyncNos providers derive from the same local data. A provider is an output target, not the primary database.

## Supported targets

| Provider | Best for | Connection |
| --- | --- | --- |
| [Notion](/docs/en/sync/notion/) | Database-oriented archives and Notion pages | OAuth |
| [Obsidian](/docs/en/sync/obsidian/) | Local Markdown vaults | Local REST API |
| [Feishu](/docs/en/sync/feishu/) | Feishu DocX / Drive | OAuth (Proxy or Direct) |
| [GitHub](/docs/en/sync/github/) | Markdown repositories and Git workflows | GitHub App Device Flow |

Providers can be enabled independently, and auto-sync can be configured separately for each one. Manual and automatic sync use the same provider orchestration path.

## Sync is not export

Sync updates a configured external target. Export writes local Markdown / JSON files. Backup ZIP is a separate recovery package for local data and restorable state.

If portable files are all you need, you do not have to configure a provider.

## Network boundary

Once a provider is connected, content selected for sync is sent to that service. See [Privacy and data flows](/docs/en/privacy/) for credentials, network requests, and backup exclusions.
