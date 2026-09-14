---
title: FAQ
description: Common answers about capture, sync, browser support, privacy, and reporting issues.
---

## Why is ChatGPT not an ordinary auto-save source?

ChatGPT uses a virtualized list, so older turns can be unmounted outside the viewport. SyncNos defaults to an explicit complete-capture path instead of treating partial DOM as a complete conversation. When Advanced capture is explicitly enabled, manual capture can use the verified current-conversation backend mapping.

Google AI Studio is also handled as manual complete capture because of its virtualized history.

## Will syncing the same item create endless duplicates?

Provider sync keeps continuity / mapping state for incremental updates. Exact remote behavior differs by provider, but repeatedly creating a fresh duplicate on every sync is not the normal model.

If a sync fails, local data remains available and can be synced again after fixing the provider configuration.

## Can I use SyncNos without Notion?

Yes. Local capture does not depend on Notion or any other provider. You can use local reading, search, export, and Backup without connecting anything externally.

## Can I use only Obsidian?

Yes. Install Obsidian Local REST API and follow the [Obsidian guide](/docs/en/sync/obsidian/).

## Which browsers are supported?

Chrome / Chromium-family browsers, Microsoft Edge, and Firefox have store builds. Safari (macOS / iOS) can be built from source with Xcode. See [Install](/docs/en/install/).

## Is my saved content automatically uploaded?

Local capture does not upload your entire library to a SyncNos server. External data flows come from features you configure or invoke, such as Notion, Feishu, GitHub, ChatGPT Advanced capture, or image caching. See [Privacy and data flows](/docs/en/privacy/).

## Where is the changelog?

[GitHub Releases](https://github.com/chiimagnus/SyncNos/releases) is the current release record. The Docs intentionally do not maintain a second changelog.

## How do I report a bug or request a feature?

Open a [GitHub Issue](https://github.com/chiimagnus/SyncNos/issues). Include your browser, SyncNos version, reproduction steps, and error details that do not contain sensitive data.
