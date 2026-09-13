<div align="center"><a name="readme-top"></a>

# SyncNos

把 AI 对话、网页文章和视频内容先保存到浏览器本地，再决定是否同步或导出。

支持采集的 AI 对话、网页文章与 YouTube/Bilibili 视频页面内容会先进入本地存储；Video 会保留可用的简介、章节与字幕等内容。之后可选择同步到 Notion / Obsidian / 飞书 / GitHub，把已选内容导出为 Markdown / JSON，或创建本地 Backup ZIP。

[SyncNos 天使赞助者们😍](https://chiimagnus.notion.site/syncnos-angels) · [English](README.md) · **中文**

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hmgjflllphdffeocddjjcfllifhejpok)](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok)
[![Edge Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fijkpghlfmkbjcgafapjcjahaikmnjncl&query=%24.version&label=Edge%20Add-ons&color=blue)](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl)
[![Firefox Version](https://img.shields.io/amo/v/syncnos-webclipper)](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/)
![Safari](https://img.shields.io/badge/Safari-blue?logo=safari)
[![Release Downloads](https://img.shields.io/github/downloads/chiimagnus/SyncNos/total)](https://github.com/chiimagnus/SyncNos/releases)

</div>

## 产品原则

SyncNos 以本地数据为真源：采集内容先写入浏览器本地，再派生到 Notion、Obsidian、飞书、GitHub 或导出文件。外部目标失败不应让已经保存的本地内容消失。权限、凭据与外部数据流见 [隐私政策](PRIVACY.md)。

## 下载与安装

| 渠道 | 下载入口 |
| --- | --- |
| Chrome、Arc、Brave 等 Chromium 浏览器 | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari（macOS / iOS） | 使用 Xcode 从源码构建 |

### 本机 CLI（macOS / Windows / Linux）

SyncNos CLI 是运行中浏览器 Extension 的本机前端，复用 Extension 已有的数据与业务逻辑；它不会维护第二份数据库，也不是离线 daemon。

从对应 GitHub Release 下载 `syncnos-cli-<version>.tgz` 后，默认让 CLI 自动发现当前系统中已安装的受支持浏览器，并为实际检测到的 Native Messaging registration target 去重注册：

```bash
npm install -g ./syncnos-cli-<version>.tgz
syncnos install
syncnos doctor
```

自动发现只检查有限的已知应用 / 可执行文件位置，不遍历整个磁盘，也不读取浏览器 Profile。需要显式注册 portable、开发版或非标准安装时，可使用 `syncnos install --browser <id>`；`--extension-id` 只允许与显式 `--browser` 同用。`syncnos uninstall` 默认只删除 SyncNos 自己的 `app.syncnos.cli` registration；共享同一个 browser target 的浏览器只写一份 manifest / Registry key。 显式 `--browser` 安装/卸载仍然作用于这个物理 registration target；若该 target 被其它浏览器共享，结果会通过 `sharedByBrowsers` 明确列出共同受影响的浏览器产品。

在需要使用 CLI 的浏览器 Profile 中打开 **设置 → 通用 → 本地 CLI 集成**，启用 **SyncNos CLI**。业务 CLI 命令依赖浏览器保持运行。`syncnos doctor` 会分别报告 `detectedBrowsers`、registration、package 与在线 instance；registration 写入成功不等于 Extension 已连接。

下面的“自动注册”表示 installer 已实现对应 OS 的 discovery + manifest/Registry 契约；“实机 round-trip”是更高一级证据，必须真实完成 Extension → Native Host → CLI：

| 浏览器 | 自动发现 / 注册覆盖 | 实机 round-trip 证据 |
| --- | --- | --- |
| Chrome / Chromium / Edge / Brave / Vivaldi / Opera / Iridium / Yandex | macOS / Linux / Windows | 尚未逐浏览器验证；标准 Chrome smoke 已按产品决定 Deferred。 |
| Slimjet | macOS / Windows | 尚未验证。 |
| Arc | macOS | 尚未验证。 |
| Helium | macOS | **已验证**：当前 SyncNos 1.13.2 可经 CLI 读取真实 Extension 数据。 |
| Chrome Beta / Chrome Unstable | Linux | 尚未验证。 |
| Chrome for Testing | macOS / Linux | 尚未验证。 |
| Firefox | macOS / Linux / Windows | 尚未验证正式 release round-trip。 |
| Firefox Developer Edition | macOS / Windows | 尚未验证。 |
| LibreWolf | macOS / Linux | 尚未验证。 |
| Waterfox | Linux | 尚未验证。 |
| Tor Browser | macOS / Linux 自动发现；Windows 仅显式 `--browser tor` 注册 | 尚未验证。 |
| Zen | macOS | **传输与真实数据链已验证**：current 1.13.2 same-ID build 可经 Native Messaging/CLI 读取原 Profile 数据；签名 release 与最终用户 permission gesture 仍是独立发布证据。 |

Chromium production manifest 同时允许 Chrome Web Store 与 Microsoft Edge Add-ons 的 SyncNos 正式扩展 ID；Firefox family 使用固定 Gecko ID `syncnos-webclipper@syncnos.app`。Safari 的原生桥模型不同，不属于这套 WebExtension Native Messaging installer。

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

普通 `http(s)` 页面都可以手动抓取；受支持的视频 URL 会直接进入 Video 采集，不会再保存成网页文章。SyncNos 提取可读正文和必要元数据，并在需要时使用站点特定的降级逻辑。抓取后的文章支持评论与仅划线注释；在已登录的得到课程文章页面中，页面可用的个人划线与笔记也会导入文章评论层。

### 视频采集

Video 采集支持 YouTube `watch` / `youtu.be` 页面、Bilibili BV 视频页，以及带合法 `bvid` 的 Bilibili 稍后再看播放页。Popup、页面内保存按钮和右键 SyncNos 的单一动态保存项都走同一套 Video 路由。SyncNos 会保存标题、作者、完整简介、时长、缩略图等可用来源上下文；页面已加载字幕时同时保存字幕/转录文本与精确时间范围，Bilibili 当前播放器已经自然加载章节/看点时也会一并保存。Bilibili 稍后再看 URL 会按 `bvid` 归一为同一个 `https://www.bilibili.com/video/<BV>/` identity（`oid` 不参与 SyncNos identity）。没有字幕时仍会创建或更新 Video，不会降级成网页文章；字幕稍后加载后再次保存即可补充或更新 transcript。SyncNos 不下载音视频流；Bilibili `av`、YouTube Shorts、任意 `/video/*`、播放统计/tags 与章节图片不属于当前支持契约。

## 输出目标

| 目标 | 行为 |
| --- | --- |
| **Notion** | OAuth 后通过 Notion API 同步本地内容；始终可手动同步，也可显式开启自动同步。 |
| **Obsidian** | 通过本机 Local REST API 把 Markdown 和本地图片附件写入 vault。参见[配置指南](docs/guide/obsidian/LocalRestAPI.zh.md)。 |
| **飞书** | OAuth 后同步本地内容到飞书 DocX；始终可手动同步，也可显式开启自动同步。参见[配置指南](docs/guide/feishu/DocxSync.zh.md)。 |
| **GitHub** | 通过 SyncNos GitHub App 把本地 projection 写入已授权的 repository/branch；始终可手动同步，也可显式开启自动同步。 |
| **Markdown / JSON** | 把已选内容打包为一个 ZIP；每条 item 对应一个独立 `.md` 或 `.json` 内容文件，并附带实际引用的本地缓存附件。 |
| **Backup ZIP** | 创建独立的本地恢复包；恢复边界见[本地数据、备份与恢复](docs/storage.md)。 |

## 界面预览

WebClipper Popup：保存与浏览对话
![WebClipper Popup](docs/assets/popup-screenshots.png)

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
