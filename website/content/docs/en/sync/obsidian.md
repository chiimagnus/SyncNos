---
title: Obsidian
description: Sync SyncNos content into your Obsidian vault.
---

SyncNos writes content through the Obsidian **Local REST API** plugin.

## 1. Install the plugin

In Obsidian Desktop, open **Settings → Community plugins**, then install and enable **Local REST API**.

![Install the Obsidian Local REST API plugin](/assets/docs/obsidian/obsidian-install-plugin.png)

## 2. Enable local HTTP

In Local REST API settings, enable **Non-encrypted / Insecure HTTP server**.

The default address is:

```text
http://127.0.0.1:27123
```

Keep the address on `127.0.0.1` or `localhost`. Do not expose it to your local network.

![Enable the local HTTP server](/assets/docs/obsidian/obsidian-enable-insecure-http.png)

## 3. Connect SyncNos

Copy the Local REST API **API Key**, then open **SyncNos → Settings → Obsidian**:

- **Base URL**: usually keep `http://127.0.0.1:27123`
- **API Key**: paste the key you copied
- **Auth Header**: keep the default `Authorization`

Click **Test**. Once connected, sync manually or enable automatic sync.

![Configure the API Key in SyncNos](/assets/docs/obsidian/obsidian-copy-api-key.png)

## When something fails

- `Failed to fetch`: make sure Obsidian is running, the plugin and local HTTP server are enabled, and the Base URL is correct
- `401` / `403`: copy the API Key again and confirm the Auth Header is `Authorization`
