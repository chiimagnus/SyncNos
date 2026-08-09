# Feishu DocX 配置

运行时契约以 `src/services/sync/feishu/` 为准。本页只保留部署与验收步骤。

## 选择模式

| 模式 | secret 位置 | 用途 |
| --- | --- | --- |
| 官方应用 + Cloudflare Worker | Worker secret | 公共发行，扩展不持有 secret。 |
| 用户自建应用 | 本机扩展存储 | 单租户/内部使用；不得记录或备份 secret。 |

在飞书开放平台创建应用，配置代码中 OAuth 模块定义的 redirect URI，并启用 DocX、DocX Convert 与 Drive 权限。权限变化后必须 Disconnect 再 Connect，令牌才会获得新 scope。

## 部署官方 Worker

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler secret put FEISHU_CLIENT_SECRET
npx wrangler deploy
```

`FEISHU_CLIENT_ID` 由 Worker 配置提供；secret 只用 `wrangler secret` 写入。扩展可在构建时通过 `SYNCNOS_FEISHU_OAUTH_CLIENT_ID` 和 `SYNCNOS_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL` 注入官方默认值，首次启动不会覆盖用户自定义值。

## 验收

- Connect 后 state 被清理，token 可用。
- `chat`、`article`、`video` 各同步一条；路径不存在时能创建。
- Convert 或单张图片失败只产生 warning，文本仍可写入。
- refresh 后可继续同步；删除目标 DocX 后再次同步会重建 mapping。
- Disconnect 会清理 token、pending state、last error 与 job 状态。

`401/403` 优先检查 scope 并重新授权；exchange/refresh 失败检查 Worker URL、secret、应用发布状态和 redirect URI。
