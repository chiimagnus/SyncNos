---
title: 飞书
description: 配置飞书应用，并把 SyncNos 内容同步到飞书云文档。
---

## 1. 创建飞书应用

在飞书开放平台创建**企业自建应用**，并记下 **App ID**。

把 OAuth 重定向地址设置为：

```text
https://chiimagnus.github.io/syncnos-oauth/callback
```

为应用添加以下权限：

```text
docx:document
docx:document.block:convert
drive:drive
```

以后如果修改权限，需要在 SyncNos 中断开并重新连接飞书。

## 2. 选择连接方式

二选一即可：

- **Proxy**：部署仓库提供的 [OAuth Worker](https://github.com/chiimagnus/SyncNos/tree/main/cloudflare-workers/syncnos-feishu-oauth)，在 SyncNos 中填写 **Proxy URL**，Client Secret 留空
- **Direct**：在 SyncNos 中填写 **Client Secret**，Proxy URL 留空

## 3. 连接 SyncNos

打开 **SyncNos → 设置 → 飞书**：

1. 填写 App ID
2. 填写 Proxy URL 或 Client Secret，二选一
3. 点击 **Connect**，完成飞书授权
4. 按需要选择 AI 对话、网页文章和视频的目标文件夹
5. 执行一次手动同步，确认内容正常写入

确认无误后，再按需要开启自动同步。

## 遇到问题

- `401` / `403`：检查应用权限，然后重新授权
- 无法完成授权：检查 App ID、Redirect URI、应用发布状态，以及 Proxy / Direct 配置
- 同步失败：本地内容仍然保留，修复配置后重新同步即可
