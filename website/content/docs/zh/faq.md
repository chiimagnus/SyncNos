---
title: 排障与常见问题
description: 采集、同步或连接遇到问题时，从这里开始。
---

## 采集不完整

- ChatGPT / Claude / Google AI Studio：使用手动保存。
- ChatGPT 高级采集失败：关闭高级采集后重新保存。
- 图片缺失：正文通常已经保存，可稍后用 **缓存图片** 重试。
- 其它 AI 站点未自动保存：确认自动保存已开启，再手动保存一次。

支持范围见[采集内容](/docs/capture/)。

## 快捷键没有生效

打开 **设置 → 快捷键** 查看浏览器当前绑定。未分配时，到浏览器自己的扩展快捷键设置中配置。

## 同步失败

本地内容不会丢失。检查对应目标的连接或权限后重试：[Notion](/docs/sync/notion/)、[Obsidian](/docs/sync/obsidian/)、[飞书](/docs/sync/feishu/)、[GitHub](/docs/sync/github/)。

## 不连接外部服务还能用吗？

可以。采集、阅读、搜索、导出和 Backup 都可以只在本地使用。

## 支持哪些浏览器？

Chrome / Chromium 系、Edge 和 Firefox 有商店版本；Safari（macOS / iOS）可从源码用 Xcode 构建。见[安装](/docs/install/)。

## 内容会自动上传吗？

不会。只有你主动使用需要联网的功能时才会访问对应服务。见[隐私与数据](/docs/privacy/)。

## 更新和反馈

- [GitHub Releases](https://github.com/chiimagnus/SyncNos/releases)
- [GitHub Issues](https://github.com/chiimagnus/SyncNos/issues)
