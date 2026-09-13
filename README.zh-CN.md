<div align="center"><a name="readme-top"></a>

# SyncNos

本地优先地保存 AI 对话、网页文章和视频页面内容。

内容先进入浏览器本地，再按需同步到 Notion、Obsidian、飞书或 GitHub，导出选中的 Markdown / JSON，或创建本地 Backup ZIP。

[SyncNos 天使赞助者们😍](https://chiimagnus.notion.site/syncnos-angels) · [English](README.md) · **中文**

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
![Safari](https://img.shields.io/badge/Safari-blue?logo=safari)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total)](https://github.com/chiimagnus/SyncNos/releases)

</div>

## 为什么使用 SyncNos

采集内容先保存在本地，再进行可选的同步或导出。外部 Provider 和导出文件都是派生副本，不是主数据。权限、凭据和网络数据流见[隐私政策](PRIVACY.md)。

## 安装

| 浏览器 | 安装入口 |
| --- | --- |
| Chrome、Arc、Brave 等 Chromium 浏览器 | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari（macOS / iOS） | 使用 Xcode 从源码构建 |

### 本机 CLI

可选的 `syncnos` CLI 直接使用运行中的浏览器 Extension 作为数据和业务逻辑真源；它不是第二套数据库，也不是离线 daemon。

直接从 npm 安装已发布的 CLI：

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

每个 GitHub Release 仍会附带对应的 `chiimagnus-syncnos-<version>.tgz`，用于可复现或手动安装。

在需要使用 CLI 的浏览器 Profile 中开启 **设置 → 通用 → 本地 CLI 集成 → SyncNos CLI**。业务命令执行时，该浏览器 Profile 需要保持运行。

`syncnos install` 只检查有限的已知浏览器位置并写入当前用户的 Native Messaging registration，不遍历磁盘，也不读取浏览器 Profile。当前系统支持的 browser ID 以 `syncnos install --help` 为准；`syncnos doctor` 用于区分安装状态和 Extension 连接状态。Safari 使用另一套原生桥，不由这个 installer 管理。

## 演示

[![SyncNos 操作演示视频](docs/assets/syncnos-demo-video.svg)](https://www.bilibili.com/video/BV1gjwQznEx7/)

## 采集

### AI 对话

支持 ChatGPT、Gemini、Google AI Studio、DeepSeek、Kimi、豆包、元宝、Poe、Notion AI 和 z.ai。

ChatGPT 与 Google AI Studio 使用虚拟列表，只支持手动抓取；其它受支持的 AI 对话在开启 AI 自动保存后可自动采集。

ChatGPT 默认使用 DOM 采集；你也可以在 **设置 → AI 对话** 中显式开启仅针对当前会话的 **高级 API** 路径。它仍然只会在你手动保存时运行，并可能在 ChatGPT 调整未公开后端 API 后失效。

### 网页文章

普通 `http(s)` 页面都可以手动抓取。SyncNos 会提取可读正文和必要元数据，并在需要时使用站点特定处理。抓取后的文章支持本地评论和仅划线注释。

### 视频页面

SyncNos 支持 YouTube watch / youtu.be 页面和 Bilibili BV 播放页，也支持带合法 `bvid` 的稍后再看播放页。它会保存可用的页面上下文和页面已经加载的字幕 / transcript；当前 Bilibili 播放器提供章节 / 看点时也会一并保存。SyncNos 不下载音视频流；即使当前没有字幕，受支持的视频仍会按 Video 保存。

## 输出目标

| 目标 | 行为 |
| --- | --- |
| **Notion** | OAuth 后通过 Notion API 同步本地内容。 |
| **Obsidian** | 通过 Local REST API 写入 Markdown 和本地图片附件。[配置指南](docs/guide/obsidian/LocalRestAPI.zh.md) |
| **飞书** | OAuth 后同步到飞书 DocX。[配置指南](docs/guide/feishu/DocxSync.zh.md) |
| **GitHub** | 通过 SyncNos GitHub App 写入已授权的 repository / branch。 |
| **Markdown / JSON** | 在本机导出选中的条目和实际引用的缓存附件。 |
| **Backup ZIP** | 创建[本地数据、备份与恢复](docs/storage.md)中定义的恢复包。 |

每个 Provider 都可以手动同步，并可单独启用自动同步。

## 界面预览

WebClipper Popup：保存并浏览已采集内容。

![WebClipper Popup](docs/assets/popup-screenshots.png)

文章讨论侧栏：精确引用、紧凑线程和单 active reply composer。

![文章讨论侧栏](docs/assets/comments-discussion.png)

## 文档

- [隐私政策](PRIVACY.md)
- [本地数据、备份与恢复](docs/storage.md)
- [飞书配置](docs/guide/feishu/DocxSync.zh.md)
- [Obsidian 配置](docs/guide/obsidian/LocalRestAPI.zh.md)
- [参与贡献](docs/CONTRIBUTING.md)

## 支持

SyncNos 由一人维护。如果你愿意赞助，也欢迎留一句你为什么使用 SyncNos，或希望它接下来解决什么问题。

<img src="public/icons/buymeacoffee1.jpg" alt="Chii Magnus 的赞赏码" width="180" />

## 致谢

- 感谢 [linux.do](https://linux.do/t/topic/1635410) 社区的支持 💛
- 感谢 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) 的启发
