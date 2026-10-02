---
title: Feishu
description: Configure a Feishu app and sync SyncNos content to Feishu cloud documents.
---

## 1. Create a Feishu app

Create an **Enterprise self-built app** in the Feishu Open Platform, note the **App ID**, and configure this redirect URL:

```text
https://chiimagnus.github.io/SyncNos/syncnos-oauth/callback/
```

Add these permissions:

```text
docx:document
docx:document.block:convert
drive:drive
```

Re-authorize SyncNos after changing permissions.

## 2. Choose a connection method

- **Proxy**: deploy the repository [OAuth Worker](https://github.com/chiimagnus/SyncNos/tree/main/cloudflare-workers/syncnos-feishu-oauth), enter its Proxy URL, and leave Client Secret empty.
- **Direct**: enter the Client Secret and leave Proxy URL empty.

## 3. Connect SyncNos

In **SyncNos → Settings → Feishu**:

1. Enter the App ID.
2. Enter either the Proxy URL or Client Secret.
3. Click **Connect** and finish authorization.
4. Choose destination folders as needed.
5. Run one manual sync and confirm the result.

Enable auto-sync only after the connection works.

## Troubleshoot

- `401` / `403`: check app permissions and authorize again.
- Authorization fails: check App ID, Redirect URI, app publication state, and connection method.
- Sync fails: fix the configuration and retry; local content remains safe.
