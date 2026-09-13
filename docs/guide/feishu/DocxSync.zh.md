# 飞书同步配置

[English](./DocxSync.en.md) | **中文**

使用本指南把 SyncNos 连接到飞书企业自建应用，并把本地内容同步到飞书 DocX。

## 1. 创建飞书应用

在飞书开放平台创建企业自建应用，并取得 App ID（Client ID）。

精确配置以下 OAuth 重定向地址：

```text
https://chiimagnus.github.io/syncnos-oauth/callback
```

授予以下权限：

```text
docx:document
docx:document.block:convert
drive:drive
```

以后修改 scope 时，应先在 SyncNos 中 Disconnect，再重新 Connect，让飞书签发包含新权限的 token。

## 2. 选择 OAuth 模式

### Proxy

不希望把飞书 Client Secret 保存在 Extension 本机时，使用 token-exchange Worker。

仓库自带 Worker：`cloudflare-workers/syncnos-feishu-oauth/`。使用自己的应用时，在 `wrangler.toml` 设置 `FEISHU_CLIENT_ID`，写入 secret 后部署：

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler secret put FEISHU_CLIENT_SECRET
npx wrangler deploy
```

SyncNos 的 **Proxy URL** 填：

```text
https://<your-worker-host>/feishu/oauth/exchange
```

Worker 会使用对应的 `/feishu/oauth/refresh` endpoint 处理刷新。

### Direct

只有在你接受 Client Secret 保存在 extension-local storage 时才使用 Direct。SyncNos 会直接向飞书进行 token 兑换和刷新；Client Secret 不会进入 SyncNos Backup ZIP。

## 3. 连接 SyncNos

打开 **设置 → 飞书**，填写 App ID，然后只配置一种凭据路径：

- **Proxy：**填写 Proxy URL，Client Secret 留空。
- **Direct：**填写 Client Secret，Proxy URL 留空。

点击 **Connect**，在飞书完成授权。目标文件夹也可以在同一设置页修改。

连接后可以手动同步，也可以单独开启自动同步。

## 排障

遇到 `401` / `403` 时先检查应用 scope 并重新授权。OAuth 兑换或刷新失败时，检查 App ID、redirect URI、应用发布状态，以及配置的 Client Secret 或 Worker endpoint。

飞书转换、上传或图片处理失败时，本地内容仍然是主记录。
