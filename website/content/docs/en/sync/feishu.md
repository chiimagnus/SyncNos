---
title: Feishu
description: Configure a Feishu app and sync SyncNos content to Feishu cloud documents.
---

## 1. Create a Feishu app

Create an **enterprise self-built app** in the Feishu Open Platform and note its **App ID**.

Set the OAuth redirect URI to:

```text
https://chiimagnus.github.io/syncnos-oauth/callback
```

Add these permissions:

```text
docx:document
docx:document.block:convert
drive:drive
```

If you later change permissions, disconnect Feishu in SyncNos and connect again.

## 2. Choose a connection method

Use one of these:

- **Proxy**: deploy the repository's [OAuth Worker](https://github.com/chiimagnus/SyncNos/tree/main/cloudflare-workers/syncnos-feishu-oauth), enter its **Proxy URL** in SyncNos, and leave Client Secret empty
- **Direct**: enter the **Client Secret** in SyncNos and leave Proxy URL empty

## 3. Connect SyncNos

Open **SyncNos → Settings → Feishu**:

1. Enter the App ID
2. Enter either the Proxy URL or Client Secret
3. Click **Connect** and finish Feishu authorization
4. Choose destination folders for AI chats, web articles, and videos if needed
5. Run one manual sync and confirm the content appears correctly

Enable automatic sync afterward if you want it.

## When something fails

- `401` / `403`: check the app permissions and authorize again
- Authorization does not finish: check the App ID, Redirect URI, app publication status, and Proxy / Direct settings
- Sync fails: your local content stays available; fix the configuration and sync again
