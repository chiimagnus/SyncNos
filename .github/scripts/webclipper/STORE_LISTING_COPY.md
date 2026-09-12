# SyncNos Store Listing Copy

This file is the canonical source for browser-store marketing copy. Store publishing workflows do not upload this text automatically; release maintainers copy it into the store listings. Update it when user-visible source/output capabilities or privacy claims change, and keep those claims aligned with `README.md` and `README.zh-CN.md`. Avoid hard-coded platform counts that can drift.

Localized manifest short descriptions are a separate source in `public/_locales/*/messages.json`; repository checks enforce the Safari 112-character limit.

## English

### Short description

Local-first clipper for AI chats, articles, and useful video-page context. Sync to Notion, Obsidian, Feishu, or GitHub.

### Long description

SyncNos is a local-first, open-source browser clipper for AI conversations, web articles, and supported video pages.

Capture useful content while keeping local browser storage as the source of truth:

- Save supported AI conversations.
- Extract readable content and relevant metadata from web pages.
- Save useful context from supported YouTube and Bilibili video pages; preserve subtitles with timestamps when available, and Bilibili player chapters/highlights when the current page provides them.
- Review and organize captured content locally before deciding where it goes next.

Choose what happens next:

- Sync manually or automatically to Notion, Obsidian, Feishu (Lark), or GitHub.
- Export selected items as Markdown or JSON.
- Create a local Backup ZIP for recovery.

SyncNos also supports article annotations, saved-item mentions in supported AI chats, browsing saved content, and an Insights view.

Privacy is part of the architecture: captured content is stored locally first. External transmission happens only when you configure or invoke a sync or export destination.

Open source: https://github.com/chiimagnus/SyncNos

## 简体中文

### 简短描述

本地优先的开源网页剪藏器：保存 AI 对话、文章和视频页面内容，可同步到 Notion、Obsidian、飞书或 GitHub。

### 详细描述

SyncNos 是一款本地优先、开源的浏览器剪藏器，用来保存 AI 对话、网页文章和受支持的视频页面内容。

采集内容先保存在浏览器本地，再决定下一步去向：

- 保存受支持的 AI 对话；
- 提取网页正文和相关元数据；
- 保存受支持的 YouTube 与 Bilibili 视频页面上下文；有字幕时保留字幕/转录文本与时间戳，当前 Bilibili 播放器提供章节/看点时也会一并保存；
- 先在本地浏览、整理已保存内容，再决定是否同步或导出。

按需处理本地内容：

- 手动或自动同步到 Notion、Obsidian、飞书或 GitHub；
- 将选中内容导出为 Markdown 或 JSON；
- 创建本地 Backup ZIP 用于恢复。

SyncNos 还支持文章划词评论、在受支持的 AI 对话中用 `$` 引用已保存条目，以及浏览本地内容和 Insights。

隐私是产品架构的一部分：采集内容默认先保存在本地；只有当你主动配置或调用同步、导出目标时，相关数据才会发送到对应服务。

开源代码：https://github.com/chiimagnus/SyncNos
