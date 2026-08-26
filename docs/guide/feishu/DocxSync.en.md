# Feishu DocX Sync Setup (WebClipper)

**English** | [中文](./DocxSync.zh.md)

This guide covers the user-facing setup for syncing SyncNos WebClipper content to Feishu DocX. Runtime behavior remains owned by `src/services/sync/feishu/**`.

## Prerequisites

- A Feishu account that can create or administer an app.
- Content already saved locally in SyncNos WebClipper.

## 1. Create a Feishu app

Create a self-built/internal app in the Feishu Open Platform and obtain its App ID (Client ID). Configure this OAuth redirect URL exactly:

```text
https://chiimagnus.github.io/syncnos-oauth/callback
```

The current extension requests these scopes:

```text
docx:document
docx:document.block:convert
drive:drive
```

After changing app permissions, disconnect and reconnect SyncNos so the new token receives the updated scopes.

## 2. Choose one OAuth mode

### Proxy / Cloudflare Worker

Use this when you do not want the Feishu Client Secret stored in the browser extension. The extension sends the OAuth code or refresh token to the configured Worker; the Worker performs the token exchange with Feishu.

The Worker is in:

```text
cloudflare-workers/syncnos-feishu-oauth/
```

For your own Feishu app, set `FEISHU_CLIENT_ID` in `wrangler.toml`, then store the secret and deploy:

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler secret put FEISHU_CLIENT_SECRET
npx wrangler deploy
```

Use the Worker exchange endpoint as the Proxy URL:

```text
https://<your-worker-host>/feishu/oauth/exchange
```

The refresh endpoint is the same Worker path ending in `/feishu/oauth/refresh`.

### Direct

Use this for a self-managed app when you accept storing the Client Secret in extension-local storage. SyncNos sends token exchange/refresh requests directly to Feishu.

The Client Secret is local credential data and is excluded from SyncNos backups.

## 3. Connect WebClipper

1. Open WebClipper → `Settings` → `Feishu`.
2. Enter the App ID / Client ID in the Feishu settings card.
3. Choose one mode:
   - Proxy: enter the Worker exchange URL and leave Client Secret / App Secret empty.
   - Direct: enter Client Secret / App Secret and leave Proxy URL empty.
4. Changes are saved when you leave the field or press Enter; the current page has no separate `Advanced` expansion step or `Save` button.
5. Click `Connect` in the top-right corner and finish authorization in Feishu.

After connection, manual sync is available. If Feishu auto-sync is explicitly enabled, local content changes can also enter the provider's automatic sync queue.

Destination folders are configurable in SyncNos settings. Their current defaults are owned by the settings service rather than duplicated here.

## 4. Validation and troubleshooting

Verify at least one `chat`, `article`, and `video` item can sync. Also verify token refresh still works and that disconnect clears the local OAuth state.

For `401` / `403`, check the app scopes and reconnect. For exchange or refresh failures, check the App ID, Client Secret or Worker secret, Proxy URL, app publication state, and redirect URI.

Document conversion or individual image failures may produce warnings; they should not silently replace the locally saved source content.