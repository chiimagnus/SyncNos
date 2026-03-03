# Obsidian Local REST API Setup (WebClipper)

English | [中文](./LocalRestAPI.zh.md)

This guide helps you install and configure the **Obsidian Local REST API** plugin, then paste the **API Key** into **SyncNos WebClipper** so the connection test can pass.

If you want the quickest path: finish Steps 1 to 3, then go back to WebClipper and click `Test`.

## Prerequisites

- Obsidian Desktop is installed
- A vault is already open in Obsidian
- Community plugins are enabled in Obsidian

## Step 1: Install and enable Local REST API

In Obsidian:

1. Open `Settings`
2. Go to `Community plugins`
3. Click `Browse`, search for `Local REST API` (by Adam Coddington), and install it
4. Click `Enable`

![Install Obsidian Local REST API plugin](./assets/obsidian-install-plugin.png)

## Step 2: Enable Insecure HTTP (required for current WebClipper)

The current SyncNos WebClipper connects to Obsidian via **HTTP** on port `27123`, so you must enable `Insecure HTTP` in the Local REST API plugin settings.

In Obsidian:

1. `Settings` -> `Local REST API`
2. Turn on `Insecure HTTP`
3. Confirm the port is `27123`
4. Confirm the host/bind address is `127.0.0.1` or `localhost`
   - Avoid `0.0.0.0` (it may expose the service to your LAN)

![Enable insecure HTTP mode](./assets/obsidian-enable-insecure-http.png)

## Step 3: Copy the API Key and paste it into WebClipper

In Obsidian, find and copy the `API Key` in the Local REST API plugin settings:

![Copy API key](./assets/obsidian-copy-api-key.png)

Then in the SyncNos WebClipper popup:

1. Go to `Settings`
2. Find `Obsidian Local REST API`
3. Fill in:
   - `Base URL`: `http://127.0.0.1:27123`
   - `API Key`: paste the key (no extra spaces/newlines)
   - `Auth Header`: `Authorization` (default)
4. Click `Test`

Notes:

- The `API Key` field is auto-saved on `blur` or when you press `Enter`.
- WebClipper writes notes with `<source>-<title>-<stableId10>.md`; when title changes, it auto-renames by writing the new file and removing the old one.

## Troubleshooting

### Test shows Failed / network_error / Failed to fetch

Check:

- Obsidian is running (desktop app)
- The Local REST API plugin is enabled
- `Insecure HTTP` is enabled and the port is `27123`
- `Base URL` is exactly `http://127.0.0.1:27123` (not `https`, not `27124`)

### Test shows unauthorized / authenticated false

Usually the API key is missing or incorrect:

- Copy the API key again from Obsidian
- Ensure there are no leading/trailing spaces or newlines
- Keep `Auth Header` as `Authorization`
