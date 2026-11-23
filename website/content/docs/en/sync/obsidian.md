---
title: Obsidian
description: Sync content to Obsidian and choose where notes and images are stored.
---

SyncNos uses Obsidian's **Local REST API** plugin to save your captured AI chats, web articles, and video content in a local vault.

## 1. Install the plugin

In Obsidian Desktop, install and enable **Local REST API** under **Settings → Community plugins**.

![Install Obsidian Local REST API](/assets/docs/obsidian/obsidian-install-plugin.png)

## 2. Enable local HTTP

Enable **Non-encrypted / Insecure HTTP server** in the plugin settings. The default address is:

```text
http://127.0.0.1:27123
```

Keep the address on `127.0.0.1` or `localhost`; do not expose it to your LAN.

![Enable the local HTTP server](/assets/docs/obsidian/obsidian-enable-insecure-http.png)

## 3. Connect SyncNos

Copy the plugin **API Key**, then open **SyncNos → Settings → Obsidian**:

- **Base URL**: usually keep the default
- **API Key**: paste the key
- **Auth Header**: keep `Authorization`

Click **Test**. Once it succeeds, use manual sync or enable auto-sync.

![Configure the API key in SyncNos](/assets/docs/obsidian/obsidian-copy-api-key.png)

## Choose where notes and images go

Under **SyncNos → Settings → Obsidian → Obsidian Paths**, AI chats, web clips, and video scripts each have a row:
enter the note folder on the left and the **Attachment folder** on the right.
Press Enter or move focus away to save.

**All paths are relative to the Obsidian vault root.** For example, set the AI chat folder to `AI` and its attachment folder to `assets`:

- Note: `AI/example.md`.
- Image: `assets/example-1.png`, not `AI/assets/`.
- The note's image link points to `../assets/example-1.png` automatically.

File names are illustrative. Set the other two attachment folders to `assets` to share the same image directory.
Nested paths and spaces are supported, such as `syncnos/AI clipper/ai/assets`.

**Leave an attachment folder empty (default) or enter `.`** to save images beside their notes.
Paths must stay inside the vault; do not start one with `/` or `../`.

After changing a path, the next sync writes available images to the new location and updates references, **without deleting old images**.
Sync can overwrite notes edited manually in Obsidian, so back up those edits before syncing again.

## Troubleshoot

- `Failed to fetch`: confirm Obsidian, the plugin, and local HTTP are running.
- `401` / `403`: copy the API key again and confirm the Auth Header.
