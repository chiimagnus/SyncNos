---
title: 常见问题
description: 采集、同步、浏览器兼容、隐私和问题反馈的常见答案。
---

## ChatGPT 为什么不是普通自动保存？

ChatGPT 使用虚拟列表，离开视口的历史轮次可能被卸载。SyncNos 默认使用手动完整采集路径，避免把局部 DOM 错当完整对话。显式开启 Advanced capture 后，手动采集可以使用已验证的当前对话 backend mapping。

Google AI Studio 也因为虚拟列表采用手动完整采集。

## 同步同一个条目会不会不断重复？

Provider 同步维护自己的连续性 / mapping，用于增量更新已同步内容。实际远端语义因 Provider 而异，但不会把“每次点击都新建一份重复内容”作为正常设计。

如果一次同步失败，本地数据仍然保留，可以在修复 Provider 配置后重新执行。

## 不连接 Notion 还能用吗？

可以。SyncNos 的本地采集不依赖 Notion，也不依赖任何其它 Provider。你可以只使用本地阅读、搜索、导出和 Backup。

## 可以只用 Obsidian 吗？

可以。安装 Obsidian Local REST API 后，按 [Obsidian 配置指南](/docs/sync/obsidian/)连接即可。

## 支持哪些浏览器？

Chrome / Chromium 系、Microsoft Edge 和 Firefox 有商店版本；Safari（macOS / iOS）可从源码通过 Xcode 构建。详见[安装](/docs/install/)。

## 我的数据会不会自动上传？

本地采集本身不会把所有保存内容上传到 SyncNos 服务器。外部数据流来自你配置或主动调用的功能，例如 Notion、飞书、GitHub、ChatGPT Advanced capture 或图片缓存。详见[隐私与数据流](/docs/privacy/)。

## 在哪里看更新日志？

以 [GitHub Releases](https://github.com/chiimagnus/SyncNos/releases) 为当前发布记录，不在 Docs 里维护第二份 ChangeLog。

## 如何反馈 Bug 或功能建议？

请在 [GitHub Issues](https://github.com/chiimagnus/SyncNos/issues) 提交。尽量包含浏览器、SyncNos 版本、复现步骤以及不含敏感数据的错误信息。
