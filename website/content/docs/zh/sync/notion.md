---
title: Notion
description: 通过 OAuth 连接 Notion，并在选定 Parent Page 下管理 SyncNos 内容。
---

## 连接 Notion

1. 打开 **SyncNos → 设置 → Notion**。
2. 点击 **Connect**，在 Notion 完成 OAuth 授权。
3. 授权完成后，从 SyncNos 中选择要使用的 **Parent Page**。
4. 开始手动同步；如有需要，再单独开启自动同步。

SyncNos 只会看到你通过 Notion 授权明确开放给集成的内容。

## Parent Page 与数据库

SyncNos 会在你选定的 Parent Page 下查找或创建它管理的内容数据库，并按 AI 对话、网页文章和视频内容使用对应的受管结构。

这些数据库的受管字段和 section 由 SyncNos 维护。正常使用不需要手工创建或修改 schema。

如果你更换 Parent Page，SyncNos 会重新解析对应目标，而不是继续盲用旧页面下缓存的数据库 ID。

## OAuth 与凭据

Notion OAuth 使用 token-exchange proxy，以避免把官方 Client Secret 打包进浏览器扩展。Proxy 处理 OAuth 兑换数据，不接收你要同步的对话、文章或视频正文。

Notion token 保存在浏览器扩展的本地存储中，并从 SyncNos Backup ZIP 中排除。

## 撤销访问

- 在 SyncNos 中 **Disconnect**：清理扩展本地的 Notion 连接状态。
- 如需在 Notion 一侧撤销授权，请在 Notion 的连接设置中撤销 SyncNos 集成。

## 同步失败时

本地数据库始终是主记录。Notion API、图片上传或页面写入失败不会把本地原始内容替换成远端状态；修复连接后可以重新执行同步。
