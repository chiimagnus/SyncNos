<img align="right" src="Extensions/WebClipper/icons/buymeacoffee1.jpg" alt="Chii Magnus 的赞赏码" width="120" />

# SyncNos

[English](README.md) | 中文
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total?label=Release%20Downloads&logo=github)](https://github.com/chiimagnus/SyncNos/releases)

[![Download macOS](https://img.shields.io/badge/Download-macOS%20App%20Store-0D96F6?logo=apple&logoColor=white)](https://apps.apple.com/app/syncnos/id6755133888) 

[![Download Chrome](https://img.shields.io/badge/Download-Chrome%20Web%20Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) 
[![Download Edge](https://img.shields.io/badge/Download-Edge%20Release-0078D7?logo=microsoftedge&logoColor=white)](https://github.com/chiimagnus/SyncNos/releases) 
[![Download Firefox](https://img.shields.io/badge/Download-Firefox%20AMO-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)

此项目分为两部分：

1. **macOS App**：将 Apple Books、GoodLinks、微信读书、得到，以及聊天记录（含 OCR）的高亮与笔记同步到 Notion。支持：**macOS 14.0+**。
2. **WebClipper 浏览器扩展**：从支持的网站抓取 AI 聊天并保存到浏览器本地存储，支持导出（Markdown）、数据库备份/恢复（导出/导入），以及手动同步到 Notion（OAuth）。支持：**Chromium 内核浏览器（Chrome/Edge/Arc 等）**与 **Firefox（已上架 AMO）**。

## 工作流程

![](Resource/flows.svg)

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

- Notion（推荐 OAuth，也支持手动 token）

## WebClipper（浏览器扩展）

仓库内包含一个独立的 MV3 浏览器扩展，位于 `Extensions/WebClipper/`。

- 支持浏览器：**Chromium 内核浏览器（Chrome/Edge/Arc 等）**与 **Firefox（已上架 AMO）**
- 下载（Releases）：https://github.com/chiimagnus/SyncNos/releases
- Chrome Web Store：https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok
- Firefox（AMO）：https://addons.mozilla.org/zh-CN/firefox/addon/syncnos-webclipper/

### 作用

- 从支持的网站抓取 AI 聊天并保存到浏览器本地存储
- 导出所选对话为 Markdown（支持单文件合并导出或多文件 zip 导出）
- 通过 `obsidian://new` 将所选对话写入 Obsidian（单选优先走剪贴板模式；多选按顺序打开多个 URL）
- Obsidian 按 kind 分目录写入：
  - 聊天：`SyncNos-AIChats/<会话标题>`
  - 网页文章：`SyncNos-WebArticles/<文章标题>`
  - 同名笔记会自动追加数字后缀
- 数据库备份：
  - 导出：仅支持 `*.zip`（`manifest.json` + `index/conversations.csv` + `sources/<source>/<conversationKey>.json` + `config/storage-local.json`）
  - 导入：支持 `*.zip`（推荐）与 legacy `*.json`
  - 合并规则：按 `(source + conversationKey)` 合并导入，避免同 key 重复项
  - 安全：备份不包含 Notion token / secret
- 手动同步所选对话到 Notion（OAuth）
- Notion 同步按 kind 分库写入：
  - 聊天：数据库 `SyncNos-AI Chats`
  - 网页文章：数据库 `SyncNos-Web Articles`
  - cursor 匹配时只追加新增消息；cursor 缺失（或文章重复 fetch 有更新）时会清空页面子块并重建内容。
- 当消息包含 `contentMarkdown` 时，同步会优先将 Markdown 渲染为 Notion blocks（标题/列表/引用/代码块等）；否则回退为纯文本。
- Notion AI：可选“自动点选偏好的大模型”（仅在 Notion AI 当前为 **自动/Auto** 时生效，可在扩展 Settings 中配置）

### 支持站点

ChatGPT / Claude / Gemini / DeepSeek / Kimi / 豆包 / 元宝 / Poe / NotionAI / z.ai

### 从 Releases 安装

- 前往 GitHub Releases 下载对应附件：
  - `syncnos-webclipper-chrome-v*.zip`（Chrome）
  - `syncnos-webclipper-edge-v*.zip`（Edge）
  - `syncnos-webclipper-firefox-v*.xpi`（Firefox，仅用于本地测试）
- Chrome/Edge：解压后，在 `chrome://extensions` / `edge://extensions`（开发者模式）中“加载已解压的扩展程序”。
- Firefox：推荐从 AMO 安装；如需本地测试，使用 `about:debugging#/runtime/this-firefox` -> “Load Temporary Add-on...” 选择 `.xpi`（或解压后选择 `manifest.json`）。

## 许可证

本项目使用 [AGPL-3.0 License](LICENSE)。
