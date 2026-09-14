---
title: Export & backup
description: Choose a Markdown / JSON export, or create a Backup ZIP that can restore SyncNos.
---

Export and Backup solve different problems: **exports are for people and other tools; Backup is for restoring SyncNos itself.**

| Need | Use |
| --- | --- |
| Keep readable files long-term or hand data to another tool | Markdown / JSON export |
| Restore SyncNos local content and recoverable state | Backup ZIP |
| Keep an external service continuously updated | [Sync to external services](/docs/en/sync/) |

## Export Markdown / JSON

Select content from the local library and export it as Markdown or JSON. The result is delivered as a ZIP containing files for the selected items.

Referenced images that are already cached locally are added to the ZIP when available. If a selected ChatGPT item still has an uncached image, SyncNos can try to retrieve that image at export time using your current ChatGPT session; this does not permanently add it to the local cache. If the image cannot be retrieved, the text still exports and that image is marked unavailable instead of leaking an internal reference.

Markdown is convenient for direct reading and continued writing. JSON is better for programmatic processing and preserves structured type, source, time, and attachment information.

## Create a Backup ZIP

Use **Settings → Backup** to export a recovery package. A Backup can contain:

- locally captured content;
- recoverable sync mappings;
- cached images;
- article comments / highlights;
- non-sensitive settings.

Authentication secrets are excluded, including provider access / refresh tokens, client secrets, the Obsidian API key, GitHub Device Flow credentials, and device / browser-profile-specific CLI identity or opt-in state.

## Restore a Backup

Backup import is a merge restore, not an unconditional wipe-and-replace. Re-importing the same Backup should remain idempotent instead of creating duplicate copies of the same data.

Backup is a SyncNos recovery format, not a permanently stable general archive format. Old Backup schemas are not guaranteed to remain readable forever. For long-term readable data or interoperability with other software, prefer Markdown / JSON exports.

See [Privacy & data](/docs/en/privacy/) for the complete network and credential boundary.
