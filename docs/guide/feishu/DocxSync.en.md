# Feishu DocX Sync Setup (WebClipper)

English | [中文](./DocxSync.zh.md)

This guide explains how to sync **SyncNos WebClipper** content to **Feishu Docs (DocX)**.

You need to create a Feishu app first, then connect it in WebClipper (Settings → Feishu).

## Prerequisites

- A Feishu account that can access `https://open.feishu.cn/app`
- Conversations are already saved locally in WebClipper

## Choose ONE connection mode

### Mode A: Use a Cloudflare Worker (safer, but you usually need to deploy your own)

Use this if you don’t want to store **App Secret** in the browser locally.

How it works:

- The extension does NOT store App Secret
- The extension sends `code` / `refresh_token` to your Worker
- Your Worker uses App Secret to exchange/refresh tokens with Feishu

You will:

1. Create a Feishu app and obtain `App ID / App Secret`
2. Deploy the Feishu OAuth Worker included in this repo
3. Paste your Worker `exchange` URL back into WebClipper

### Mode B: No Worker (easier, but the secret is stored locally)

Use this if you want the simplest setup and you accept storing App Secret locally in your browser.

How it works:

- The extension talks to Feishu token endpoint directly
- You must enter App Secret in WebClipper

> Note: the default Worker URL in this repo may be maintained by an individual and is not guaranteed to work for everyone. If you choose Mode A, you typically need to deploy your own Worker. If you don’t want to deploy a Worker, choose Mode B.

## Step 1: Create a Feishu app (Self-built / Internal app)

1. Open Feishu Open Platform: `https://open.feishu.cn/app`
2. Create an app (Self-built/Internal app is usually fine)
3. Find your credentials:
   - **App ID** (Client ID, looks like `cli_***`)
   - **App Secret** (Client Secret)

### 1.1 Configure Redirect URL (IMPORTANT)

Add this redirect URL:

```
https://chiimagnus.github.io/syncnos-oauth/callback
```

Notes:

- Must match exactly (even a trailing `/` difference will fail)
- **Current WebClipper code uses this redirect URI as a fixed value**, so your app must whitelist it

### 1.2 Required scopes

At minimum:

- `docx:document`
- `drive:drive`

## Step 2 (Optional): Deploy your Cloudflare Worker (Mode A)

Skip this section if you choose Mode B (enter App Secret directly).

### 2.1 Where is the Worker code

- `cloudflare-workers/syncnos-feishu-oauth/`

Endpoints:

- `POST /feishu/oauth/exchange` (exchange `code + redirectUri`)
- `POST /feishu/oauth/refresh` (refresh with `refreshToken`)

### 2.2 Deploy steps (example)

From the repo root (requires Cloudflare Wrangler set up):

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler deploy
```

Then set the secret (do NOT commit it to git):

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler secret put FEISHU_CLIENT_SECRET
```

### 2.3 What URL to paste into WebClipper

- Exchange URL (paste into WebClipper): `https://<your-worker-host>/feishu/oauth/exchange`
- Refresh URL: `https://<your-worker-host>/feishu/oauth/refresh` (derived automatically by WebClipper)

## Step 3: Connect in WebClipper

1. Open WebClipper → `Settings`
2. Go to `Feishu`
3. Open `Advanced`
4. Enter `App ID (Client ID)` first
5. Then choose ONE:
   - Mode A (Worker): fill `Proxy URL (Worker)`, leave `App Secret` empty
   - Mode B (Direct): fill `App Secret (Client Secret)`, leave `Proxy URL` empty
6. Click `Save`
7. Click `Connect` and finish authorization in the opened Feishu tab

## Troubleshooting

### Stuck on Waiting / token exchange failed

- Mode A (Worker)
  - Make sure you pasted `.../feishu/oauth/exchange` (not just the domain)
  - Make sure `FEISHU_CLIENT_SECRET` is set in your Worker
- Mode B (Direct)
  - Make sure `App Secret (Client Secret)` is not empty

### Authorization redirects back, but the extension does nothing

Most likely redirect URL mismatch:

- Your Feishu app must whitelist `https://chiimagnus.github.io/syncnos-oauth/callback`
- It must match exactly
