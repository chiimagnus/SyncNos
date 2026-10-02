---
title: 飞书
description: 配置飞书应用，并把 SyncNos 内容同步到飞书云文档。
---

## 1. 创建飞书应用

在飞书开放平台创建**企业自建应用**，记下 **App ID**，并配置重定向地址：

```text
https://chiimagnus.github.io/SyncNos/syncnos-oauth/callback/
```

添加权限：

```text
docx:document
docx:document.block:convert
drive:drive
```

修改权限后需要重新授权。

## 2. 选择连接方式

- **Proxy**：部署仓库提供的 [OAuth Worker](https://github.com/chiimagnus/SyncNos/tree/main/cloudflare-workers/syncnos-feishu-oauth)，填写 Proxy URL，Client Secret 留空。
- **Direct**：填写 Client Secret，Proxy URL 留空。

## 3. 连接 SyncNos

在 **SyncNos → 设置 → 飞书** 中：

1. 填写 App ID。
2. 填写 Proxy URL 或 Client Secret。
3. 点击 **Connect** 完成授权。
4. 选择需要的目标文件夹。
5. 手动同步一次确认结果。

确认正常后再按需开启自动同步。

## 遇到问题

- `401` / `403`：检查应用权限并重新授权。
- 无法授权：检查 App ID、Redirect URI、应用发布状态和连接方式。
- 同步失败：修复配置后重新同步；本地内容不会丢失。
