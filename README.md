<div align="center"><a name="readme-top"></a>

# SyncNos

Local-first capture for AI conversations, web articles, and useful video-page context.

Save to the browser first, then optionally sync to Notion, Obsidian, Feishu (Lark), or GitHub, export selected items as Markdown/JSON, or create a local Backup ZIP.

[Website](https://chiimagnus.github.io/SyncNos/) · [SyncNos Angel Sponsors 😍](https://chiimagnus.github.io/SyncNos/#sponsors) · **English** · [中文](README.zh-CN.md)

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

### CLI & AI SKILL

The optional `syncnos` CLI lets AI agents work with a running SyncNos browser profile. Install it from npm, enable **Settings → CLI & AI SKILL → Local CLI Integration → SyncNos CLI** in that profile, and keep the browser running while the agent uses it.

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

See [CLI & AI SKILL](https://chiimagnus.github.io/SyncNos/docs/en/cli/) for setup. AI-agent Skills ship in [`skills/syncnos/`](skills/syncnos/) (English) and [`skills/syncnos-zh/`](skills/syncnos-zh/) (中文).

## Demo

[![SyncNos demo video](docs/assets/syncnos-demo-video.svg)](https://www.bilibili.com/video/BV1gjwQznEx7/)

## Capture

Alongside the popup and in-page entry points, SyncNos provides browser-native shortcuts to open the popup, save the current page, and open/focus the SyncNos app. No keys are assigned by default; use **Settings → Keyboard shortcuts** to see the browser's current bindings. See [Capture](https://chiimagnus.github.io/SyncNos/docs/en/capture/#browser-keyboard-shortcuts).

### AI conversations

Supported: ChatGPT, Gemini, Google AI Studio, DeepSeek, Kimi, Doubao, Yuanbao, Poe, Notion AI, and z.ai.

ChatGPT and Google AI Studio require manual capture because their virtualized conversation lists cannot be treated as complete automatically. Other supported AI chat collectors can auto-save when AI auto-save is enabled.

ChatGPT uses DOM capture by default and also offers an optional Advanced API path for manual current-conversation capture. See [Capture content](https://chiimagnus.github.io/SyncNos/docs/en/capture/) for behavior and limitations.

### Web articles

Any ordinary `http(s)` page can be captured manually. SyncNos extracts readable content and relevant metadata, with site-specific handling where needed. Captured articles support local comments and highlight-only annotations.

### Video pages

SyncNos supports YouTube watch/youtu.be pages and Bilibili BV playback pages, including Watch Later playback with a valid `bvid`. It saves available page context and already-loaded subtitles/transcripts; Bilibili chapters/highlights are also kept when the current player provides them. SyncNos does not download the audio/video stream, and a supported video remains a Video even when no subtitles are available yet.

## Destinations

| Target | Behavior |
| --- | --- |
| **Notion** | Sync local content through the Notion API after OAuth. [Setup guide](https://chiimagnus.github.io/SyncNos/docs/en/sync/notion/) |
| **Obsidian** | Write Markdown and local image attachments through the Local REST API. [Setup guide](https://chiimagnus.github.io/SyncNos/docs/en/sync/obsidian/) |
| **Feishu (Lark)** | Sync local content to Feishu DocX after OAuth. [Setup guide](https://chiimagnus.github.io/SyncNos/docs/en/sync/feishu/) |
| **GitHub** | Write the local projection to an authorized repository/branch through the SyncNos GitHub App. [Setup guide](https://chiimagnus.github.io/SyncNos/docs/en/sync/github/) |
| **Markdown / JSON** | Export selected items and available referenced image attachments locally. [Export & backup](https://chiimagnus.github.io/SyncNos/docs/en/export-backup/) |
| **Backup ZIP** | Create a recovery package for SyncNos local content and recoverable state. [Export & backup](https://chiimagnus.github.io/SyncNos/docs/en/export-backup/) |

Provider sync can be run manually; optional auto-sync is available per provider.

## Screenshots

WebClipper Popup: save and browse captured content.

![WebClipper Popup](docs/assets/popup-screenshots.png)

Article discussion sidebar: exact quotes, compact threads, and one active reply composer.

![Article discussion sidebar](docs/assets/comments-discussion.png)

## Documentation

- [User docs: start here](https://chiimagnus.github.io/SyncNos/docs/en/)
- [Capture](https://chiimagnus.github.io/SyncNos/docs/en/capture/)
- [Feature overview](https://chiimagnus.github.io/SyncNos/docs/en/features/)
- [Sync to external services](https://chiimagnus.github.io/SyncNos/docs/en/sync/)
- [Export & backup](https://chiimagnus.github.io/SyncNos/docs/en/export-backup/)
- [Privacy](PRIVACY.md)
- [Contributing](docs/CONTRIBUTING.md)

## Support

Join the SyncNos QQ user group (1027609452) for usage discussion and feedback.

<img src="docs/assets/qq-group.jpg" alt="SyncNos QQ user group QR code" width="220" />

SyncNos is maintained by one person. If you would like to sponsor the project, leave a note about why you use SyncNos or what you hope it will solve next.

<img src="public/icons/buymeacoffee1.jpg" alt="Chii Magnus tip jar QR" width="180" />

## Acknowledgements

- Special thanks to the [linux.do](https://linux.do/t/topic/1635410) community 💛
- Thanks to [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) for the inspiration
