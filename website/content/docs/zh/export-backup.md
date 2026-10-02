---
title: 导出与备份
description: 导出可读文件，或创建以后可以恢复到 SyncNos 的 Backup。
---

- 想拿到普通文件：使用 **Markdown / JSON 导出**
- 想恢复或迁移 SyncNos：使用 **Backup**
- 想持续更新外部服务：[使用同步](/docs/sync/)

## 导出

从本地库选择内容后，可以导出 Markdown 或 JSON ZIP。可用的本地图片会一起导出；图片暂时无法取得时，正文仍会正常导出。

## Backup

打开 **设置 → Backup** 创建恢复包。

普通 Backup 包含可恢复的本地内容和设置，但不包含认证凭据。

迁移到另一台设备或浏览器 Profile 时，可以勾选 **包含私密数据（用于迁移）**。这会把可迁移的登录凭据一并放进 Backup；该选项默认关闭。

Full Backup 不会被 SyncNos 额外加密，请像密码文件一样保管。

## 恢复

导入 Backup 会把数据合并到当前本地库，不会先清空现有内容。
