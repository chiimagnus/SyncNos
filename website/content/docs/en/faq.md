---
title: Troubleshooting & FAQ
description: Incomplete captures, failed syncs, connection errors, browser compatibility, and support links.
---

## What if a capture is incomplete?

For ChatGPT or Google AI Studio, use manual current-page capture. Both use virtualized lists, so older turns can be absent from the live DOM and are not treated as ordinary auto-save sources.

For another supported AI site that should auto-save, first confirm auto-save is enabled, then try one manual capture to check whether the current page can be parsed. See [Capture content](/docs/en/capture/) for the complete support matrix.

## What if sync fails?

A failed sync does not delete the original local content. Fix the destination's connection, permissions, or configuration, then retry.

- [Notion setup](/docs/en/sync/notion/)
- [Obsidian setup and `Failed to fetch` / `401` / `403` troubleshooting](/docs/en/sync/obsidian/)
- [Feishu OAuth / scope / DocX troubleshooting](/docs/en/sync/feishu/)
- [GitHub App / repository / branch setup](/docs/en/sync/github/)

## Will syncing the same item create endless duplicates?

Each provider maintains continuity / mapping information for later updates to previously synced content. Creating a brand-new duplicate on every click is not the intended normal behavior.

If an operation's outcome is unknown, do not hammer retry. Check the current local and remote state first.

## Can I use SyncNos without Notion or another provider?

Yes. Local capture, reading, search, export, and Backup do not depend on Notion or any other provider. You can also configure only one destination if that is all you need.

## Which browsers are supported?

Chrome / Chromium-based browsers, Microsoft Edge, and Firefox have store builds. Safari (macOS / iOS) can be built from source with Xcode. See [Install](/docs/en/install/).

## Is my content automatically uploaded?

Saving something to the local library does not automatically upload the whole library to a SyncNos server. External data flows come from features you configure or explicitly invoke, such as provider sync, ChatGPT Advanced capture, or image caching. See [Privacy & data](/docs/en/privacy/).

## Where do I find updates or report a problem?

- Release history: [GitHub Releases](https://github.com/chiimagnus/SyncNos/releases)
- Bugs and feature requests: [GitHub Issues](https://github.com/chiimagnus/SyncNos/issues)

When reporting a problem, include the browser, SyncNos version, reproduction steps, and error details that do not contain sensitive data.
