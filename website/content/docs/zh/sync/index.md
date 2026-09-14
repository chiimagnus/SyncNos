---
title: 同步目标
description: 把本地内容同步到 Notion、Obsidian、飞书或 GitHub。
---

SyncNos 的同步建立在同一份本地数据之上。Provider 是派生目标，不是主数据库。

## 支持的目标

| Provider | 适合场景 | 连接方式 |
| --- | --- | --- |
| [Notion](/docs/sync/notion/) | 数据库化归档与 Notion 页面 | OAuth |
| [Obsidian](/docs/sync/obsidian/) | 本地 Markdown vault | Local REST API |
| [飞书](/docs/sync/feishu/) | 飞书 DocX / 云文档 | OAuth（Proxy 或 Direct） |
| [GitHub](/docs/sync/github/) | Markdown 仓库与 Git 工作流 | GitHub App Device Flow |

各 Provider 可独立开启或关闭，也可以分别配置自动同步。手动同步与自动同步复用相同的 Provider 同步流程。

## 同步与导出不是一回事

同步会更新配置好的外部目标；导出则在本地生成 Markdown / JSON 等文件。Backup ZIP 是另一套完整恢复包，用于备份本地数据与可恢复状态。

如果你只需要可携带文件，不必配置任何 Provider。

## 网络边界

连接外部 Provider 后，执行同步时对应内容会发送到该服务。详细数据流、凭据保存和 Backup 排除规则见[隐私与数据流](/docs/privacy/)。
