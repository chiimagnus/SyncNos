---
title: 同步概览
description: 把本地内容同步到 Notion、Obsidian、飞书或 GitHub。
---

同步是可选的。不连接任何外部服务，也可以正常使用 SyncNos。

## 选择目标

| 目标 | 适合场景 |
| --- | --- |
| [Notion](/docs/sync/notion/) | 用数据库和页面整理内容 |
| [Obsidian](/docs/sync/obsidian/) | 保存到本地 Markdown vault |
| [飞书](/docs/sync/feishu/) | 保存到飞书云文档 |
| [GitHub](/docs/sync/github/) | 保存到 Markdown 仓库 |

可以只连接一个，也可以同时使用多个目标。

## 手动或自动同步

每个目标都可以手动同步，也可以单独开启自动同步。

自动同步只是在保存内容后自动执行同步；本地内容仍然保留在 SyncNos 中。

## 同步、导出和 Backup

- **同步**：持续更新外部服务
- **导出**：生成 Markdown / JSON 文件
- **Backup**：创建以后可以恢复到 SyncNos 的备份

只想拿到文件时，不需要配置同步。见[导出与备份](/docs/export-backup/)。

## 同步失败

本地内容不会因此丢失。修复连接或权限后重新同步即可。
