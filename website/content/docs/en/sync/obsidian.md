---
title: Obsidian
description: Write Markdown and local image attachments to a vault through Obsidian Local REST API.
---

SyncNos uses the **Local REST API** community plugin to write Markdown and local image attachments into an Obsidian vault.

## 1. Install Local REST API

In Obsidian Desktop, open **Settings → Community plugins**, install Adam Coddington's **Local REST API**, and enable it.

![Install the Obsidian Local REST API plugin](/assets/docs/obsidian/obsidian-install-plugin.png)

## 2. Enable the local HTTP server

SyncNos currently uses the plugin's local HTTP endpoint, not its HTTPS endpoint. Enable the Non-encrypted / Insecure HTTP server.

Default address:

```text
http://127.0.0.1:27123
```

Keep the listener on `127.0.0.1` / `localhost`. Do not bind it to `0.0.0.0` unless you intentionally want LAN access.

![Enable the local HTTP server](/assets/docs/obsidian/obsidian-enable-insecure-http.png)

## 3. Configure SyncNos

Copy the API Key from Local REST API, then open **SyncNos → Settings → Obsidian**:

- **Base URL**: usually `http://127.0.0.1:27123`
- **API Key**: the key copied from Obsidian
- **Auth Header**: usually `Authorization`

Click **Test** to verify the connection.

![Configure the API Key in SyncNos](/assets/docs/obsidian/obsidian-copy-api-key.png)

The API key is stored in extension-local storage and excluded from SyncNos Backup ZIP. After setup, you can sync manually or enable Obsidian auto-sync separately.

## Troubleshooting

For `Failed to fetch` or other network errors:

- make sure Obsidian is running;
- make sure Local REST API is enabled;
- make sure its local HTTP server is enabled;
- check the Base URL.

For `401` / `403` or authentication failures, copy the API key again and verify the Auth Header.
