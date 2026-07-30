<div align="center"><a name="readme-top"></a>

# SyncNos

Never lose an AI conversation, a great article, or a useful video transcript again.

11+ AI platforms + any web article + YouTube/Bilibili subtitles — captured automatically where supported, with explicit manual capture for virtualized chats, and stored locally first.
One-click sync to Notion / Obsidian / Feishu(Lark), or export as Markdown / Zip.

[SyncNos Angel Sponsors 😍](https://chiimagnus.notion.site/syncnos-angels) · **English** · [中文](README.zh-CN.md)

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
![Safari](https://img.shields.io/badge/Safari-blue?logo=safari)
[![Release Downloads](https://img.shields.io/github/downloads/SyncNos/SyncNos-Webclipper/total)](https://github.com/SyncNos/SyncNos-Webclipper/releases)

</div>

## Why SyncNos WebClipper?

|  |  |
| --- | --- |
| 🔒 **Your data stays in your browser** | No third-party servers, no data collection. Everything is stored in IndexedDB first — you decide where it goes next. |
| 🔄 **Incremental sync, no duplicates** | Only new content gets synced. Precise cursor tracking picks up right where you left off. Your knowledge base grows while you chat. |
| 🔓 **Fully open source** | Every line of code is in this repo. You can see exactly what runs in your browser. |
| 📦 **Multi-target output** | Notion / Obsidian / Feishu DocX / Markdown / Zip — your data, your choice. No vendor lock-in. |

## Download & Install

| Channel | Download |
| --- | --- |
| Chrome、Arc / Brave / other Chromium  | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari (macOS / iOS) | Build from source — requires Xcode 14.1+ |

## Demo Video

[![SyncNos demo video](docs/assets/syncnos-demo-video.svg)](https://www.bilibili.com/video/BV1gjwQznEx7/)

## Supported Sources

### AI Conversations (11+ platforms)

| Platform | Capture Mode |
| --- | --- |
| ChatGPT | Manual only¹ |
| Claude | Auto |
| Gemini | Auto |
| DeepSeek | Auto |
| Kimi | Auto |
| Doubao (豆包) | Auto |
| Yuanbao (元宝) | Auto |
| Poe | Auto |
| Notion AI | Auto |
| z.ai | Auto |
| Google AI Studio | Manual only¹ |

¹ ChatGPT and Google AI Studio use virtualized lists and are intentionally excluded from auto-save. Use the inpage save button or popup current-page capture. See [WebClipper data flow](docs/data-flow.md#4-虚拟列表对话的手动完整抓取).

### Web Articles

Any `http(s)` page can be clipped — body text, title, author, and publish date are extracted automatically. Complex SPA layouts fall back to site specs when needed, including Xiaohongshu notes, Bilibili opus pages, and Dedao note detail discussions.

### Video Transcripts

YouTube and Bilibili video pages can capture already loaded subtitles/transcripts, including timestamps when available.

## Output Targets

| Target | Details |
| --- | --- |
| **Notion** | One-click sync after OAuth. AI chats → `SyncNos-AI Chats` database; web articles → `SyncNos-Web Articles` database; video transcripts → `SyncNos-Videos` database. |
| **Obsidian** | Writes directly to your vault via the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin. Local-to-local, no network involved; video transcripts land in `SyncNos-Videos`. |
| **Feishu (DocX)** | Syncs conversations to Feishu DocX after OAuth. By default, docs land in `SyncNos-AIChats` / `SyncNos-WebArticles` / `SyncNos-Videos` folders under your Drive root (paths are configurable). |
| **Markdown / Zip** | Single file or bulk export. Zip v2 backups preserve article comment threads and cached images for full local recovery. |

## Core Capabilities

- **Background auto-capture** — supported non-virtual sources are captured automatically; virtualized ChatGPT and Google AI Studio conversations require an explicit manual capture.
- **Local-first storage** — all content lands in IndexedDB before going anywhere else.
- **Incremental sync** — precise cursor tracking. Only new messages and articles get synced.
- **Insight dashboard** — total clips, source breakdown, longest conversations — see your knowledge accumulate.
- **Chat with AI** — copy local conversations/articles with customizable templates, platform list, and max-length controls.
- **Video transcript capture** — save loaded YouTube / Bilibili subtitles with timestamps as local conversations.
- **Localized store metadata** — extension name/short description are localized via `public/_locales/` (20 locales).
- **$ Mention in AI chats** — type `$` on supported AI sites to search saved items and insert markdown snippets inline.
- **Inpage quick actions** — single-click the inpage button to save current content; double-click to open the comments sidebar.
- **Article comment threads** — local threaded discussions for web articles in App and Inpage surfaces. Committed page selections attach to the root composer automatically; exact quotes use panel-scoped passive/active markers, and comments remain part of Zip v2 backup/restore and article sync flows. See [Comments architecture and limits](docs/modules/comments.md).
- **Smart current-page capture** — popup auto-detects page type and runs `Fetch AI Chat` or `Fetch Article`.
- **Image caching** — optionally cache AI chat and web article images locally. Historical AI chat images can be backfilled from the detail page.
- **Anti-hotlink image caching** — article images that match anti-hotlink rules are cached automatically, even if web article image caching is turned off.
- **Article reader controls** — article and video details expose typography, theme, outline, and read-aloud controls; AI chats keep the normal conversation view.
- **Database backup / restore** — full export and import of your local session database, including `image_cache` and article comment threads. Sensitive data (OAuth tokens, etc.) is automatically excluded.
- **Theme** — the article-mode theme control switches the global System / Light / Sepia / Dark / Black theme for popup and app.
- **Inpage button** — configurable display scope (all sites / supported sites only / off).

## Screenshots

WebClipper Popup: save and browse conversations
![WebClipper Popup](docs/assets/popup-screenshots.png)

WebClipper Settings: backup and sync (Notion / Obsidian / Feishu)
![WebClipper Settings](docs/assets/setting-screenshots.png)

Article discussion sidebar: exact quotes, compact threads, and one active reply composer
![Article discussion sidebar](docs/assets/comments-discussion.png)

## Development

```bash
npm ci
npm run dev
```

Before submitting code, run:

```bash
npm run gate:ci
```

Use `npm run gate` when the change affects production builds, manifests, permissions, or release packaging.

## Documentation

Start at [docs/overview.md](docs/overview.md). It links the architecture, data flow, configuration, storage, API contracts, security model, module guides, and troubleshooting notes. Repository rules are in [AGENTS.md](AGENTS.md).

## Support

SyncNos is a one-person project, built with care.

If you'd like to sponsor me, I have a small request: **don't just send money — leave a message.**
Tell me why you use SyncNos, share a story, or simply say "keep going".

What keeps me going isn't the money — it's knowing someone cares.
What connects us is emotion, not a transaction.

<img src="public/icons/buymeacoffee1.jpg" alt="Chii Magnus tip jar QR" width="180" />

## Acknowledgements

- Special thanks to the [linux.do](https://linux.do/t/topic/1635410) community 💛
- Thanks to [obsidian clipper](https://github.com/obsidianmd/obsidian-clipper) for the inspiration
