# Feishu DocX 配置

本页是 Feishu 连接、OAuth 部署和验收的唯一长期指南。运行时行为以 `src/services/sync/feishu/**` 为准。

## 1. 创建 Feishu 应用

在 Feishu Open Platform 创建自建应用并取得 App ID / Client ID。OAuth 重定向地址必须包含：

```text
https://chiimagnus.github.io/syncnos-oauth/callback
```

当前扩展请求以下 scope：

```text
docx:document
docx:document.block:convert
drive:drive
```

修改应用权限后应先 Disconnect，再重新 Connect，使新 token 获得更新后的 scope。

## 2. 选择 OAuth 模式

| 模式 | Client Secret 所在位置 | 适用场景 |
| --- | --- | --- |
| Proxy / Cloudflare Worker | Worker secret | 不希望扩展本机保存 Client Secret |
| Direct | 浏览器扩展本地存储 | 自建应用、单租户或本地使用 |

两种模式都会把 OAuth token 保存在扩展本机；token、Client Secret 都不会进入 SyncNos 备份。

### Proxy 模式

仓库内 Worker 位于 `cloudflare-workers/syncnos-feishu-oauth/`。若使用自己的 Feishu 应用，先把 `wrangler.toml` 中的 `FEISHU_CLIENT_ID` 改成对应 App ID，再执行：

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler secret put FEISHU_CLIENT_SECRET
npx wrangler deploy
```

扩展中的 Proxy URL 填 Worker 的 exchange endpoint：

```text
https://<your-worker-host>/feishu/oauth/exchange
```

refresh endpoint 使用同一 Worker 的 `/feishu/oauth/refresh`。

### Direct 模式

在 WebClipper `Settings → Feishu → Advanced` 中填写 App ID 与 App Secret，并留空 Proxy URL。扩展会直接调用 Feishu token endpoint；Client Secret 只保存在本机扩展存储中。

## 3. Connect 与同步

保存设置后点击 `Connect`，在 Feishu 授权页完成授权。连接成功后可以手动同步；如果在设置中显式启用 Feishu auto-sync，本地内容变化也会进入自动同步队列。

目标文件夹可在 Feishu 设置中调整；具体默认值以当前 settings service 为准，不在文档重复维护。

## 4. 验收与排障

至少验证：

- Connect 后回调能完成，pending state 被清理；
- `chat`、`article`、`video` 各能同步一条；
- refresh 后仍能继续同步；
- 文档转换或单张图片失败时有 warning，文本主链路仍可继续；
- Disconnect 后本机 OAuth 状态被清理。

`401/403` 优先检查应用 scope 并重新授权。exchange / refresh 失败时检查 App ID、Client Secret、Proxy URL、应用发布状态和 redirect URI 是否一致。
