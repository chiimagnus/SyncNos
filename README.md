<div align="center"><a name="readme-top"></a>

# SyncNos

Local-first capture for AI conversations, web articles, and useful video-page context.

Save to the browser first, then optionally sync to Notion, Obsidian, Feishu (Lark), or GitHub, export selected items as Markdown/JSON, or create a local Backup ZIP.

[SyncNos Angel Sponsors 😍](https://chiimagnus.notion.site/syncnos-angels) · **English** · [中文](README.zh-CN.md)

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
![Safari](https://img.shields.io/badge/Safari-blue?logo=safari)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total)](https://github.com/chiimagnus/SyncNos/releases)

</div>

## Why SyncNos

Captured content is stored locally before optional sync or export. External providers and exported files are derived copies, not the primary record. See [Privacy](PRIVACY.md) for permissions, credentials, and network data flows.

## Install

| Browser | Install |
| --- | --- |
| Chrome, Arc, Brave, and other Chromium browsers | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari (macOS / iOS) | Build from source with Xcode |

### Local CLI

The optional `syncnos` CLI uses the running browser Extension as its data and business-logic owner; it is not a second database or an offline daemon.

Download `syncnos-cli-<version>.tgz` from the matching GitHub Release:

```bash
npm install -g ./syncnos-cli-<version>.tgz
syncnos install
syncnos doctor
```

Enable **Settings → General → Local CLI Integration → SyncNos CLI** in each browser profile you want to expose. Business commands require that browser profile to remain running.

`syncnos install` checks a finite set of known browser locations and writes user-level Native Messaging registrations; it does not crawl the disk or inspect browser profiles. Use `syncnos install --help` for the browser IDs supported on the current OS, and `syncnos doctor` to distinguish installation health from Extension connectivity. Safari uses a different native bridge and is not handled by this installer.

## Demo

[![SyncNos demo video](docs/assets/syncnos-demo-video.svg)](https://www.bilibili.com/video/BV1gjwQznEx7/)

## Capture

### AI conversations

Supported: ChatGPT, Gemini, Google AI Studio, DeepSeek, Kimi, Doubao, Yuanbao, Poe, Notion AI, and z.ai.

ChatGPT and Google AI Studio require manual capture because their virtualized conversation lists cannot be treated as complete automatically. Other supported AI chat collectors can auto-save when AI auto-save is enabled.

### Web articles

Any ordinary `http(s)` page can be captured manually. SyncNos extracts readable content and relevant metadata, with site-specific handling where needed. Captured articles support local comments and highlight-only annotations.

### Video pages

SyncNos supports YouTube watch/youtu.be pages and Bilibili BV playback pages, including Watch Later playback with a valid `bvid`. It saves available page context and already-loaded subtitles/transcripts; Bilibili chapters/highlights are also kept when the current player provides them. SyncNos does not download the audio/video stream, and a supported video remains a Video even when no subtitles are available yet.

## Destinations

| Target | Behavior |
| --- | --- |
| **Notion** | Sync local content through the Notion API after OAuth. |
| **Obsidian** | Write Markdown and local image attachments through the Local REST API. [Setup guide](docs/guide/obsidian/LocalRestAPI.en.md) |
| **Feishu (Lark)** | Sync local content to Feishu DocX after OAuth. [Setup guide](docs/guide/feishu/DocxSync.en.md) |
| **GitHub** | Write the local projection to an authorized repository/branch through the SyncNos GitHub App. |
| **Markdown / JSON** | Export selected items and referenced cached attachments locally. |
| **Backup ZIP** | Create the local recovery package described in [storage and recovery](docs/storage.md). |

Provider sync can be run manually; optional auto-sync is available per provider.

## Screenshots

WebClipper Popup: save and browse captured content.

![WebClipper Popup](docs/assets/popup-screenshots.png)

Article discussion sidebar: exact quotes, compact threads, and one active reply composer.

![Article discussion sidebar](docs/assets/comments-discussion.png)

## Documentation

- [Privacy](PRIVACY.md)
- [Storage, backup, and recovery](docs/storage.md)
- [Feishu setup](docs/guide/feishu/DocxSync.en.md)
- [Obsidian setup](docs/guide/obsidian/LocalRestAPI.en.md)
- [Contributing](docs/CONTRIBUTING.md)

## Support

SyncNos is maintained by one person. If you would like to sponsor the project, leave a note about why you use SyncNos or what you hope it will solve next.

<img src="public/icons/buymeacoffee1.jpg" alt="Chii Magnus tip jar QR" width="180" />

## Acknowledgements

- Special thanks to the [linux.do](https://linux.do/t/topic/1635410) community 💛
- Thanks to [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) for the inspiration
