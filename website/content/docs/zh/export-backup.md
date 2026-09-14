---
title: 导出与备份
description: 选择 Markdown / JSON 导出，或创建用于恢复 SyncNos 的 Backup ZIP。
---

导出和 Backup 解决的是两件不同的事：**导出给人和其它工具使用，Backup 给 SyncNos 自己恢复。**

| 需求 | 应该使用 |
| --- | --- |
| 想长期保留可读文件，或交给其它工具处理 | Markdown / JSON 导出 |
| 想恢复 SyncNos 本地内容和可恢复状态 | Backup ZIP |
| 想让外部服务持续跟随本地内容更新 | [同步到外部服务](/docs/sync/) |

## 导出 Markdown / JSON

从本地库选择内容后，可以导出 Markdown 或 JSON。导出结果以 ZIP 交付，并按所选条目生成对应文件。

正文已经引用的本地缓存图片会在可用时一起放进 ZIP。如果选中的 ChatGPT 条目仍有未缓存图片，SyncNos 可以在导出时使用当前 ChatGPT 登录状态临时获取；这不会把图片永久加入本地缓存。图片无法取得时，正文仍会正常导出，对应图片会显示为不可用，而不会把内部引用泄漏到导出文件。

Markdown 更适合直接阅读和继续写作；JSON 更适合程序化处理，并保留结构化的类型、来源、时间和附件信息。

## 创建 Backup ZIP

在 **设置 → Backup** 中可以导出恢复包。Backup 可以包含：

- 本地采集内容；
- 可恢复的同步 mapping；
- 已缓存图片；
- 文章评论 / 高亮；
- 非敏感设置。

认证秘密不会进入 Backup，例如 Provider access / refresh token、Client Secret、Obsidian API Key、GitHub Device Flow 凭据，以及设备 / 浏览器 Profile 特定的 CLI 身份与启用状态。

## 恢复 Backup

Backup 导入采用 merge restore，而不是先清空当前数据库再覆盖。同一份 Backup 重复导入应保持幂等，不应该因为重复导入制造两份相同内容。

Backup 是 SyncNos 的恢复格式，不是长期稳定的通用归档格式；旧 Backup schema 不保证一直可被未来版本读取。如果你的目标是长期可读或交给其它软件，优先保留 Markdown / JSON 导出。

完整的网络与凭据边界见[隐私与数据](/docs/privacy/)。
