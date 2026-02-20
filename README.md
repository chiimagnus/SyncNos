# SyncNos

English | [中文](README.zh-CN.md)

This project has two parts:

1. **macOS app**: sync highlights and notes to Notion from Apple Books, GoodLinks, WeRead, Dedao, and chat history (including OCR). Supported: **macOS 14.0+**.
2. **WebClipper extension**: capture AI chats from supported sites into local browser storage, export (JSON/Markdown), backup/restore the local database (export/import), and manually sync to Notion (OAuth). Supported: **Chromium-based browsers (Chrome/Edge/Arc/etc.)** and **Firefox (AMO listed)**.

## How It Works

![](Resource/flows.svg)

## macOS App

- Supported: **macOS 14.0+**
- Download (App Store): https://apps.apple.com/app/syncnos/id6755133888

### Sync Scope

#### Sync From

- Apple Books
- GoodLinks
- WeRead (微信读书)
- Dedao (得到)
- Chat history (beta)
  - OCR version supported
  - Local storage encryption

#### Sync To

- Notion (OAuth recommended; API key supported)

## WebClipper (Browser Extension)

This repository includes a standalone MV3 browser extension under `Extensions/WebClipper/`.

- Supported browsers: **Chromium-based browsers (Chrome/Edge/Arc/etc.)** and **Firefox (AMO listed)**
- Download (Releases): https://github.com/chiimagnus/SyncNos/releases
- Firefox (AMO): https://addons.mozilla.org/firefox/addon/syncnos-webclipper/

### What It Does

- Captures AI chats from supported sites into local browser storage
- Exports selected conversations as JSON/Markdown
- Database Backup: export/import local IndexedDB + non-sensitive `chrome.storage.local` settings (import merges by `source + conversationKey`; Notion token is not included)
- Manually syncs selected conversations to Notion (OAuth)
- Writes to a Notion database named `SyncNos-AI Chats`; re-sync clears and rebuilds page content to avoid duplicates
- When `contentMarkdown` is available, sync renders Markdown into Notion blocks (headings/lists/quotes/code blocks/etc.); otherwise it falls back to plain text.
- Notion AI: optionally auto-picks a preferred model when the chat is set to **Auto** (configure in popup Settings)

### Supported Sites

ChatGPT / Claude / Gemini / DeepSeek / Kimi / Doubao / Yuanbao / NotionAI / z.ai

### Install From Releases

- Go to GitHub Releases and download the attached assets:
  - `syncnos-webclipper-chrome-v*.zip` (Chrome)
  - `syncnos-webclipper-edge-v*.zip` (Edge)
  - `syncnos-webclipper-firefox-v*.xpi` (Firefox, for local testing only)
- Chrome/Edge: unzip, then load unpacked in `chrome://extensions` / `edge://extensions` (Developer mode).
- Firefox: install from AMO (recommended). If you need local testing, use `about:debugging#/runtime/this-firefox` -> “Load Temporary Add-on…” and select the `.xpi` (or unzip and select `manifest.json`).

## License

This project is licensed under the [AGPL-3.0 License](LICENSE).
