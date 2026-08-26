<div align="center"><a name="readme-top"></a>

# SyncNos

Never lose an AI conversation, a great article, or a useful video transcript again.

10 AI chat sites, any web article, and YouTube/Bilibili subtitles — captured where supported and stored locally first.
One-click sync to Notion / Obsidian / Feishu(Lark), or export as Markdown / Zip.

[SyncNos Angel Sponsors 😍](https://chiimagnus.notion.site/syncnos-angels) · **English** · [中文](README.zh-CN.md)

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
![Safari](https://img.shields.io/badge/Safari-blue?logo=safari)
[![Release Downloads](https://img.shields.io/github/downloads/SyncNos/SyncNos-Webclipper/total)](https://github.com/SyncNos/SyncNos-Webclipper/releases)

</div>

## What it does

SyncNos saves captured content to local IndexedDB before it is optionally synced to Notion, Obsidian, or Feishu, or exported as Markdown / Zip. External targets are derived copies, not the source of truth.

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
| Gemini | Auto |
| DeepSeek | Auto |
| Kimi | Auto |
| Doubao (豆包) | Auto |
| Yuanbao (元宝) | Auto |
| Poe | Auto |
| Notion AI | Auto |
| z.ai | Auto |
| Google AI Studio | Manual only¹ |

¹ ChatGPT and Google AI Studio use virtualized lists and are intentionally excluded from auto-save. Use the inpage save button or popup current-page capture. See [product rules](docs/overview.md#不可破坏的产品规则).

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

## Contributing

Before opening an issue or pull request, read [CONTRIBUTING.md](CONTRIBUTING.md). It defines the expected issue evidence, Conventional Commit rules, PR contents, and validation bar. Read [AGENTS.md](AGENTS.md) before changing code for repository architecture and non-negotiable product contracts.

## Documentation

Start at [docs/overview.md](docs/overview.md). It links configuration, local-data/security boundaries, Feishu setup, troubleshooting, and the contributor workflow. Repository rules are in [AGENTS.md](AGENTS.md).

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
