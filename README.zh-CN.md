# SyncNos

[English](README.md) | 中文

此项目分为两部分：

1. **macOS App**：将 Apple Books、GoodLinks、微信读书、得到，以及聊天记录（含 OCR）的高亮与笔记同步到 Notion。支持：**macOS 14.0+**。
2. **WebClipper 浏览器扩展**：从支持的网站抓取 AI 聊天并保存到浏览器本地存储，支持导出（JSON/Markdown）与手动同步到 Notion（OAuth）。支持：**Chromium 内核浏览器（Chrome/Edge/Arc 等）**与 **Firefox（未签名，临时加载）**。

## 工作流程（示意图）

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart LR
    subgraph APP[" 📚 macOS App 数据来源 "]
        direction TB
        AB["📖 Apple Books<br>高亮 & 笔记"] ~~~ GL["🔗 GoodLinks<br>高亮"]
        WR["📚 微信读书<br>高亮 & 笔记"] ~~~ DD["🎓 得到<br>高亮 & 笔记"]
        OCR["📱 聊天记录 OCR<br>高亮"]
    end

    subgraph WEB[" 🤖 WebClipper 数据来源 "]
        direction TB
        CGPT["ChatGPT"] ~~~ CLD["Claude"] ~~~ GEM["Gemini"]
        DS["DeepSeek"] ~~~ KIMI["Kimi"] ~~~ DOU["豆包"]
        YUAN["元宝"] ~~~ NA["Notion AI"]
    end

    APP ===> SyncNos(("⚙️ SyncNos<br>macOS App"))
    WEB ===> WebClipper(("⚙️ WebClipper<br>MV3 扩展"))

    SyncNos --> CACHE1[("🔒 本地缓存<br>加密存储")]
    WebClipper --> CACHE2[("🔒 浏览器存储<br>IndexedDB")]

    subgraph OUT[" 📤 输出 "]
        direction TB
        NOTION["☁️ 同步到 Notion"]
        JSON["📄 导出 JSON"]
        MD["📝 导出 Markdown"]
    end

    SyncNos ===> OUT
    WebClipper ===> OUT
```

## macOS App

- 支持系统：**macOS 14.0+**
- 下载（App Store）：https://apps.apple.com/app/syncnos/id6755133888

### 同步范围

#### 同步来源

- Apple Books
- GoodLinks
- 微信读书（WeRead）
- 得到（Dedao）
- 聊天记录（beta）
  - 支持 OCR 版本
  - 本地存储加密

#### 同步目标

- Notion

### 开发

```bash
open SyncNos.xcodeproj
xcodebuild -scheme SyncNos -configuration Debug build
```

## WebClipper（浏览器扩展）

仓库内包含一个独立的 MV3 浏览器扩展，位于 `Extensions/WebClipper/`。

- 支持浏览器：**Chromium 内核浏览器（Chrome/Edge/Arc 等）**与 **Firefox（未签名，临时加载）**
- 下载（Releases）：https://github.com/chiimagnus/SyncNos/releases

### 作用

- 从支持的网站抓取 AI 聊天并保存到浏览器本地存储
- 导出所选对话为 JSON/Markdown
- 手动同步所选对话到 Notion（OAuth）

### 支持站点

ChatGPT / Claude / Gemini / DeepSeek / Kimi / 豆包 / 元宝 / NotionAI

### 从 Releases 安装

- 前往 GitHub Releases 下载对应附件：
  - `syncnos-webclipper-chrome-v*.zip`（Chrome）
  - `syncnos-webclipper-edge-v*.zip`（Edge）
  - `syncnos-webclipper-firefox-v*.xpi`（Firefox，未签名）
- Chrome/Edge：解压后，在 `chrome://extensions` / `edge://extensions`（开发者模式）中“加载已解压的扩展程序”。
- Firefox：使用 `about:debugging#/runtime/this-firefox` -> “Load Temporary Add-on...” 选择 `.xpi`（或解压后选择 `manifest.json`）。

### 开发

```bash
npm --prefix Extensions/WebClipper install
npm --prefix Extensions/WebClipper run check
npm --prefix Extensions/WebClipper run test
npm --prefix Extensions/WebClipper run build
```

## 文档

- 仓库指南：`AGENTS.md`
- 业务地图：`.github/docs/business-logic.md`
- 键盘导航：`.github/docs/键盘导航与焦点管理技术文档（全项目）.md`
- WebClipper 指南：`Extensions/WebClipper/AGENTS.md`

## 许可证

本项目使用 [AGPL-3.0 License](LICENSE)。
