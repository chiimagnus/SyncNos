---
title: 飞书
description: 配置飞书企业自建应用，通过 OAuth 把本地内容同步到飞书 DocX。
---

## 1. 创建飞书应用

在飞书开放平台创建**企业自建应用**，取得 App ID（Client ID）。

OAuth 重定向地址必须精确配置为：

```text
https://chiimagnus.github.io/syncnos-oauth/callback
```

授予：

```text
docx:document
docx:document.block:convert
drive:drive
```

以后如果修改 scope，请先在 SyncNos 中 Disconnect，再重新 Connect，让飞书签发包含新权限的 token。

## 2. 选择 OAuth 模式

### Proxy

如果不希望把飞书 Client Secret 保存在扩展本机，使用 token-exchange Worker。

仓库提供可自行部署的 Worker：[`cloudflare-workers/syncnos-feishu-oauth`](https://github.com/chiimagnus/SyncNos/tree/main/cloudflare-workers/syncnos-feishu-oauth)。部署后在 SyncNos 中填写对应的 **Proxy URL**，Client Secret 留空。

### Direct

如果你接受 Client Secret 保存在 extension-local storage，可以使用 Direct：填写 Client Secret，并让 Proxy URL 留空。SyncNos 会直接向飞书执行 token 兑换与刷新。

Client Secret 不会进入 SyncNos Backup ZIP。

## 3. 连接 SyncNos

打开 **设置 → 飞书**：

1. 填写 App ID；
2. 只配置一种凭据路径：Proxy URL 或 Client Secret；
3. 点击 **Connect** 并在飞书完成授权；
4. 按需要修改 AI 对话、网页文章和视频内容的目标文件夹。

连接后可以手动同步，也可以独立开启飞书自动同步。

## 排障

- `401` / `403`：检查应用 scope，并重新授权。
- OAuth 兑换或刷新失败：检查 App ID、redirect URI、应用发布状态，以及所选 Proxy / Direct 配置。
- DocX 转换、上传或图片处理失败：本地内容仍然是主记录，可以修复连接后重试同步。
