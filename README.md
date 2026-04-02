<div align="center"><a name="readme-top"></a>

# SyncNos

Never lose an AI conversation or a great article again.

11+ AI platforms + any web article — auto-captured in the background, stored locally first.
One-click sync to Notion / Obsidian, or export as Markdown / Zip.

[SyncNos Angel Sponsors 😍](https://chiimagnus.notion.site/syncnos-angels) · **English** · [中文](README.zh-CN.md)

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total)](https://github.com/chiimagnus/SyncNos/releases)

</div>

## Why SyncNos WebClipper?

| | |
| --- | --- |
| 🔒 **Your data stays in your browser** | No third-party servers, no data collection. Everything is stored in IndexedDB first — you decide where it goes next. |
| 🔄 **Incremental sync, no duplicates** | Only new content gets synced. Precise cursor tracking picks up right where you left off. Your knowledge base grows while you chat. |
| 🔓 **Fully open source** | Every line of code is in this repo. You can see exactly what runs in your browser. |
| 📦 **Multi-target output** | Notion / Obsidian / Markdown / Zip — your data, your choice. No vendor lock-in. |

## Download & Install

| Channel | Download |
| --- | --- |
| Chrome | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox AMO](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Arc / Brave / other Chromium | Use the Chrome Web Store link |

## Get Started in 3 Steps

1. **Install the extension** (Chrome / Edge / Firefox / Arc)
2. **Open any supported AI platform or web page** — the extension captures conversations and articles in the background
3. **Sync or export** — go to Settings to sync to Notion / Obsidian, or export Markdown / Zip backups

## Demo Video

[![SyncNos demo video](.github/deepwiki/assets/syncnos-demo-video.svg)](https://www.bilibili.com/video/BV1gjwQznEx7/)

## Supported Sources

### AI Conversations (11+ platforms)

| Platform | Capture Mode |
| --- | --- |
| ChatGPT | Auto |
| Claude | Auto |
| Gemini | Auto |
| DeepSeek | Auto |
| Kimi | Auto |
| Doubao (豆包) | Auto |
| Yuanbao (元宝) | Auto |
| Poe | Auto |
| Notion AI | Auto |
| z.ai | Auto |
| Google AI Studio | Manual save preferred¹ |

¹ Virtual list limitation: auto-capture may only detect currently visible turns. For full history, use inpage save or popup current-page capture.

### Web Articles

Any `http(s)` page can be clipped — body text, title, author, and publish date are extracted automatically.

## Output Targets

| Target | Details |
| --- | --- |
| **Notion** | One-click sync after OAuth. AI chats → `SyncNos-AI Chats` database; web articles → `SyncNos-Web Articles` database. |
| **Obsidian** | Writes directly to your vault via the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin. Local-to-local, no network involved. |
| **Markdown / Zip** | Single file or bulk export. Zip v2 backups preserve article comment threads and cached images for full local recovery. |

## Core Capabilities

- **Background auto-capture** — open a supported site and capturing starts automatically. No manual action needed (with a few exceptions).
- **Local-first storage** — all content lands in IndexedDB before going anywhere else.
- **Incremental sync** — precise cursor tracking. Only new messages and articles get synced.
- **Insight dashboard** — total clips, source breakdown, longest conversations — see your knowledge accumulate.
- **Chat with AI** — copy local conversations/articles with customizable templates, platform list, and max-length controls.
- **$ Mention in AI chats** — type `$` on supported AI sites to search saved items and insert markdown snippets inline.
- **Inpage quick actions** — single-click the inpage button to save current content; double-click to open the comments sidebar.
- **Article comment threads** — local threaded comments for web articles (detail + inpage panel), preserved in Zip v2 backup/restore and article sync flows.
- **Smart current-page capture** — popup auto-detects page type and runs `Fetch AI Chat` or `Fetch Article`.
- **Image caching** — optionally cache AI chat and web article images locally. Historical AI chat images can be backfilled from the detail page.
- **Database backup / restore** — full export and import of your local session database, including `image_cache` and article comment threads. Sensitive data (OAuth tokens, etc.) is automatically excluded.
- **Theme** — follows system `prefers-color-scheme` only.
- **Inpage button** — configurable display scope (all sites / supported sites only / off).

## Screenshots

WebClipper Popup: save and browse conversations
![WebClipper Popup](.github/deepwiki/assets/popup-screenshots.png)

WebClipper Settings: backup and sync (Notion / Obsidian)
![WebClipper Settings](.github/deepwiki/assets/setting-screenshots.png)

## Support

SyncNos is a one-person project, built with care.

If you'd like to sponsor me, I have a small request: **don't just send money — leave a message.**
Tell me why you use SyncNos, share a story, or simply say "keep going".

What keeps me going isn't the money — it's knowing someone cares.
What connects us is emotion, not a transaction.

<img src="webclipper/public/icons/buymeacoffee1.jpg" alt="Chii Magnus tip jar QR" width="180" />

## Acknowledgements

Special thanks to the [linux.do](https://linux.do/t/topic/1635410) community 💛
