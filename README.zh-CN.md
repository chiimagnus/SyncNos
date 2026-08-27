<div align="center"><a name="readme-top"></a>

# SyncNos

把 AI 对话、网页文章和视频字幕先保存到浏览器本地，再决定是否同步或导出。

支持采集的 AI 对话、网页文章与 YouTube/Bilibili 字幕会先进入本地存储；之后可选择同步到 Notion / Obsidian / 飞书 / GitHub，或导出 Markdown / Zip。

[SyncNos 天使赞助者们😍](https://chiimagnus.notion.site/syncnos-angels) · [English](README.md) · **中文**

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
![Safari](https://img.shields.io/badge/Safari-blue?logo=safari)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total)](https://github.com/chiimagnus/SyncNos/releases)

</div>

## 产品原则

SyncNos 以本地数据为真源：采集内容先写入浏览器本地，再派生到 Notion、Obsidian、飞书、GitHub 或导出文件。外部目标失败不应让已经保存的本地内容消失。

## 下载与安装

| 渠道 | 下载入口 |
| --- | --- |
| Chrome、Arc、Brave 等 Chromium 浏览器 | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari（macOS / iOS） | 使用 Xcode 从源码构建 |

## 操作演示视频

[![SyncNos 操作演示视频](docs/assets/syncnos-demo-video.svg)](https://www.bilibili.com/video/BV1gjwQznEx7/)

## 支持采集的来源

### AI 对话

| 平台 | 采集方式 |
| --- | --- |
| ChatGPT | 仅手动¹ |
| Gemini | 可自动保存² |
| Google AI Studio | 仅手动¹ |
| DeepSeek | 可自动保存² |
| Kimi | 可自动保存² |
| 豆包 | 可自动保存² |
| 元宝 | 可自动保存² |
| Poe | 可自动保存² |
| Notion AI | 可自动保存² |
| z.ai | 可自动保存² |

¹ ChatGPT 与 Google AI Studio 使用虚拟列表，必须显式手动抓取，确保完整性后才能保存。

² 只有启用 AI 自动保存后才会后台采集。支持站点的事实真源是 `src/collectors/ai-chat-sites.ts`。

### 网页文章

任意 `http(s)` 页面都可以手动抓取。SyncNos 提取可读正文和必要元数据，并在需要时使用站点特定的降级逻辑。

### 视频字幕

YouTube 和 Bilibili 页面可采集页面已经加载的字幕 / 转录内容，并在可用时保留时间戳。

## 输出目标

| 目标 | 行为 |
| --- | --- |
| **Notion** | OAuth 后通过 Notion API 同步本地内容；始终可手动同步，也可显式开启自动同步。 |
| **Obsidian** | 通过本机 Local REST API 把 Markdown 和本地图片附件写入 vault。参见[配置指南](docs/guide/obsidian/LocalRestAPI.zh.md)。 |
| **飞书（DocX）** | OAuth 后同步本地内容到飞书 DocX；始终可手动同步，也可显式开启自动同步。参见[配置指南](docs/guide/feishu/DocxSync.zh.md)。 |
| **GitHub（Markdown）** | 通过 SyncNos GitHub App 把本地 projection 写入已授权的 repository/branch；始终可手动同步，也可显式开启自动同步。参见[配置指南](docs/guide/github/GitHubSync.zh.md)。 |
| **Markdown / Zip** | 导出单条内容或本地备份包。 |

## 界面预览

WebClipper Popup：保存与浏览对话
![WebClipper Popup](docs/assets/popup-screenshots.png)

WebClipper Settings：备份与同步
![WebClipper Settings](docs/assets/setting-screenshots.png)

文章讨论侧栏：精确引用、紧凑线程与单 active reply composer
![文章讨论侧栏](docs/assets/comments-discussion.png)

## 参与贡献

开发环境、Issue / commit / PR 流程与验证要求统一见 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)；代码分层和不可破坏的产品契约见 [AGENTS.md](AGENTS.md)。

## 支持

SyncNos 是一个人维护的项目。

如果你愿意赞助，也欢迎留一句你为什么使用 SyncNos，或者希望它接下来解决什么问题。

<img src="public/icons/buymeacoffee1.jpg" alt="Chii Magnus 的赞赏码" width="180" />

## 致谢

- 感谢 [linux.do](https://linux.do/t/topic/1635410) 社区的支持 💛
- 感谢 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) 的启发
