# SyncNos

English | [中文](README.zh-CN.md)

This project has two parts:

1. **macOS app**: sync highlights and notes to Notion from Apple Books, GoodLinks, WeRead, Dedao, and chat history (including OCR). Supported: **macOS 14.0+**.
2. **WebClipper extension**: capture AI chats from supported sites into local browser storage, export (JSON/Markdown), and manually sync to Notion (OAuth). Supported: **Chromium-based browsers (Chrome/Edge/Arc/etc.)** and **Firefox (unsigned, temporary load)**.

## How It Works (Diagram)

```mermaid
flowchart LR
    classDef src fill:#F4F7FF,stroke:#4F46E5,color:#1E1B4B,stroke-width:1.5px,rx:8,ry:8;
    classDef hub fill:#111827,stroke:#111827,color:#F9FAFB,stroke-width:2px,rx:50,ry:50;
    classDef cache fill:#FFF7ED,stroke:#F97316,color:#7C2D12,stroke-width:1.5px;
    classDef out fill:#ECFDF5,stroke:#10B981,color:#065F46,stroke-width:1.5px,rx:8,ry:8;

    subgraph APP_SRC[" 📚 Data Sources · macOS App "]
        AB["Apple Books<br>Highlights & Notes"]:::src
        GL["GoodLinks<br>Highlights"]:::src
        WR["WeRead<br>Highlights & Notes"]:::src
        DD["Dedao<br>Highlights & Notes"]:::src
        OCR["Chat Logs (OCR)<br>Highlights"]:::src
    end

    subgraph WC_SRC[" 🤖 Data Sources · WebClipper "]
        CGPT["ChatGPT"]:::src
        CLD["Claude"]:::src
        GEM["Gemini"]:::src
        DS["DeepSeek"]:::src
        KIMI["Kimi"]:::src
        DOU["Doubao"]:::src
        YUAN["Yuanbao"]:::src
        NA["Notion AI"]:::src
    end

    SyncNos(("⚙️ SyncNos<br>macOS App")):::hub
    WebClipper(("⚙️ WebClipper<br>Browser Extension MV3")):::hub

    AB --> SyncNos
    GL --> SyncNos
    WR --> SyncNos
    DD --> SyncNos
    OCR --> SyncNos

    CGPT --> WebClipper
    CLD --> WebClipper
    GEM --> WebClipper
    DS --> WebClipper
    KIMI --> WebClipper
    DOU --> WebClipper
    YUAN --> WebClipper
    NA --> WebClipper

    SyncNos --> LOCAL_APP[("🔒 Local Cache<br>Encrypted Storage")]:::cache
    WebClipper --> LOCAL_WC[("🔒 Browser Local Storage<br>IndexedDB + chrome.storage")]:::cache

    SyncNos --> NOTION["☁️ Sync to Notion"]:::out
    WebClipper --> NOTION
    WebClipper --> JSON["📄 Export JSON"]:::out
    WebClipper --> MD["📝 Export Markdown"]:::out
```

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

- Notion

### Development

```bash
open SyncNos.xcodeproj
xcodebuild -scheme SyncNos -configuration Debug build
```

## WebClipper (Browser Extension)

This repository includes a standalone MV3 browser extension under `Extensions/WebClipper/`.

- Supported browsers: **Chromium-based browsers (Chrome/Edge/Arc/etc.)** and **Firefox (unsigned, temporary load)**
- Download (Releases): https://github.com/chiimagnus/SyncNos/releases

### What It Does

- Captures AI chats from supported sites into local browser storage
- Exports selected conversations as JSON/Markdown
- Manually syncs selected conversations to Notion (OAuth)

### Supported Sites

ChatGPT / Claude / Gemini / DeepSeek / Kimi / Doubao / Yuanbao / NotionAI

### Install From Releases

- Go to GitHub Releases and download the attached assets:
  - `syncnos-webclipper-chrome-v*.zip` (Chrome)
  - `syncnos-webclipper-edge-v*.zip` (Edge)
  - `syncnos-webclipper-firefox-v*.xpi` (Firefox, unsigned)
- Chrome/Edge: unzip, then load unpacked in `chrome://extensions` / `edge://extensions` (Developer mode).
- Firefox: use `about:debugging#/runtime/this-firefox` -> “Load Temporary Add-on…” and select the `.xpi` (or unzip and select `manifest.json`).

### Development

```bash
npm --prefix Extensions/WebClipper install
npm --prefix Extensions/WebClipper run check
npm --prefix Extensions/WebClipper run test
npm --prefix Extensions/WebClipper run build
```

## Docs

- Repository guide: `AGENTS.md`
- Business logic map: `.github/docs/business-logic.md`
- Keyboard navigation: `.github/docs/键盘导航与焦点管理技术文档（全项目）.md`
- WebClipper guide: `Extensions/WebClipper/AGENTS.md`

## License

This project is licensed under the [AGPL-3.0 License](LICENSE).
