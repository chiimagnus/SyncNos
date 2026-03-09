<div align="center"><a name="readme-top"></a>

# SyncNos · 快来看看吧！这是可爱的天使赞助者们[SyncNos Angels](https://chiimagnus.notion.site/syncnos-angels)

一款聚焦「阅读高亮与 AI 对话沉淀」的同步工具集。  
支持将多源内容整理后同步到 Notion，同时提供 WebClipper 浏览器扩展。

[English](README.md) · **中文**

[![macOS App Store Version](https://img.shields.io/itunes/v/6755133888?label=macOS%20App%20Store&logo=apple)](https://apps.apple.com/app/syncnos/id6755133888)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total?label=Release%20Downloads&logo=github)](https://github.com/chiimagnus/SyncNos/releases)

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok?label=Chrome&logo=googlechrome)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/github/v/release/chiimagnus/SyncNos?label=Edge&logo=microsoftedge)](https://github.com/chiimagnus/SyncNos/releases)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper?label=Firefox&logo=firefoxbrowser)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)

</div>

<img align="right" src="webclipper/public/icons/buymeacoffee1.jpg" alt="Chii Magnus 的赞赏码" width="120" />

## 项目组成

SyncNos 由两部分组成：

- **macOS App**：将 Apple Books、GoodLinks、微信读书、得到，以及聊天记录（含 OCR）的高亮与笔记同步到 Notion（支持 macOS 14.0+）。
- **WebClipper 浏览器扩展**：抓取支持网站的 AI 聊天并本地保存，支持导出、数据库备份/恢复、同步到 Notion / Obsidian。

## 工作流程

![](macOS/Resource/flows.svg)

## macOS App

<details>
<summary><kbd>展开查看</kbd></summary>

| 项目 | 说明 |
| --- | --- |
| 支持系统 | **macOS 14.0+** |
| 下载地址 | [Mac App Store](https://apps.apple.com/app/syncnos/id6755133888) |

### 同步来源

- Apple Books
- GoodLinks
- 微信读书（WeRead）
- 得到（Dedao）
- 聊天记录（beta）
  - 支持 OCR 版本
  - 本地存储加密

### 同步目标

- Notion OAuth

</details>

## WebClipper（浏览器扩展）

<details>
<summary><kbd>展开查看</kbd></summary>

### 下载与安装

| 渠道 | 下载入口 |
| --- | --- |
| Chrome [![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok?label=Chrome&logo=googlechrome)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge [![Edge Version](https://img.shields.io/github/v/release/chiimagnus/SyncNos?label=Edge&logo=microsoftedge)](https://github.com/chiimagnus/SyncNos/releases) | [GitHub Releases](https://github.com/chiimagnus/SyncNos/releases) |
| Firefox [![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper?label=Firefox&logo=firefoxbrowser)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) | [Firefox AMO](https://addons.mozilla.org/zh-CN/firefox/addon/syncnos-webclipper/) |

### 核心能力

- 抓取支持网站的 AI 聊天并保存到浏览器本地存储。
- 导出所选对话为 Markdown（单文件合并或多文件 zip 导出）。
- Popup/App 的对话详情支持消息 Markdown 渲染，便于阅读。
- 通过 `Obsidian Local REST API` 同步到 Obsidian（`http://127.0.0.1:27123`）。
- 数据库备份：
  - 导出 `*.zip`（`manifest.json` + `sources/conversations.csv` + `sources/...` + `config/storage-local.json`）
  - 导入 `*.zip`（推荐）与 legacy `*.json`
  - 按 `(source + conversationKey)` 合并导入，避免重复
  - 备份所有非敏感 `chrome.storage.local` 配置
  - 备份会排除敏感键（`notion_oauth_token*`、`notion_oauth_client_secret`）
  - 备份导入入口在 `Settings -> App Settings`（Firefox 同路径）
- 手动同步所选对话到 Notion（OAuth）。
- 删除对话会先弹出确认框，避免误删。
- Inpage 按钮显示范围可配置：
  - 默认在所有 `http(s)` 页面显示
  - 可切换为仅在支持 AI 站点 + Notion 页面显示
  - 切换后对新打开/刷新页面生效
  - 不影响 Settings 中的 `Fetch Current Page`
- Notion 同步按 kind 分库：
  - 聊天：`SyncNos-AI Chats`
  - 网页文章：`SyncNos-Web Articles`
- cursor 匹配时追加新增消息；cursor 缺失（或文章内容更新）时重建页面子块。
- 消息存在 `contentMarkdown` 时优先渲染为 Notion blocks（标题/列表/引用/代码块等），否则回退纯文本。
- Notion AI：可选“自动点选偏好模型”（仅在当前为 **Auto** 时生效）。
- Google AI Studio 采集器支持虚拟列表对话补抓（手动保存）并过滤非消息片段。

### 支持站点

ChatGPT / Claude / Gemini / DeepSeek / Kimi / 豆包 / 元宝 / Poe / NotionAI / z.ai / Google AI Studio

### 开发（WXT）

- 安装依赖：`npm --prefix webclipper install`
- 本地开发（Chrome MV3）：`npm --prefix webclipper run dev`
- 构建（Chrome / Firefox）：`npm --prefix webclipper run build` / `npm --prefix webclipper run build:firefox`
- 测试与类型检查：`npm --prefix webclipper run test` / `npm --prefix webclipper run compile`
- `src + entrypoints` 运行时代码已收敛为 TS；当前 JS allowlist 仅保留 `public/src/vendor/readability.js`（构建产物路径仍为 `src/vendor/readability.js`）。

</details>
