<img align="right" src="Extensions/WebClipper/icons/buymeacoffee1.jpg" alt="Chii Magnus 的赞赏码" width="120" />

# SyncNos

English | [中文](README.zh-CN.md)

[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total?label=Release%20Downloads&logo=github)](https://github.com/chiimagnus/SyncNos/releases)

[![Download macOS](https://img.shields.io/badge/Download-macOS%20App%20Store-0D96F6?logo=apple&logoColor=white)](https://apps.apple.com/app/syncnos/id6755133888) 

[![Download Chrome](https://img.shields.io/badge/Download-Chrome%20Web%20Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) 
[![Download Edge](https://img.shields.io/badge/Download-Edge%20Release-0078D7?logo=microsoftedge&logoColor=white)](https://github.com/chiimagnus/SyncNos/releases) 
[![Download Firefox](https://img.shields.io/badge/Download-Firefox%20AMO-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)

This project has two parts:

1. **macOS app**: sync highlights and notes to Notion from Apple Books, GoodLinks, WeRead, Dedao, and chat history (including OCR). Supported: **macOS 14.0+**.
2. **WebClipper extension**: capture AI chats from supported sites into local browser storage, export (Markdown), backup/restore the local database (export/import), and manually sync to Notion (OAuth). Supported: **Chromium-based browsers (Chrome/Edge/Arc/etc.)** and **Firefox (AMO listed)**.

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
- Chrome Web Store: https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok
- Firefox (AMO): https://addons.mozilla.org/firefox/addon/syncnos-webclipper/

### What It Does

- Captures AI chats from supported sites into local browser storage
- Exports selected conversations as Markdown (single merged export or multi-file zip export)
- Adds selected conversations to Obsidian via `obsidian://new` (single selection prefers clipboard mode; multi-selection opens URLs in order)
- Obsidian export routes by kind:
  - Chats: `SyncNos-AIChats/<conversation-title>`
  - Web articles: `SyncNos-WebArticles/<article-title>`
  - Duplicate note names append numeric suffixes
- Database Backup: export/import local IndexedDB + non-sensitive `chrome.storage.local` settings (import merges by `source + conversationKey`; Notion token is not included)
- Manually syncs selected conversations to Notion (OAuth)
- Notion sync routes by kind:
  - Chats: database `SyncNos-AI Chats`
  - Web articles: database `SyncNos-Web Articles`
  - Re-sync appends only new messages when cursor matches; if cursor is missing (or an article is re-fetched and updated), it rebuilds page content.
- When `contentMarkdown` is available, sync renders Markdown into Notion blocks (headings/lists/quotes/code blocks/etc.); otherwise it falls back to plain text.
- Notion AI: optionally auto-picks a preferred model when the chat is set to **Auto** (configure in popup Settings)

### Supported Sites

ChatGPT / Claude / Gemini / DeepSeek / Kimi / Doubao / Yuanbao / Poe / NotionAI / z.ai

### Install From Releases

- Go to GitHub Releases and download the attached assets:
  - `syncnos-webclipper-chrome-v*.zip` (Chrome)
  - `syncnos-webclipper-edge-v*.zip` (Edge)
  - `syncnos-webclipper-firefox-v*.xpi` (Firefox, for local testing only)
- Chrome/Edge: unzip, then load unpacked in `chrome://extensions` / `edge://extensions` (Developer mode).
- Firefox: install from AMO (recommended). If you need local testing, use `about:debugging#/runtime/this-firefox` -> “Load Temporary Add-on…” and select the `.xpi` (or unzip and select `manifest.json`).

## License

This project is licensed under the [AGPL-3.0 License](LICENSE).
