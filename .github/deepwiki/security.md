# 安全模型（Security）

macOS/ 历史资料已归档；本页仅保留 WebClipper 的凭据、备份与发布安全模型。

## 安全范围
本页描述仓库内可验证的安全实践：凭据管理、备份边界、扩展权限、OAuth 交换、发布链路校验。

> 若需先理解业务影响面，先读 [business-context.md](business-context.md)。

## 敏感数据面与落点

| 数据类型 | 产生侧 | 存储位置 | 安全策略 |
| --- | --- | --- | --- |
| Notion OAuth token（扩展） | WebClipper | `chrome.storage.local`（token store） | 备份时显式排除 `notion_oauth_token*` |
| Notion OAuth client secret（扩展） | 用户配置/worker secret | 本地仅短期使用；worker 侧 secret | `ensureDefaultNotionOAuthClientId()` 会移除本地 secret |
| 会话与消息内容（扩展） | WebClipper | IndexedDB | 仅本地事实源，外发需用户触发 |
| 备份包 | WebClipper | 本地 Zip v2 文件 | denylist + 路径安全校验 + schema 校验 |

## 扩展权限与最小化原则

| 权限类型 | 当前配置 | 风险点 | 控制措施 |
| --- | --- | --- | --- |
| `permissions` | `storage/contextMenus/tabs/webNavigation/activeTab/scripting` | 过度权限可能扩大攻击面 | 仅保留采集与同步所需能力 |
| `host_permissions` | 支持站点 + Notion + `http(s)://*/*` | 覆盖面广 | 运行时再由 `inpage_display_mode` 与支持站点 gating 控制实际启用；`markdown_reading_profile_v1` / `anti_hotlink_rules_v1` 只是本地设置，不会引入额外 host 权限 |
| `web_accessible_resources` | 仅 `icon-128.png` 图标资源 | 跨站资源暴露 | 限定 `resources` 与 `matches` |

## OAuth 与令牌交换安全

| 环节 | 实现 | 安全控制 |
| --- | --- | --- |
| 授权入口 | `getNotionOAuthDefaults()` | 固定授权 URL、固定 redirect URI |
| state 校验 | `handleNotionOAuthCallbackNavigation()` | 必须匹配 `notion_oauth_pending_state` |
| 令牌交换 | Cloudflare Worker `/notion/oauth/exchange` | `POST` + JSON 校验 + 12s 超时 |
| 速率限制 | worker `bestEffortRateLimit` | 单 IP 10 分钟最多 30 次 |
| 凭据管理 | `wrangler secret` | `NOTION_CLIENT_SECRET` 不入仓 |

## 备份与导入安全控制

| 控制点 | 文件 | 说明 |
| --- | --- | --- |
| 敏感键排除 | `src/services/sync/backup/backup-utils.ts` | denylist 排除 `notion_oauth_token*`、`notion_oauth_client_secret` |
| Zip 路径安全 | `src/services/sync/backup/backup-utils.ts`, `src/services/sync/backup/zip-utils.ts` | 拒绝 `..`、绝对路径、NUL 字符等危险 entry |
| manifest/schema 校验 | `src/services/sync/backup/backup-utils.ts` | 校验 `backupSchemaVersion`、sources、assets、扩展名 |
| 导入合并策略 | `src/services/sync/backup/import.ts` | merge import，优先保留本地有效字段，避免误覆盖 |
| 资产回退策略 | `src/services/sync/backup/import.ts` | 缺失图片 blob 时回退到 URL/占位图，不写入无效数据 |

## 供应链与发布校验

| 校验点 | 位置 | 作用 |
| --- | --- | --- |
| tag 规则 `v*` | `webclipper-*.yml` | 统一发布触发入口 |
| `manifest.version` 对齐 tag | `webclipper-amo/cws/edge` workflows | 防止“代码版本/发布版本”错位 |
| Node 版本策略 | `webclipper-ci.yml` 使用 `actions/setup-node@v5` + `node-version: 22`；发布 workflows 使用 `node-version: 20` | 区分开发验证与渠道发布环境，降低构建漂移 |
| Firefox 特定补丁 | `package-release-assets.mjs` | 满足 AMO 校验要求 |

## 已知边界与待增强项

- 扩展 `host_permissions` 仍较宽，当前依赖运行时 gating 控制行为；后续可继续评估细化范围。
- `anti_hotlink_rules_v1` 只是本地 referer 映射，不会把图片来源扩展成新的远程可信域名单；命中规则后仍按本地缓存链路处理，不应绕过备份/导入的敏感键排除策略。
- Cloudflare worker 采用 `Access-Control-Allow-Origin: *` 以满足扩展调用便捷性，需要配合严格的路径/方法校验与限流。

## 更新记录（Update Notes）
- 2026-04-16：将 Node 版本策略明确为 CI 22 / 发布 20，并与依赖页、发布页保持一致。

## 来源引用（Source References）
- `webclipper/wxt.config.ts`
- `webclipper/src/services/sync/notion/auth/oauth.ts`
- `webclipper/src/services/sync/notion/auth/token-store.ts`
- `webclipper/cloudflare-workers/syncnos-notion-oauth/index.ts`
- `webclipper/cloudflare-workers/syncnos-notion-oauth/wrangler.toml`
- `webclipper/src/services/sync/backup/backup-utils.ts`
- `webclipper/src/services/sync/backup/import.ts`
- `webclipper/src/services/sync/backup/zip-utils.ts`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
- `.github/workflows/webclipper-edge-publish.yml`
