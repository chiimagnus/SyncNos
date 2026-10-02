---
title: Export & backup
description: Export readable files or create a Backup that SyncNos can restore later.
---

- Need ordinary files: use **Markdown / JSON export**
- Need to restore or migrate SyncNos: use **Backup**
- Need continuous external updates: [use sync](/docs/en/sync/)

## Export

Select items in the local library and export a Markdown or JSON ZIP. Available local images are included; missing images do not block text export.

## Backup

Open **Settings → Backup** to create a recovery package.

A normal Backup contains recoverable local content and settings but excludes authentication credentials.

When moving to another device or browser profile, enable **Include private data (for migration)**. This adds portable sign-in credentials to the Backup; the option is off by default.

A Full Backup is not additionally encrypted by SyncNos. Protect it like a password file.

## Restore

Import merges Backup data into the current local library instead of clearing existing content first.
