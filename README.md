<div align="center"><a name="readme-top"></a>

# SyncNos

Never lose an AI conversation, a useful article, or useful context from a video page again.

Capture supported AI conversations, web articles, and useful context from YouTube/Bilibili video pages into local browser storage first, then optionally sync to Notion, Obsidian, Feishu (Lark), or GitHub, export selected content as Markdown or JSON, or create a local Backup ZIP.

[SyncNos Angel Sponsors 😍](https://chiimagnus.notion.site/syncnos-angels) · **English** · [中文](README.zh-CN.md)

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
![Safari](https://img.shields.io/badge/Safari-blue?logo=safari)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total)](https://github.com/chiimagnus/SyncNos/releases)

</div>

## What it does

SyncNos is local-first: captured content is saved locally before any optional sync or export. Notion, Obsidian, Feishu, GitHub, selected Markdown/JSON exports, and Backup ZIP files are derived outputs rather than the source of truth. See [Privacy](PRIVACY.md) for permissions, credentials, and external data flows.

## Download & Install

| Channel | Download |
| --- | --- |
| Chrome, Arc, Brave, and other Chromium browsers | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari (macOS / iOS) | Build from source with Xcode |

### Local CLI (macOS / Windows / Linux)

The SyncNos CLI is a local frontend for the data and business logic owned by the running browser Extension. It does not maintain a second database and is not an offline daemon.

Download `syncnos-cli-<version>.tgz` from the matching GitHub Release. By default the CLI discovers supported browsers installed on the current OS and registers each distinct Native Messaging target once:

```bash
npm install -g ./syncnos-cli-<version>.tgz
syncnos install
syncnos doctor
```

Discovery checks a finite set of known application/executable locations; it does not crawl the disk or read browser profiles. For portable, development, or non-standard installs, use `syncnos install --browser <id>`. `--extension-id` is only valid with an explicit `--browser`. `syncnos uninstall` removes only SyncNos-owned `app.syncnos.cli` registrations; browsers that share one Native Messaging target share one manifest/Registry key.

In each browser profile that should expose its data to the CLI, open **Settings → General → Local CLI Integration** and enable **SyncNos CLI**. The browser must remain running for business CLI commands. `syncnos doctor` reports `detectedBrowsers`, registration state, package state, and online instances separately; successful registration does not imply that an Extension instance is connected.

“Auto registration” below means the installer implements discovery plus the OS manifest/Registry contract. “Real round-trip” is stronger evidence and requires a real Extension → Native Host → CLI path:

| Browser | Auto discovery / registration | Real round-trip evidence |
| --- | --- | --- |
| Chrome / Chromium / Edge / Brave / Vivaldi / Opera / Iridium / Yandex | macOS / Linux / Windows | Not verified browser-by-browser; the standard Chrome smoke is explicitly deferred. |
| Slimjet | macOS / Windows | Not verified. |
| Arc | macOS | Not verified. |
| Helium | macOS | **Verified** with the current SyncNos 1.13.2 Extension and real Extension data. |
| Chrome Beta / Chrome Unstable | Linux | Not verified. |
| Chrome for Testing | macOS / Linux | Not verified. |
| Firefox | macOS / Linux / Windows | Signed release round-trip not yet verified. |
| Firefox Developer Edition | macOS / Windows | Not verified. |
| LibreWolf | macOS / Linux / Windows | Not verified. |
| Waterfox | Linux | Not verified. |
| Tor Browser | macOS / Linux auto-discovery; Windows explicit `--browser tor` registration only | Not verified. |
| Zen | macOS | **Transport and real-data path verified** with a same-ID current 1.13.2 build; signed-release packaging and the final real user permission gesture remain separate release evidence. |

Chromium production manifests allow both the Chrome Web Store and Microsoft Edge Add-ons SyncNos IDs. Firefox-family manifests use the stable Gecko ID `syncnos-webclipper@syncnos.app`. Safari uses a different native bridge model and is outside this WebExtension Native Messaging installer.

## Demo Video

[![SyncNos demo video](docs/assets/syncnos-demo-video.svg)](https://www.bilibili.com/video/BV1gjwQznEx7/)

## Supported Sources

### AI conversations

| Platform | Capture mode |
| --- | --- |
| ChatGPT | Manual only¹ |
| Gemini | Auto-save capable² |
| Google AI Studio | Manual only¹ |
| DeepSeek | Auto-save capable² |
| Kimi | Auto-save capable² |
| Doubao | Auto-save capable² |
| Yuanbao | Auto-save capable² |
| Poe | Auto-save capable² |
| Notion AI | Auto-save capable² |
| z.ai | Auto-save capable² |

¹ ChatGPT and Google AI Studio use virtualized conversation lists and require an explicit manual capture so SyncNos can verify completeness.

² Automatic capture only runs when AI auto-save is enabled. The source-of-truth site list lives in `src/collectors/ai-chat-sites.ts`.

### Web articles

Ordinary `http(s)` pages can be captured manually. Supported Video URLs are routed to Video capture instead of being stored as web articles. SyncNos extracts readable article content and relevant metadata, with site-specific fallbacks where needed. Captured articles support comments and highlight-only annotations; on Dedao course articles, personal highlights and notes available on the signed-in page are also imported into the article comment layer.

### Video capture

Video capture supports YouTube `watch` / `youtu.be` pages, Bilibili BV video pages, and Bilibili Watch Later playback pages with a valid `bvid`. Popup, the in-page save button, and the single dynamic SyncNos context-menu action all use the same Video route. SyncNos saves available source context such as title, author, description, duration, and thumbnail; when subtitles are already loaded, their transcript text and precise timestamp ranges are saved too, and Bilibili player chapters/highlights are preserved when the current page has naturally loaded them. Bilibili Watch Later URLs are normalized to the same `https://www.bilibili.com/video/<BV>/` identity (the `oid` parameter is not part of SyncNos identity). A video is still created or updated when no subtitles are available, and it never falls back to Web Article capture; capturing again after subtitles load adds or updates the transcript. SyncNos does not download the audio/video stream, and Bilibili `av` pages, YouTube Shorts, arbitrary `/video/*` paths, statistics/tags, and chapter images are outside this supported contract.

## Output Targets

| Target | Behavior |
| --- | --- |
| **Notion** | Syncs local content through the Notion API after OAuth. Manual sync is always available; optional auto-sync can be enabled. |
| **Obsidian** | Writes Markdown and local image attachments to your vault through the localhost Local REST API. See [setup](docs/guide/obsidian/LocalRestAPI.en.md). |
| **Feishu** | Syncs local content to Feishu DocX after OAuth. Manual sync is always available; optional auto-sync can be enabled. See [setup](docs/guide/feishu/DocxSync.en.md). |
| **GitHub** | Writes the local projection to an authorized repository/branch through the SyncNos GitHub App. Manual sync is always available; optional auto-sync can be enabled. |
| **Markdown / JSON** | Exports selected content as a ZIP container with one `.md` or `.json` content file per selected item plus referenced cached attachments. |
| **Backup ZIP** | Creates the separate local recovery package described in [storage and recovery](docs/storage.md). |

## Screenshots

WebClipper Popup: save and browse conversations
![WebClipper Popup](docs/assets/popup-screenshots.png)

Article discussion sidebar: exact quotes, compact threads, and one active reply composer
![Article discussion sidebar](docs/assets/comments-discussion.png)

## Contributing

Development setup, issue/commit/PR workflow, and validation requirements are maintained in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md). Architecture and non-negotiable product contracts are maintained in [AGENTS.md](AGENTS.md).

## Support

SyncNos is a one-person project.

If you'd like to sponsor the project, please leave a message about why you use SyncNos or what you would like it to become.

<img src="public/icons/buymeacoffee1.jpg" alt="Chii Magnus tip jar QR" width="180" />

## Acknowledgements

- Special thanks to the [linux.do](https://linux.do/t/topic/1635410) community 💛
- Thanks to [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) for the inspiration
