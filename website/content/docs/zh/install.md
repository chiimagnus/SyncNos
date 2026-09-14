---
title: 安装
description: 安装 SyncNos 浏览器扩展，并按需启用本机 CLI。
---

## 浏览器扩展

| 浏览器 | 安装方式 |
| --- | --- |
| Chrome、Arc、Brave 等 Chromium 浏览器 | [Chrome Web Store](https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok) |
| Microsoft Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/syncnos-webclipper/) |
| Safari（macOS / iOS） | 从 [SyncNos 源码](https://github.com/chiimagnus/SyncNos)使用 Xcode 构建 |

安装完成后即可进行本地采集，不要求先连接任何外部同步服务。

## 第一次使用

1. 打开 SyncNos 扩展。
2. 访问一个支持的 AI 对话、网页文章或 YouTube / Bilibili 视频页。
3. 使用 Popup 或页内入口执行当前页采集。
4. 在 SyncNos 中打开已保存内容确认结果。

不同来源的自动/手动采集边界见[采集内容](/docs/capture/)。

## 可选：安装本机 CLI

CLI 面向自动化和 AI Agent，不是使用浏览器扩展的必需项。

```bash
npm install -g @chiimagnus/syncnos@latest
syncnos install
syncnos doctor
```

随后在需要暴露给 CLI 的浏览器 Profile 中开启 **设置 → 通用 → 本地 CLI 集成 → SyncNos CLI**。执行 CLI 业务命令时，对应浏览器 Profile 需要保持运行。

完整说明见[本机 CLI](/docs/cli/)。
