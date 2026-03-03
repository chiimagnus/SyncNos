<div align="center"><a name="readme-top"></a>

# SyncNos

A toolkit focused on syncing reading highlights and AI conversations.  
It consolidates multi-source content to Notion and provides a WebClipper browser extension.

**English** · [中文](README.zh-CN.md)

[![Latest Version](https://img.shields.io/github/v/release/chiimagnus/SyncNos?label=Latest%20Version&logo=github)](https://github.com/chiimagnus/SyncNos/releases)
[![Last Commit](https://img.shields.io/github/last-commit/chiimagnus/SyncNos?logo=git)](https://github.com/chiimagnus/SyncNos/commits/main)
[![License](https://img.shields.io/github/license/chiimagnus/SyncNos)](LICENSE)
<br/>
[![macOS App Store Version](https://img.shields.io/itunes/v/6755133888?label=macOS%20App%20Store&logo=apple)](https://apps.apple.com/app/syncnos/id6755133888)
[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok?label=Chrome&logo=googlechrome)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/github/v/release/chiimagnus/SyncNos?label=Edge&logo=microsoftedge)](https://github.com/chiimagnus/SyncNos/releases)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper?label=Firefox&logo=firefoxbrowser)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total?label=Release%20Downloads&logo=github)](https://github.com/chiimagnus/SyncNos/releases)

</div>

<img align="right" src="Extensions/WebClipper/icons/buymeacoffee1.jpg" alt="Chii Magnus donation QR" width="120" />

## Project Overview

SyncNos has two parts:

- **macOS App**: Sync highlights and notes from Apple Books, GoodLinks, WeRead, Dedao, and chat history (with OCR support) to Notion (macOS 14.0+).
- **WebClipper Extension**: Capture AI chats from supported sites to local browser storage, then export, backup/restore, and sync to Notion / Obsidian.

## How It Works

![](Resource/flows.svg)

## macOS App

<details>
<summary><kbd>Expand</kbd></summary>

| Item | Details |
| --- | --- |
| Supported OS | **macOS 14.0+** |
| Download | [Mac App Store](https://apps.apple.com/app/syncnos/id6755133888) |

### Sync From

- Apple Books
- GoodLinks
- WeRead
- Dedao
- Chat history (beta)
  - OCR supported
  - Local storage encryption

### Sync To

- Notion OAuth

</details>

## WebClipper (Browser Extension)

<details>
<summary><kbd>Expand</kbd></summary>

### Download & Install

| Channel | Download |
| --- | --- |
| Chrome [![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok?label=Chrome&logo=googlechrome)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge [![Edge Version](https://img.shields.io/github/v/release/chiimagnus/SyncNos?label=Edge&logo=microsoftedge)](https://github.com/chiimagnus/SyncNos/releases) | [GitHub Releases](https://github.com/chiimagnus/SyncNos/releases) |
| Firefox [![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper?label=Firefox&logo=firefoxbrowser)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) | [Firefox AMO](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |

### Core Capabilities

- Capture AI chats from supported sites into local browser storage.
- Export selected conversations as Markdown (single merged file or multi-file zip).
- Sync selected conversations to Obsidian via `Obsidian Local REST API` (`http://127.0.0.1:27123`).
- Database backup:
  - Export `*.zip` (`manifest.json` + `index/conversations.csv` + `sources/...` + `config/storage-local.json`)
  - Import `*.zip` (recommended) and legacy `*.json`
  - Merge by `(source + conversationKey)` to avoid duplicates
  - Notion token / secret are excluded from backups
- Manually sync selected conversations to Notion (OAuth).
- Configurable Inpage button visibility:
  - Default: all `http(s)` pages
  - Optional: only supported AI sites + Notion pages
  - Does not affect `Fetch Current Page` in Settings
- Notion sync writes by kind:
  - Chats: `SyncNos-AI Chats`
  - Web articles: `SyncNos-Web Articles`
- If cursor matches, append only new messages; otherwise rebuild page blocks when cursor is missing or content is refreshed.
- If `contentMarkdown` exists, render as Notion blocks (headings/lists/quotes/code blocks); otherwise fallback to plain text.
- Notion AI: optionally auto-select preferred model when current mode is **Auto**.

### Supported Sites

ChatGPT / Claude / Gemini / DeepSeek / Kimi / Doubao / Yuanbao / Poe / NotionAI / z.ai / Google AI Studio

### Development (WXT)

- Install deps: `npm --prefix Extensions/WebClipper install`
- Dev (Chrome MV3): `npm --prefix Extensions/WebClipper run dev`
- Build (Chrome / Firefox): `npm --prefix Extensions/WebClipper run build` / `npm --prefix Extensions/WebClipper run build:firefox`
- Test + typecheck: `npm --prefix Extensions/WebClipper run test` / `npm --prefix Extensions/WebClipper run compile`
- Runtime code in `src + entrypoints` is TS-only; current JS allowlist only keeps `src/vendor/readability.js`.

</details>
