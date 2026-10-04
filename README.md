<div align="center"><a name="readme-top"></a>

# SyncNos

Local-first capture for AI conversations, web articles, and video content.

Content is saved in the browser first, then optionally synced to Notion, Obsidian, Feishu, or GitHub, or exported as Markdown / JSON / Backup.

[Website](https://chiimagnus.github.io/SyncNos/) · [Sponsors](https://chiimagnus.github.io/SyncNos/#sponsors) · **English** · [中文](README.zh-CN.md)

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
![Safari](https://img.shields.io/badge/Safari-blue?logo=safari)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total)](https://github.com/chiimagnus/SyncNos/releases)

</div>

## Install

| Browser | Install |
| --- | --- |
| Chrome, Arc, Brave, and other Chromium browsers | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari (macOS / iOS) | Build from source with Xcode |

## What SyncNos does

- Save chats from ChatGPT, Claude, Gemini, Google AI Studio, DeepSeek, Kimi, Doubao, Yuanbao, Poe, Notion AI, and z.ai
- Save readable web articles, content images, and YouTube / Bilibili subtitles and page metadata
- Search, read, highlight, comment, narrate, and view insights from the local library
- Use `$` in supported AI editors to search and insert local content
- Manually or automatically sync to Notion, Obsidian, Feishu, and GitHub
- Export Markdown / JSON or create a restorable Backup

See the [user docs](https://chiimagnus.github.io/SyncNos/docs/en/) for behavior and limitations.

## CLI & AI SKILL

For AI-agent access:

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

Then enable **Settings → CLI & AI SKILL → Local CLI Integration → SyncNos CLI** in the target browser profile. See [CLI & AI SKILL](https://chiimagnus.github.io/SyncNos/docs/en/cli/).

## Demo & screenshots

<a href="https://www.bilibili.com/video/BV1gjwQznEx7/"><img src="docs/assets/syncnos-demo-video.svg" alt="SyncNos demo video" width="760" /></a>

<img src="docs/assets/popup-screenshots.png" alt="SyncNos Popup" width="760" />

<img src="docs/assets/comments-discussion.png" alt="Article comments sidebar" width="760" />

## Documentation

- [Start here](https://chiimagnus.github.io/SyncNos/docs/en/)
- [Capture](https://chiimagnus.github.io/SyncNos/docs/en/capture/)
- [Sync](https://chiimagnus.github.io/SyncNos/docs/en/sync/)
- [Export & backup](https://chiimagnus.github.io/SyncNos/docs/en/export-backup/)
- [Privacy](PRIVACY.md)
- [Contributing](docs/CONTRIBUTING.md)

## Support

SyncNos is maintained by one person. If you would like to sponsor it, feel free to leave a note about why you use SyncNos or what you hope it will solve.

<img src="public/icons/buymeacoffee1.jpg" alt="Chii Magnus tip jar QR" width="180" />

## Acknowledgements

- Thanks to the [linux.do](https://linux.do/t/topic/1635410) community 💛
- Thanks to [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) for the inspiration
