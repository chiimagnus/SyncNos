---
title: 安装
description: 安装 SyncNos 浏览器扩展，并确认第一次采集可以正常保存到本地。
---

## 选择浏览器

| 浏览器 | 安装方式 |
| --- | --- |
| Chrome、Arc、Brave 等 Chromium 浏览器 | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Microsoft Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari（macOS / iOS） | 从 [SyncNos 源码](https://github.com/chiimagnus/SyncNos)使用 Xcode 构建 |

安装完成后即可本地采集，不要求先连接任何外部同步服务。

## 确认安装成功

1. 打开 SyncNos 扩展。
2. 访问一个要保存的 AI 对话、网页文章或 YouTube / Bilibili 视频页面。
3. 使用 Popup 或页内入口执行一次当前页采集。
4. 在 SyncNos 中打开已保存内容，确认标题和正文 / 对话 / 字幕符合预期。

不同来源并不都使用同一种采集方式。ChatGPT、Google AI Studio、网页文章和视频内容使用手动采集；部分其它 AI 对话站点可按设置自动保存。详见[采集内容](/docs/capture/)。

## 需要 CLI？

普通使用不需要安装 CLI。只有希望让本机自动化或 AI Agent 访问正在运行的 SyncNos 浏览器数据时，才需要继续阅读[使用 CLI 自动化](/docs/cli/)。
