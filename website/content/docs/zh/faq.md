---
title: 排障与常见问题
description: 采集、同步或连接遇到问题时，从这里开始。
---

## 采集不完整怎么办？

- **ChatGPT / Google AI Studio**：使用手动保存
- **ChatGPT 高级采集失败**：关闭高级采集后重新保存
- **图片缺失**：正文通常已经保存，可以稍后使用**缓存图片**重试
- **其它 AI 站点没有自动保存**：先确认自动保存已开启，再尝试一次手动保存

支持范围见[采集内容](/docs/capture/)。

## 同步失败怎么办？

本地内容不会因为同步失败而丢失。修复连接或权限后重新同步即可。

- [Notion](/docs/sync/notion/)
- [Obsidian](/docs/sync/obsidian/)
- [飞书](/docs/sync/feishu/)
- [GitHub](/docs/sync/github/)

## 同一个条目会重复同步吗？

正常情况下不会。SyncNos 会继续更新之前同步的内容，而不是每次都新建一份。

如果不确定某次同步是否成功，先检查目标端，再决定是否重试。

## 不连接外部服务还能用吗？

可以。采集、阅读、搜索、导出和 Backup 都可以只在本地使用。

## 支持哪些浏览器？

Chrome / Chromium 系、Microsoft Edge 和 Firefox 有商店版本。Safari（macOS / iOS）可以从源码通过 Xcode 构建。

安装入口见[安装](/docs/install/)。

## 内容会自动上传吗？

不会。保存到本地库本身不会把内容上传到 SyncNos 服务器。

只有你主动使用同步、高级采集、图片缓存等需要联网的功能时，才会访问对应服务。详见[隐私与数据](/docs/privacy/)。

## 在哪里看更新或反馈问题？

- [GitHub Releases](https://github.com/chiimagnus/SyncNos/releases)：查看发布记录
- [GitHub Issues](https://github.com/chiimagnus/SyncNos/issues)：报告 Bug 或提出建议

报告问题时，尽量附上浏览器、SyncNos 版本、复现步骤和不含敏感信息的错误内容。
