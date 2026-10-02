---
title: Privacy & data
description: Understand local storage, network use, and credentials in Backups.
---

See the full policy in [PRIVACY.md](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md).

## Local first

Captured content is saved in the browser first. You can capture, read, search, export, and back up without connecting an external service.

## When SyncNos uses the network

SyncNos contacts external services only for features you use, such as sync, ChatGPT Advanced capture, and image retrieval. Obsidian sync uses a Local REST API on the same computer.

## Credentials and Backup

Authentication credentials stay in extension-local storage and are not written into ordinary captured content or normal Backups.

Only **Settings → Backup → Include private data (for migration)** adds portable credentials to a Full Backup. Full Backups are not additionally encrypted, so protect them carefully.

See [Export & backup](/docs/en/export-backup/) for Backup behavior.

Browser access permissions let SyncNos capture pages you choose and contact services you configure; broad page access does not mean content is uploaded by default.
