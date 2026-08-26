# 飞书 DocX 同步配置指南（WebClipper）

[English](./DocxSync.en.md) | **中文**

本指南负责 SyncNos WebClipper 同步到飞书 DocX 的用户配置步骤；运行时行为仍以 `src/services/sync/feishu/**` 为准。

## 准备条件

- 一个可以创建或管理应用的飞书账号。
- 待同步内容已经先保存到 SyncNos WebClipper 本地。

## 1. 创建飞书应用

在飞书开放平台创建企业自建应用，取得 App ID（Client ID），并精确配置以下 OAuth 重定向地址：

```text
https://chiimagnus.github.io/syncnos-oauth/callback
```

当前扩展请求的 scope 为：

```text
docx:document
docx:document.block:convert
drive:drive
```

修改应用权限后，应先在 SyncNos 中 Disconnect，再重新 Connect，使新 token 获得更新后的 scope。

## 2. 选择一种 OAuth 模式

### Proxy / Cloudflare Worker

如果不希望把飞书 Client Secret 保存在浏览器扩展本机，使用此模式。扩展把 OAuth code 或 refresh token 发给配置的 Worker，由 Worker 向飞书完成 token 兑换或刷新。

仓库内 Worker 位于：

```text
cloudflare-workers/syncnos-feishu-oauth/
```

使用自己的飞书应用时，先把 `wrangler.toml` 中的 `FEISHU_CLIENT_ID` 设置为对应 App ID，然后写入 secret 并部署：

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler secret put FEISHU_CLIENT_SECRET
npx wrangler deploy
```

WebClipper 中的 Proxy URL 填 exchange endpoint：

```text
https://<your-worker-host>/feishu/oauth/exchange
```

refresh endpoint 使用同一 Worker 下的 `/feishu/oauth/refresh`。

### Direct

如果使用自己管理的飞书应用，并能接受 Client Secret 保存在扩展本机，可以使用 Direct 模式。SyncNos 会直接向飞书发送 token 兑换与刷新请求。

Client Secret 属于本机凭据，不会进入 SyncNos 备份。

## 3. 在 WebClipper 中连接

1. 打开 WebClipper → `Settings` → `Feishu`。
2. 在飞书设置卡片中填写 App ID / Client ID。
3. 二选一：
   - Proxy：填写 Worker exchange URL，Client Secret / App Secret 留空。
   - Direct：填写 Client Secret / App Secret，Proxy URL 留空。
4. 修改字段后离开输入框或按 Enter 即会保存；当前页面没有单独的 `Advanced` 展开步骤或 `Save` 按钮。
5. 点击右上角的 `Connect`，在飞书授权页完成授权。

连接成功后始终可以手动同步；如果显式开启 Feishu auto-sync，本地内容变化也可以进入该 provider 的自动同步队列。

目标文件夹可以在 SyncNos 设置中调整；当前默认值由 settings service 维护，不在本指南重复手抄。

## 4. 验收与排障

至少验证一条 `chat`、`article`、`video` 均可同步，并确认 token refresh 后仍可继续同步、Disconnect 后本机 OAuth 状态被清理。

遇到 `401` / `403` 时先检查应用 scope 并重新授权。exchange / refresh 失败时检查 App ID、Client Secret 或 Worker secret、Proxy URL、应用发布状态与 redirect URI。

文档转换或单张图片失败可能产生 warning，但不应让已经保存到本地的源内容丢失。