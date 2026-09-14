---
title: Privacy and data flows
description: Local-first boundaries, optional external requests, credentials, and Backup exclusions.
---

This page is a user-facing summary. The complete and continuously maintained policy is [PRIVACY.md](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md).

## Local-first does not mean offline-only

Captured content is stored locally in the browser first. Whether any content is sent to an external service depends on features you configure or invoke.

SyncNos does not operate a SyncNos cloud relay for your clipped content, and your data is not sold.

## Features that use the network

- **Notion**: sends selected content to the Notion API; referenced images may be processed when needed.
- **Feishu**: sends selected content to Feishu APIs; OAuth can use Proxy or Direct mode.
- **GitHub**: uses GitHub App Device Flow and GitHub APIs to write repository content.
- **ChatGPT Advanced capture**: when explicitly enabled, uses the current signed-in ChatGPT session for a manual current-conversation capture and may resolve protected images.
- **Image caching**: may request the original site or CDN image URLs.
- **Obsidian**: normally talks to a Local REST API on the same computer, not a SyncNos cloud service.

Once data is sent to a third-party service, that service's own privacy policy applies.

## Credential storage

Provider tokens, API keys, client secrets, and other required credentials are stored in extension-local storage. Provider authorization mechanisms differ, but these authentication secrets are not written into ordinary captured content.

## Backup exclusions

Backup ZIP excludes authentication secrets such as provider access / refresh tokens, client secrets, the Obsidian API key, GitHub Device Flow credentials, and other sensitive authentication state.

## Remote code

Executable extension code is packaged with SyncNos. The extension does not download and execute remote code.

## Permissions

Browser host access is used to capture pages you request and to reach configured OAuth, sync, and image endpoints. Broad host access does not mean page content is uploaded by default.

For exact data flows, permissions, and credential boundaries, read the full [Privacy Policy](https://github.com/chiimagnus/SyncNos/blob/main/PRIVACY.md).
