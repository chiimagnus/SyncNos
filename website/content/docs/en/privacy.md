---
title: Privacy & data
description: Learn where content is stored, when SyncNos uses the network, and how credentials and permissions are handled.
---

This page is a quick summary. See [PRIVACY.md](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md) for the complete policy.

## Content is local by default

Captured content is saved in your browser first.

You can capture, read, search, export, and back up content without connecting any external service.

## When SyncNos uses the network

SyncNos contacts an external service only when you enable or use a feature that needs it, for example:

- syncing to Notion, Feishu, or GitHub
- using the Obsidian Local REST API on the same computer
- enabling ChatGPT Advanced capture
- caching or retrieving images used by saved content

Once data is sent to a third party, that service's own privacy policy applies.

## Credentials and backups

Tokens, API keys, client secrets, and other credentials required by sync services are stored locally by the extension.

These authentication secrets are not written into ordinary captured content and are not included in SyncNos Backups.

See [Export & backup](/docs/en/export-backup/) for how backups work.

## Browser permissions

SyncNos needs access to pages you choose to capture and to sync, authorization, and image endpoints you configure or use.

Broad webpage access does not mean page content is uploaded by default.

The extension ships with its executable code and does not download and run remote code from the network.

For complete data-flow, permission, and credential details, read [PRIVACY.md](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md).
