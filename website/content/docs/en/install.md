---
title: Install
description: Install the SyncNos browser extension and optionally enable the local CLI.
---

## Browser extension

| Browser | Install |
| --- | --- |
| Chrome, Arc, Brave, and other Chromium browsers | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Microsoft Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari (macOS / iOS) | Build from [SyncNos source](https://github.com/chiimagnus/SyncNos) with Xcode |

Local capture works immediately after installation; you do not need to connect an external sync provider first.

## First use

1. Open the SyncNos extension.
2. Visit a supported AI conversation, a web article, or a YouTube / Bilibili video page.
3. Use the popup or in-page entry point to capture the current page.
4. Open the saved item in SyncNos and confirm the result.

See [Capture](/docs/en/capture/) for source-specific behavior.

## Optional: local CLI

The CLI is intended for automation and AI agents. It is not required for normal browser use.

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

Then enable **Settings → General → Local CLI Integration → SyncNos CLI** in every browser profile you want to expose. That browser profile must remain running while business commands execute.

See [Local CLI](/docs/en/cli/) for details.
