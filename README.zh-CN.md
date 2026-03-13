<div align="center"><a name="readme-top"></a>

# SyncNos

一款聚焦「阅读高亮与 AI 对话沉淀」的同步工具集。  
支持将多源内容整理后同步到 Notion，同时提供 WebClipper 浏览器扩展。

[SyncNos Angels](https://chiimagnus.notion.site/syncnos-angels) · [English](README.md) · **中文**

[![macOS App Store Version](https://img.shields.io/itunes/v/6755133888?label=macOS%20App%20Store&logo=apple)](https://apps.apple.com/app/syncnos/id6755133888)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total?label=Release%20Downloads&logo=github)](https://github.com/chiimagnus/SyncNos/releases)

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok?label=Chrome&logo=googlechrome)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/github/v/release/chiimagnus/SyncNos?label=Edge&logo=microsoftedge)](https://github.com/chiimagnus/SyncNos/releases)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper?label=Firefox&logo=firefoxbrowser)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)

</div>

## 支持项目

如果 SyncNos 对你有帮助，欢迎支持项目的持续维护与迭代：

<img src="webclipper/public/icons/buymeacoffee1.jpg" alt="Chii Magnus 的赞赏码" width="180" />

## WebClipper（浏览器扩展）

用于保存支持站点的 AI 对话与网页文章：本地留存、可导出、可备份、可同步到 Notion / Obsidian。

<details>
<summary><kbd>展开查看</kbd></summary>

### 界面预览（插件）

![WebClipper（插件）Popup：保存与浏览对话](.github/deepwiki/assets/popup-screenshots.png)

![WebClipper（插件）Settings：备份与同步（Notion / Obsidian）](.github/deepwiki/assets/setting-screenshots.png)

### 下载与安装（插件）

| 渠道 | 下载入口 |
| --- | --- |
| Chrome [![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok?label=Chrome&logo=googlechrome)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge [![Edge Version](https://img.shields.io/github/v/release/chiimagnus/SyncNos?label=Edge&logo=microsoftedge)](https://github.com/chiimagnus/SyncNos/releases) | [GitHub Releases](https://github.com/chiimagnus/SyncNos/releases) |
| Firefox [![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper?label=Firefox&logo=firefoxbrowser)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) | [Firefox AMO](https://addons.mozilla.org/zh-CN/firefox/addon/syncnos-webclipper/) |

### 3 步上手

1. 安装扩展（Chrome/Edge/Firefox）。
2. 在支持站点打开对话页/文章页，点 Popup 右上角按钮保存内容。
3. 进入 Settings：导出 Markdown、做数据库备份/恢复，或同步到 Notion / Obsidian。

### 核心能力（概览）

- **一键保存**：保存支持站点的 AI 对话/网页文章到浏览器本地存储。
- **可读性**：Popup/App 详情支持 Markdown 渲染，便于阅读与二次整理。
- **可迁移**：导出 Markdown（单文件 / zip），并支持数据库备份/恢复。
- **可同步**：手动同步对话到 Notion（OAuth），或通过 Obsidian Local REST API 同步到 Obsidian。
- **可控**：主题模式、Inpage 按钮显示范围、安装/升级行为都可配置。

### 功能细节

- 会话列表底部 `today/total` 统计可点击，直接跳转到 `Settings -> Insight`。
- `Chat with AI` 详情动作：可在设置里配置 prompt 模板、最大字符数和启用平台，然后把渲染后的内容复制到剪贴板并跳转到目标 AI 站点。
- 数据库备份：
  - 导出 `*.zip`（`manifest.json` + `sources/conversations.csv` + `sources/...` + `config/storage-local.json`）
  - 导入 `*.zip`（推荐）与 legacy `*.json`
  - 按 `(source + conversationKey)` 合并导入，避免重复
  - 备份所有非敏感 `chrome.storage.local` 配置
  - 备份会排除敏感键（`notion_oauth_token*`、`notion_oauth_client_secret`）
  - 备份导入入口在 `Settings -> App Settings`（Firefox 同路径）
- 删除对话会先弹出确认框，避免误删。
- Inpage 按钮显示范围可配置：
  - 默认在所有 `http(s)` 页面显示
  - 可切换为仅在支持 AI 站点 + Notion 页面显示
  - 切换后对新打开/刷新页面生效
  - 不影响 Settings 中的 `Fetch Current Page`
- 安装/升级行为：
  - 首次安装会自动打开 `Settings -> About`
  - 扩展升级后不再自动弹出设置页
- `Settings -> General` 支持主题模式：
  - `System` / `Light` / `Dark`
  - 写入浏览器本地存储，并同时作用于 popup 与完整 App 页面
- Notion 同步按 kind 分库：
  - 聊天：`SyncNos-AI Chats`
  - 网页文章：`SyncNos-Web Articles`
- cursor 匹配时追加新增消息；cursor 缺失（或文章内容更新）时重建页面子块。
- 消息存在 `contentMarkdown` 时优先渲染为 Notion blocks（标题/列表/引用/代码块等），否则回退纯文本。
- Notion AI：可选“自动点选偏好模型”（仅在当前为 **Auto** 时生效）。
- Google AI Studio 采集器支持虚拟列表对话补抓（手动保存）并过滤非消息片段。
- 近期采集稳定性增强：Gemini 会过滤隐藏说话人/状态文案并保留 blob 上传图；Kimi 与 z.ai 会稳定抓取用户上传附件图片。

### 支持站点

ChatGPT / Claude / Gemini / DeepSeek / Kimi / 豆包 / 元宝 / Poe / NotionAI / z.ai / Google AI Studio

</details>

## macOS App

将多源阅读高亮与笔记整理后同步到 Notion（支持 macOS 14.0+）。

<details>
<summary><kbd>展开查看</kbd></summary>

| 项目 | 说明 |
| --- | --- |
| 支持系统 | **macOS 14.0+** |
| 下载地址 | [Mac App Store](https://apps.apple.com/app/syncnos/id6755133888) |

### 3 步上手

1. 安装：在 [Mac App Store](https://apps.apple.com/app/syncnos/id6755133888) 下载。
2. 连接 Notion：在应用内完成 Notion OAuth。
3. 选择来源并同步：按数据源拉取高亮/笔记，同步到 Notion。

### 工作流程

![](macOS/Resource/flows.svg)

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
