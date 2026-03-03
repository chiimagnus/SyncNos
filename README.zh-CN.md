<div align="center"><a name="readme-top"></a>

# SyncNos

一款聚焦「阅读高亮与 AI 对话沉淀」的同步工具集。  
支持将多源内容整理后同步到 Notion，同时提供 WebClipper 浏览器扩展。

[English](README.md) · **中文**

[![Latest Version](https://img.shields.io/github/v/release/chiimagnus/SyncNos?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&logo=github)](https://github.com/chiimagnus/SyncNos/releases)
[![Last Commit](https://img.shields.io/github/last-commit/chiimagnus/SyncNos?logo=git)](https://github.com/chiimagnus/SyncNos/commits/main)
[![License](https://img.shields.io/github/license/chiimagnus/SyncNos)](LICENSE)
<br/>
[![macOS App Store Version](https://img.shields.io/itunes/v/6755133888?label=macOS%20App%20Store&logo=apple)](https://apps.apple.com/app/syncnos/id6755133888)
[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok?label=Chrome%20Web%20Store&logo=googlechrome)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/github/v/release/chiimagnus/SyncNos?label=Edge%20Release&logo=microsoftedge)](https://github.com/chiimagnus/SyncNos/releases)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper?label=Firefox%20AMO&logo=firefoxbrowser)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total?label=Release%20Downloads&logo=github)](https://github.com/chiimagnus/SyncNos/releases)

</div>

<img align="right" src="Extensions/WebClipper/icons/buymeacoffee1.jpg" alt="Chii Magnus 的赞赏码" width="120" />

## 项目组成

SyncNos 由两部分组成：

- **macOS App**：将 Apple Books、GoodLinks、微信读书、得到，以及聊天记录（含 OCR）的高亮与笔记同步到 Notion（支持 macOS 14.0+）。
- **WebClipper 浏览器扩展**：抓取支持网站的 AI 聊天并本地保存，支持导出、数据库备份/恢复、同步到 Notion / Obsidian。

## 工作流程

![](Resource/flows.svg)

## macOS App

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

- Notion（推荐 OAuth，也支持手动 token）

<div align="right">[⬆ 回到顶部](#readme-top)</div>

## WebClipper（浏览器扩展）

仓库内扩展目录：`Extensions/WebClipper/`（MV3）

### 下载与安装

| 渠道 | 链接 |
| --- | --- |
| Releases | https://github.com/chiimagnus/SyncNos/releases |
| Chrome Web Store | https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok |
| Firefox AMO | https://addons.mozilla.org/zh-CN/firefox/addon/syncnos-webclipper/ |

支持浏览器：**Chromium 内核浏览器（Chrome/Edge/Arc 等）** 与 **Firefox（已上架 AMO）**。

从 Releases 安装：

- 下载附件：
  - `syncnos-webclipper-chrome-v*.zip`（Chrome）
  - `syncnos-webclipper-edge-v*.zip`（Edge）
  - `syncnos-webclipper-firefox-v*.xpi`（Firefox，本地测试）
- Chrome/Edge：解压后进入 `chrome://extensions` / `edge://extensions`（开发者模式）加载已解压扩展。
- Firefox：推荐从 AMO 安装；本地测试可在 `about:debugging#/runtime/this-firefox` 加载 `.xpi`（或解压后选择 `manifest.json`）。

### 核心能力

- 抓取支持网站的 AI 聊天并保存到浏览器本地存储。
- 导出所选对话为 Markdown（单文件合并或多文件 zip 导出）。
- 通过 `Obsidian Local REST API` 同步到 Obsidian（`http://127.0.0.1:27123`）。
- 数据库备份：
  - 导出 `*.zip`（`manifest.json` + `index/conversations.csv` + `sources/...` + `config/storage-local.json`）
  - 导入 `*.zip`（推荐）与 legacy `*.json`
  - 按 `(source + conversationKey)` 合并导入，避免重复
  - 备份不包含 Notion token / secret
- 手动同步所选对话到 Notion（OAuth）。
- Inpage 按钮显示范围可配置：
  - 默认在所有 `http(s)` 页面显示
  - 可切换为仅在支持 AI 站点 + Notion 页面显示
  - 不影响 Settings 中的 `Fetch Current Page`
- Notion 同步按 kind 分库：
  - 聊天：`SyncNos-AI Chats`
  - 网页文章：`SyncNos-Web Articles`
- cursor 匹配时追加新增消息；cursor 缺失（或文章内容更新）时重建页面子块。
- 消息存在 `contentMarkdown` 时优先渲染为 Notion blocks（标题/列表/引用/代码块等），否则回退纯文本。
- Notion AI：可选“自动点选偏好模型”（仅在当前为 **Auto** 时生效）。

### 支持站点

ChatGPT / Claude / Gemini / DeepSeek / Kimi / 豆包 / 元宝 / Poe / NotionAI / z.ai

### 开发（WXT）

- 安装依赖：`npm --prefix Extensions/WebClipper install`
- 本地开发（Chrome MV3）：`npm --prefix Extensions/WebClipper run dev`
- 构建（Chrome / Firefox）：`npm --prefix Extensions/WebClipper run build` / `npm --prefix Extensions/WebClipper run build:firefox`
- 测试与类型检查：`npm --prefix Extensions/WebClipper run test` / `npm --prefix Extensions/WebClipper run compile`
- `src + entrypoints` 运行时代码已收敛为 TS；当前 JS allowlist 仅保留 `src/vendor/readability.js`。

<div align="right">[⬆ 回到顶部](#readme-top)</div>

## 许可证

本项目使用 [AGPL-3.0 License](LICENSE)。
