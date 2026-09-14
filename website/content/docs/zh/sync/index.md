---
title: 同步概览
description: 选择 Notion、Obsidian、飞书或 GitHub，并决定手动同步还是自动同步。
---

同步是可选能力。即使一个外部服务都不连接，SyncNos 仍然可以本地采集、阅读、搜索、导出和备份。

## 选择目标

| 目标 | 适合场景 | 连接方式 |
| --- | --- | --- |
| [Notion](/docs/sync/notion/) | 数据库化归档与 Notion 页面 | OAuth |
| [Obsidian](/docs/sync/obsidian/) | 本地 Markdown vault | Local REST API |
| [飞书](/docs/sync/feishu/) | 飞书 DocX / 云文档 | OAuth（Proxy 或 Direct） |
| [GitHub](/docs/sync/github/) | Markdown 仓库与 Git 工作流 | GitHub App Device Flow |

可以只连接一个目标，也可以同时配置多个。每个目标都有独立的开关和配置。

## 手动同步和自动同步

每个外部目标都支持手动同步，并可单独开启自动同步。两种方式使用同一套 Provider 同步流程；自动同步只是改变触发方式，不会把远端服务变成 SyncNos 的主数据库。

如果 ChatGPT 条目引用了尚未本地缓存的图片，SyncNos 可以在同步时临时取得图片，而不要求先永久缓存。图片暂时不可用时，本地正文不会受影响；目标端会按对应 Provider 的能力降级处理图片。

## 同步、导出和 Backup 的区别

- **同步**：持续更新已经配置好的外部服务。
- **Markdown / JSON 导出**：生成可以带走和阅读的本地文件。
- **Backup ZIP**：保存用于恢复 SyncNos 本地状态的数据。

如果你只是想得到一份文件，不需要配置任何同步目标。详见[导出与备份](/docs/export-backup/)。

## 同步失败时

本地内容仍然保留。修复对应目标的连接或权限后，再重新同步即可。

具体配置和排障步骤请进入对应目标页面；网络请求、凭据和授权边界见[隐私与数据](/docs/privacy/)。
