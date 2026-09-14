---
title: Privacy & data
description: Where content is stored by default, which features use the network, and how credentials and backups are handled.
---

This page is a user-facing summary. The complete and continuously maintained policy is [PRIVACY.md](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md).

## Where your content is stored by default

Captured content is saved locally in the browser first. SyncNos does not require uploading your local library to a SyncNos cloud content service before you can use it.

Whether content is sent to an external service depends on the features you explicitly configure or invoke.

## Features that use the network

- **Notion** sends content you choose to sync to the Notion API and may process referenced images when needed.
- **Feishu** sends content you choose to sync to the Feishu API; OAuth can use Proxy or Direct mode.
- **GitHub** authorizes through GitHub App Device Flow and writes repository content through the GitHub API.
- **ChatGPT Advanced capture** runs only when explicitly enabled and manually invoked for the current conversation.
- **Images** may be requested from their original sites / CDNs when you cache them. An uncached ChatGPT image may also be resolved temporarily when you view, export, or sync content that references it.
- **Obsidian** normally talks to a Local REST API on the same computer rather than a SyncNos cloud service.

Once a third-party service receives data, that service's own privacy policy applies.

## Credentials stay local

Required provider tokens, API keys, and client secrets are stored in browser-extension local storage. Authentication secrets are not written into ordinary captured content.

Backup ZIPs exclude those authentication secrets as well. See [Export & backup](/docs/en/export-backup/) for what a Backup contains and when to use one.

## Remote code

Executable extension code ships with SyncNos. The extension does not download and execute remote code from the network.

## Browser permissions

Browser host permissions allow capture on pages you request and access to configured OAuth, sync, and image endpoints. Broad host access does not mean page content is uploaded by default.

For exact data-flow, permission, and credential boundaries, read the full [Privacy Policy](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md).
