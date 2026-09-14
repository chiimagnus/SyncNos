---
title: Feishu
description: Configure a Feishu enterprise app and sync local content to Feishu DocX over OAuth.
---

## 1. Create a Feishu app

Create an **enterprise self-built app** in the Feishu Open Platform and obtain its App ID (Client ID).

Configure this OAuth redirect URI exactly:

```text
https://chiimagnus.github.io/syncnos-oauth/callback
```

Grant:

```text
docx:document
docx:document.block:convert
drive:drive
```

If you later change the scopes, Disconnect in SyncNos first and then Connect again so Feishu issues a token with the new permissions.

## 2. Choose an OAuth mode

### Proxy

Use a token-exchange Worker if you do not want the Feishu Client Secret stored in the extension profile.

The repository contains a Worker you can deploy yourself: [`cloudflare-workers/syncnos-feishu-oauth`](https://github.com/chiimagnus/SyncNos/tree/main/cloudflare-workers/syncnos-feishu-oauth). After deployment, enter its **Proxy URL** in SyncNos and leave Client Secret empty.

### Direct

If you accept storing the Client Secret in extension-local storage, use Direct: enter the Client Secret and leave Proxy URL empty. SyncNos then performs token exchange and refresh directly with Feishu.

The Client Secret is excluded from SyncNos Backup ZIP.

## 3. Connect SyncNos

Open **Settings → Feishu**:

1. enter the App ID;
2. configure exactly one credential path: Proxy URL or Client Secret;
3. click **Connect** and finish authorization in Feishu;
4. customize the target folders for AI chats, web articles, and video content if needed.

After connection, you can sync manually or enable Feishu auto-sync independently.

## Troubleshooting

- `401` / `403`: verify app scopes and authorize again.
- OAuth exchange or refresh failures: verify App ID, redirect URI, app publication status, and the selected Proxy / Direct configuration.
- DocX conversion, upload, or image failures: local content remains the primary record and can be synced again after fixing the connection.
