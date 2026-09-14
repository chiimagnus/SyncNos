---
title: 排障与常见问题
description: 采集不完整、同步失败、连接错误、浏览器兼容和反馈入口。
---

## 采集结果不完整怎么办？

如果是 ChatGPT 或 Google AI Studio，请使用手动当前页采集。它们使用虚拟列表，离开视口的历史轮次可能不在当前 DOM 中，因此 SyncNos 不把它们当作普通自动保存来源。

其它支持自动保存的 AI 站点如果没有持续保存，先确认自动保存设置已开启，再尝试一次手动采集以确认当前页面是否能正常解析。完整支持范围见[采集内容](/docs/capture/)。

## 同步失败怎么办？

同步失败不会删除本地原始内容。先修复对应目标的连接、权限或配置，再重新执行同步。

- [Notion 配置](/docs/sync/notion/)
- [Obsidian 配置与 `Failed to fetch` / `401` / `403` 排障](/docs/sync/obsidian/)
- [飞书 OAuth / scope / DocX 排障](/docs/sync/feishu/)
- [GitHub App / 仓库 / 分支配置](/docs/sync/github/)

## 同步同一个条目会不会不断重复？

Provider 同步维护自己的 continuity / mapping，用于后续更新已经同步的内容。正常设计不是“每次点击都新建一份重复内容”。

如果一次结果未知，不要盲目连续重试；先检查当前本地和远端状态，再决定下一步。

## 不连接 Notion 或其它 Provider 还能用吗？

可以。SyncNos 的本地采集、阅读、搜索、导出和 Backup 都不依赖 Notion，也不要求连接其它 Provider。你也可以只使用其中一个同步目标。

## 支持哪些浏览器？

Chrome / Chromium 系、Microsoft Edge 和 Firefox 有商店版本；Safari（macOS / iOS）可从源码通过 Xcode 构建。详见[安装](/docs/install/)。

## 我的内容会自动上传吗？

不会因为“保存到本地库”这一动作就自动把所有内容上传到 SyncNos 服务器。外部数据流来自你配置或主动调用的功能，例如 Provider 同步、ChatGPT Advanced capture 或图片缓存。详见[隐私与数据](/docs/privacy/)。

## 在哪里看更新和反馈问题？

- 发布记录：[GitHub Releases](https://github.com/chiimagnus/SyncNos/releases)
- Bug 与功能建议：[GitHub Issues](https://github.com/chiimagnus/SyncNos/issues)

提交问题时尽量包含浏览器、SyncNos 版本、复现步骤，以及不含敏感数据的错误信息。
