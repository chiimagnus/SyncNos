# Obsidian Local REST API Setup

**English** | [中文](./LocalRestAPI.zh.md)

SyncNos writes Markdown and local image attachments to an Obsidian vault through the **Local REST API** community plugin.

## 1. Install Local REST API

In Obsidian Desktop, open **Settings → Community plugins**, install **Local REST API** by Adam Coddington, and enable it.

![Install Obsidian Local REST API plugin](./assets/obsidian-install-plugin.png)

## 2. Enable the local HTTP server

SyncNos currently uses the plugin's local HTTP endpoint, not its HTTPS endpoint. Enable the plugin's non-encrypted/insecure HTTP server.

The default SyncNos URL is:

```text
http://127.0.0.1:27123
```

Keep the service bound to `127.0.0.1` / `localhost`. Do not expose it on `0.0.0.0` unless you intentionally want the API reachable from the local network.

![Enable the local HTTP server](./assets/obsidian-enable-insecure-http.png)

## 3. Configure SyncNos

Copy the API Key from the Local REST API plugin, then open **SyncNos → Settings → Obsidian** and set:

- **Base URL:** normally `http://127.0.0.1:27123`
- **API Key:** the key from Obsidian
- **Auth Header:** normally `Authorization`

Click **Test** to verify the connection.

![Configure the API key in SyncNos](./assets/obsidian-copy-api-key.png)

The API Key stays in extension-local storage and is excluded from SyncNos Backup ZIP files. Manual sync is available after setup; auto-sync can be enabled separately.

## Troubleshooting

For `Failed to fetch` or another network error, verify that Obsidian is running, Local REST API is enabled, the local HTTP server is enabled, and the Base URL is correct.

For `401` / `403` or `authenticated false`, copy the API Key again and verify the Auth Header.
