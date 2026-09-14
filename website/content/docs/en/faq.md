---
title: Troubleshooting & FAQ
description: Start here when capture, sync, or connection behavior is not working as expected.
---

## What if a capture is incomplete?

- **ChatGPT / Google AI Studio**: use manual save
- **ChatGPT Advanced capture fails**: turn Advanced capture off and save again
- **Images are missing**: the text is usually already saved; use **Cache images** later to retry
- **Another AI site does not auto-save**: confirm auto-save is enabled, then try one manual save

See [Capture content](/docs/en/capture/) for supported sources.

## What if a keyboard shortcut does not work?

Open **Settings → Keyboard shortcuts** and check the binding the browser is actually using. If it shows **Unassigned**, use **Manage shortcuts** to open the browser's native shortcut settings; when that cannot be opened directly, follow the page guidance and configure the binding in your browser's extension shortcut settings.

See [Browser keyboard shortcuts](/docs/en/capture/#browser-keyboard-shortcuts) for the three available actions and their support boundaries.

## What if sync fails?

A failed sync does not delete local content. Fix the connection or permissions, then sync again.

- [Notion](/docs/en/sync/notion/)
- [Obsidian](/docs/en/sync/obsidian/)
- [Feishu](/docs/en/sync/feishu/)
- [GitHub](/docs/en/sync/github/)

## Will the same item be duplicated on every sync?

Normally, no. SyncNos updates content it has already synced instead of creating a new copy every time.

If you are unsure whether a sync succeeded, check the destination before retrying.

## Can I use SyncNos without an external service?

Yes. Capture, reading, search, export, and Backup can all be used locally.

## Which browsers are supported?

Chrome / Chromium-based browsers, Microsoft Edge, and Firefox have store builds. Safari (macOS / iOS) can be built from source with Xcode.

See [Install](/docs/en/install/) for installation links.

## Is my content automatically uploaded?

No. Saving to the local library does not upload your content to a SyncNos server by itself.

SyncNos only contacts an external service when you use a feature that needs it, such as sync, Advanced capture, or image caching. See [Privacy & data](/docs/en/privacy/).

## Where do I find updates or report a problem?

- [GitHub Releases](https://github.com/chiimagnus/SyncNos/releases): release history
- [GitHub Issues](https://github.com/chiimagnus/SyncNos/issues): bugs and feature requests

When reporting a problem, include your browser, SyncNos version, reproduction steps, and error details without sensitive information.
