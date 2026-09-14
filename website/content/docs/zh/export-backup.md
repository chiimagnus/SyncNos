---
title: 导出与备份
description: 导出可读文件，或创建以后可以恢复到 SyncNos 的 Backup。
---

- 想拿到可以长期保存或交给其它工具的文件：使用 **Markdown / JSON 导出**
- 想以后恢复 SyncNos：使用 **Backup**
- 想持续更新 Notion、Obsidian、飞书或 GitHub：[使用同步](/docs/sync/)

## 导出 Markdown / JSON

从本地库选择内容后，可以导出 Markdown 或 JSON。导出结果会打包成 ZIP。

- **Markdown**：适合直接阅读、整理和继续写作
- **JSON**：适合程序处理，并保留更多结构化信息

可用的本地图片会一起导出。图片暂时无法取得时，正文仍然会正常导出。

## 创建 Backup

打开 **设置 → Backup** 创建恢复包。

Backup 会保存可恢复的本地内容，例如已采集内容、缓存图片、评论和高亮，以及非敏感设置。

密码、token、API Key 等认证秘密不会进入 Backup。

## 恢复 Backup

导入 Backup 会把内容合并到当前本地库，不会先清空现有数据。

Backup 主要用于恢复 SyncNos。如果希望长期保留可读数据，建议同时保存 Markdown / JSON 导出。
