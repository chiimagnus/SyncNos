---
title: Troubleshooting & FAQ
description: Start here when capture, sync, or connection does not work as expected.
---

## Capture is incomplete

- AI chat history is missing: run one manual capture; auto-save does not scroll the page to backfill older messages.
- Auto-save did not run: confirm **Settings → General → Auto-save** is enabled.
- ChatGPT Advanced capture fails: disable Advanced capture and save again.
- Images are missing: the text is usually already saved; retry with **Cache images** later.

See [Capture AI chats](/docs/en/capture-ai-chats/) for platform support.

## A keyboard shortcut does not work

Open **Settings → Keyboard shortcuts** and check the browser's current binding. If it is unassigned, configure it in the browser's extension shortcut settings.

## Sync fails

Local content remains safe. Fix the destination connection or permission and retry: [Notion](/docs/en/sync/notion/), [Obsidian](/docs/en/sync/obsidian/), [Feishu](/docs/en/sync/feishu/), or [GitHub](/docs/en/sync/github/).

## Can I use SyncNos without an external service?

Yes. Capture, reading, search, export, and Backup can all stay local.

## Which browsers are supported?

Chrome/Chromium-family browsers, Edge, and Firefox have store builds. Safari (macOS / iOS) can be built from source with Xcode. See [Install](/docs/en/install/).

## Is content uploaded automatically?

No. SyncNos contacts external services only when you use a feature that needs them. See [Privacy & data](/docs/en/privacy/).

## Updates and feedback

- [GitHub Releases](https://github.com/chiimagnus/SyncNos/releases)
- [GitHub Issues](https://github.com/chiimagnus/SyncNos/issues)
