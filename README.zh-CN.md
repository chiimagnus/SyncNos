<div align="center"><a name="readme-top"></a>

# SyncNos

你问过 AI 的每一句话、看过的每一篇长文、听过的每一段字幕，再也不会丢。

11+ AI 平台对话 + 任意网页文章 + YouTube/Bilibili 字幕；支持的非虚拟来源后台自动采集，虚拟列表对话显式手动抓取，本地优先存储。
一键同步到 Notion / Obsidian / 飞书，或导出 Markdown / Zip。

[SyncNos 天使赞助者们😍](https://chiimagnus.notion.site/syncnos-angels) · [English](README.md) · **中文**

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
![Safari](https://img.shields.io/badge/Safari-blue?logo=safari)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total)](https://github.com/chiimagnus/SyncNos/releases)

</div>

## 为什么用 SyncNos WebClipper？

|  |  |
| --- | --- |
| 🔒 **数据不出你的浏览器** | 没有第三方服务器，没有数据采集。所有内容先存 IndexedDB，再由你决定同步到哪里。 |
| 🔄 **增量同步，不重复不遗漏** | 只同步新内容，游标精确追踪上次同步位置。后台自动采集，知识库在你聊天的同时自己生长。 |
| 🔓 **完全开源，没有黑箱** | 每一行代码都在这个仓库里。你能看到你的浏览器里到底跑了什么。 |
| 📦 **多目标输出** | Notion / Obsidian / 飞书 DocX / Markdown / Zip——你的数据你做主，不被任何平台绑架。 |

## 下载与安装

| 渠道 | 下载入口 |
| --- | --- |
| Chrome、Arc / Brave 等 Chromium 系 | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari (macOS / iOS) | Build from source — requires Xcode 14.1+ |

## 操作演示视频

[![SyncNos 操作演示视频](docs/assets/syncnos-demo-video.svg)](https://www.bilibili.com/video/BV1gjwQznEx7/)

## 支持采集的来源

### AI 对话（11+ 平台）

| 平台 | 采集方式 |
| --- | --- |
| ChatGPT | 仅手动¹ |
| Claude | 自动 |
| Gemini | 自动 |
| DeepSeek | 自动 |
| Kimi | 自动 |
| 豆包 | 自动 |
| 元宝 | 自动 |
| Poe | 自动 |
| Notion AI | 自动 |
| z.ai | 自动 |
| Google AI Studio | 仅手动¹ |

¹ ChatGPT 与 Google AI Studio 使用虚拟列表，明确不进入自动保存。请使用 inpage 保存按钮或 popup 当前页抓取。详见 [WebClipper 数据流](docs/data-flow.md#4-虚拟列表对话的手动完整抓取)。

### 网页文章

任意 `http(s)` 页面均可触发抓取，自动提取正文、标题、作者和发布时间。

### 视频字幕

YouTube 和 Bilibili 视频页可采集页面已加载的字幕 / 转录内容，若有时间戳也会保留。

## 输出目标

| 目标 | 说明 |
| --- | --- |
| **Notion** | OAuth 授权后一键同步。AI 对话 → `SyncNos-AI Chats` 数据库；网页文章 → `SyncNos-Web Articles` 数据库；视频字幕 → `SyncNos-Videos` 数据库。 |
| **Obsidian** | 通过 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 插件直接写入 vault。本地到本地，不经网络；视频字幕会写入 `SyncNos-Videos`。 |
| **飞书（DocX）** | OAuth 授权后一键同步到飞书云文档 DocX。默认写入云盘根目录下的 `SyncNos-AIChats` / `SyncNos-WebArticles` / `SyncNos-Videos`（路径可在设置中自定义）。 |
| **Markdown / Zip** | 单文件或批量导出；Zip v2 备份可保留文章评论线程与缓存图片，便于完整本地恢复。 |

## 核心能力

- **后台自动采集**：支持的非虚拟来源会自动采集；ChatGPT 与 Google AI Studio 的虚拟列表对话必须显式手动抓取。
- **本地优先存储**：所有内容先落 IndexedDB，再派生到任何外部目标。
- **增量同步**：游标精确追踪，只同步新消息和新文章，不重复不遗漏。
- **Insight 仪表盘**：总 clips、来源分布、最长对话——让你的知识积累看得见。
- **Chat with AI**：支持自定义模板、平台启用列表和最大字符数，一键复制本地对话/文章到目标 AI 平台继续深聊。
- **视频字幕采集**：采集 YouTube / Bilibili 已加载字幕，保留完整时间戳。
- **AI 输入框 `$` 插入**：在支持站点输入 `$`，可搜索本地已保存条目并内联插入 Markdown 片段。
- **Inpage 快捷动作**：单击页面内按钮可快速保存，双击可打开评论侧边栏。
- **文章评论线程**：网页文章在 App 与 Inpage 共用本地 threaded discussion；正文选区提交后自动附加到根评论，精确引用使用 panel-scoped passive/active marker，并随 Zip v2 备份恢复与文章同步链路保留。详见[评论架构与限制](docs/modules/comments.md)。
- **智能当前页抓取**：popup 会自动判断页面类型并触发“抓取 AI 对话”或“抓取文章”。
- **图片缓存**：可选开启 AI 对话与网页文章图片本地缓存，支持在详情页手动补全历史 AI 对话图片。
- **详情页更多菜单**：阅读设置、缓存图片和字数统计等次级操作统一收进右上角更多菜单，正文页头保持更简洁。
- **反防盗链图片缓存**：网页文章图片命中规则时会自动缓存，即使关闭网页文章图片缓存开关也不会影响抓取主链路。
- **Markdown 阅读风格**：在 Inpage 设置中选择 Medium / Notion / Book，控制 popup / app 里的 markdown 渲染样式。
- **数据库备份 / 恢复**：完整导出和导入本地会话库（包含 `image_cache` 与 `article_comments` 评论线程），敏感信息（OAuth token 等）自动排除。
- **主题**：文章模式主题按钮可全局切换 System / Light / Sepia / Dark / Black，并同步影响 popup / app。
- **Inpage 按钮**：可配置显示范围（所有站点 / 仅支持站点 / 关闭）。

## 界面预览

WebClipper Popup：保存与浏览对话
![WebClipper Popup](docs/assets/popup-screenshots.png)
WebClipper Settings：备份与同步（Notion / Obsidian / 飞书）
![WebClipper Settings](docs/assets/setting-screenshots.png)

文章讨论侧栏：精确引用、紧凑线程与单 active reply composer
![文章讨论侧栏](docs/assets/comments-discussion.png)

## 支持

SyncNos 是一个人用心做的项目。

如果你想赞助我，有一个小小的请求：**别只给钱——留句话吧。** 说说你为什么用 SyncNos，讲个故事，或者就一句"加油"都好。

让我继续做下去的，不是钱，是知道有人在乎。把我们连在一起的，是情感，不是交易。

<img src="public/icons/buymeacoffee1.jpg" alt="Chii Magnus 的赞赏码" width="180" />

## 致谢

- 感谢 [linux.do](https://linux.do/t/topic/1635410) 社区的支持 💛
- 感谢 [obsidian clipper](https://github.com/obsidianmd/obsidian-clipper) 的启发
