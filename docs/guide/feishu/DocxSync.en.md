# Feishu Sync Setup

**English** | [中文](./DocxSync.zh.md)

Use this guide to connect SyncNos to a Feishu self-built/internal app and sync local content to Feishu DocX.

## 1. Create the Feishu app

Create a self-built/internal app in the Feishu Open Platform and note its App ID (Client ID).

Set this OAuth redirect URL exactly:

```text
https://chiimagnus.github.io/syncnos-oauth/callback
```

Grant these scopes:

```text
docx:document
docx:document.block:convert
drive:drive
```

If you change scopes later, disconnect and reconnect SyncNos so Feishu issues a token with the new permissions.

## 2. Choose an OAuth mode

### Proxy

Use a token-exchange Worker when you do not want the Feishu Client Secret stored in the Extension.

The repository includes a Worker in `cloudflare-workers/syncnos-feishu-oauth/`. For your own app, set `FEISHU_CLIENT_ID` in `wrangler.toml`, store the secret, and deploy:

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler secret put FEISHU_CLIENT_SECRET
npx wrangler deploy
```

Set SyncNos **Proxy URL** to:

```text
https://<your-worker-host>/feishu/oauth/exchange
```

The Worker derives refresh handling from the corresponding `/feishu/oauth/refresh` endpoint.

### Direct

Use Direct mode only when you accept storing your Feishu Client Secret in extension-local storage. SyncNos then performs token exchange/refresh directly with Feishu. The secret is excluded from SyncNos Backup ZIP files.

## 3. Connect SyncNos

Open **Settings → Feishu**, enter the App ID, then configure exactly one credential path:

- **Proxy:** Proxy URL set, Client Secret empty.
- **Direct:** Client Secret set, Proxy URL empty.

Click **Connect** and finish authorization in Feishu. Destination folders can be changed in the same settings section.

Manual sync is available after connection; auto-sync can be enabled separately.

## Troubleshooting

For `401` / `403`, verify the app scopes and reconnect. For OAuth exchange/refresh failures, check the App ID, redirect URI, app publication state, and the configured Client Secret or Worker endpoint.

Local content remains the primary record when Feishu conversion, upload, or image handling fails.
