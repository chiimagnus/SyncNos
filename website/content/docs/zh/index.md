---
title: 从这里开始
description: 先完成第一次采集，再按需要阅读、同步、导出或备份。
---

SyncNos 是一款本地优先的浏览器剪藏工具。AI 对话、网页文章和视频内容会先进入浏览器本地库，再由你决定是否同步、导出或备份。

## 先完成一次保存

1. [安装 SyncNos](/docs/install/)。
2. 打开一个要保存的 AI 对话、网页文章或 YouTube / Bilibili 视频页面。
3. 使用 Popup 或页内入口采集当前内容。
4. 回到 SyncNos，确认刚才的内容已经出现在本地库中。

不同来源的自动 / 手动采集规则见[采集内容](/docs/capture/)。完成第一次保存不要求先连接 Notion、Obsidian、飞书或 GitHub。

## SyncNos 的数据怎么流动

```text
浏览器页面
    ↓
SyncNos 本地库
    ├─→ 可选：Notion / Obsidian / 飞书 / GitHub
    ├─→ 可选：Markdown / JSON 导出
    └─→ 可选：Backup ZIP
```

本地库是主记录。外部同步目标、导出文件和 Backup 都从本地数据产生，不是使用 SyncNos 的前提。

## 你接下来想做什么

| 目标 | 去哪里 |
| --- | --- |
| 安装或确认浏览器支持 | [安装](/docs/install/) |
| 了解哪些内容能保存、哪些会自动保存 | [采集内容](/docs/capture/) |
| 阅读、搜索、评论和复用已保存内容 | [使用本地库](/docs/library/) |
| 把内容同步到外部服务 | [同步到外部服务](/docs/sync/) |
| 导出可读文件，或创建恢复用 Backup | [导出与备份](/docs/export-backup/) |
| 让本机自动化或 AI Agent 使用 SyncNos | [使用 CLI 自动化](/docs/cli/) |
| 了解网络请求、凭据和权限 | [隐私与数据](/docs/privacy/) |
| 遇到采集、同步或连接问题 | [排障与常见问题](/docs/faq/) |
