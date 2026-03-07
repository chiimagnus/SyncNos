# 存储

## 存储总览
SyncNos 的“存储”不是一个数据库，而是多层事实源并存：**App 侧**用 SwiftData + UserDefaults + Keychain 维护缓存、偏好和敏感数据；**WebClipper 侧**用 IndexedDB + `chrome.storage.local` + Zip v2 备份维护本地会话与设置；**Notion / Obsidian / 导出文件**则是派生产物，而不是所有场景下的事实源。

| 存储面 | 产品线 | 介质 | 保存内容 | 主要入口 |
| --- | --- | --- | --- | --- |
| SwiftData store 文件 | SyncNos App | `Application Support/SyncNos/*.store` | WeRead、Dedao、Chats、WebArticle、已同步高亮等缓存 | `Services/**/*CacheService.swift` |
| UserDefaults | SyncNos App | macOS 偏好 | onboarding、自动同步、IAP 状态、提醒态、试用期辅助信息 | `SyncNosApp.swift`, `IAPService.swift` |
| Keychain | SyncNos App | 系统安全存储 | 站点 Cookie、加密密钥、首次启动 / 设备指纹备份、Notion OAuth 相关敏感信息 | `SiteLoginsStore.swift`, `EncryptionService.swift`, `IAPService.swift` |
| IndexedDB | WebClipper | 浏览器本地数据库 | conversations、messages、sync_mappings | `schema.ts`, `storage-idb.ts` |
| `chrome.storage.local` | WebClipper | 本地 KV | Notion / Obsidian / inpage / 备份辅助设置 | SettingsScene controller、settings stores |
| Zip v2 备份 | WebClipper | 本地压缩包 | conversations CSV、分源 JSON、storage-local.json、manifest | `backup/export.ts`, `backup/import.ts` |
| 外部结果 | 双产品线 | Notion / Obsidian / 文件系统 | 页面、数据库、Markdown、vault 文件 | sync orchestrators / export |

## SyncNos App：SwiftData store 文件

| store 文件 | 路径 | 服务 | 说明 |
| --- | --- | --- | --- |
| `weread.store` | `Application Support/SyncNos/` | `WeReadCacheService` | 微信读书书籍、高亮与同步状态 |
| `dedao.store` | `Application Support/SyncNos/` | `DedaoCacheService` | 得到内容缓存 |
| `chats_v3_minimal.store` | `Application Support/SyncNos/` | `ChatCacheService` | 聊天截图、会话、消息；**不再保存 OCR 原始 JSON** |
| `web_article_cache.store` | `Application Support/SyncNos/` | `WebArticleCacheService` | 网页正文缓存与内容版本 |
| `synced-highlights.store` | `Application Support/SyncNos/` | `SyncedHighlightStore` | 已同步高亮映射，避免重复遍历 Notion children |

- App 自己维护的是“运行缓存”和“同步映射”，而不是 Apple Books / GoodLinks 原始数据库本身。
- `WebArticleCacheService` 通过 `contentVersion = 5` 做缓存失效，而不是按时间过期。
- `ChatCacheService` 当前是明确写在代码里的破坏性升级：v3 minimal store 删除 OCR 原始 JSON 字段，旧数据需要重新导入。

## SyncNos App：轻量状态与敏感数据

| 类别 | 位置 | 代表键 / 服务 | 说明 |
| --- | --- | --- | --- |
| 引导与自动同步 | UserDefaults | `hasCompletedOnboarding`, `debug.forceOnboardingEveryLaunch`, `autoSync.*` | 控制启动行为和入口门控 |
| IAP / 试用期 | UserDefaults + Keychain | `syncnos.first.launch.date`, `syncnos.device.fingerprint`, `syncnos.has.shown.welcome` | 兼顾 UI 读取速度与卸载 / 重装后的持久性 |
| 站点登录态 | Keychain | `SyncNos.SiteLogins` / `SiteLoginsCookieHeaderByDomainV1` | 统一按 domain 保存 Cookie Header，并做 legacy migration |
| 聊天加密密钥 | Keychain | `com.syncnos.encryption` / `chats.aes.key` | AES-256-GCM 密钥，本地安全使用 |
| Notion OAuth 相关敏感信息 | Keychain / config store | `NotionOAuthConfig`、token store | 避免凭据明文散落 |

- `SiteLoginsStore` 采用延迟加载：直到真正读取 cookie 时才访问 Keychain，并在第一次加载时迁移旧 service / account。
- `IAPService` 采用“双写”策略：UserDefaults 负责快速 UI 判断，Keychain 帮助跨卸载保留首次启动 / 设备指纹等信息。

## WebClipper：IndexedDB 与 `chrome.storage.local`

| 存储层 | 名称 / 版本 | 结构 | 作用 |
| --- | --- | --- | --- |
| IndexedDB | `webclipper`, `DB_VERSION = 3` | `conversations`, `messages`, `sync_mappings` | 扩展侧事实源 |
| `conversations` | object store | `sourceType`, `source`, `conversationKey`, `title`, `url`, `lastCapturedAt`, `notionPageId` 等 | 列表、详情、同步入口 |
| `messages` | object store | `conversationId`, `messageKey`, `contentText`, `contentMarkdown`, `sequence`, `updatedAt` | 生成 Markdown / blocks / note 内容 |
| `sync_mappings` | object store | `notionPageId`, `lastSyncedMessageKey`, `lastSyncedSequence`, `lastSyncedAt`, `updatedAt` | 决定是否能增量同步 |
| `chrome.storage.local` | KV | `inpage_supported_only`, `notion_parent_page_id`, `notion_parent_page_title`, Obsidian settings, Notion AI 偏好等 | 保存非敏感运行设置 |

- `storage-idb.ts` 的 `syncConversationMessages()` 采用快照式同步：存在的消息 upsert，不再出现的消息从本地删除。
- `deleteConversationsByIds()` 会一并删除 conversation、messages 和 `sync_mappings`，防止 UI 已删但 Notion mapping 仍残留。
- `schema.ts` 的 v3 迁移专门处理 NotionAI thread，把 legacy conversation key 重写为 stable key，并同步迁移 mapping。

## 备份、导出与外部落点

| 产物 | 位置 / 目标 | 生成方 | 说明 |
| --- | --- | --- | --- |
| Zip v2 备份 | 用户本地 zip 文件 | WebClipper | 固定包含 `manifest.json`, `config/storage-local.json`, `sources/conversations.csv`, `sources/*.json` |
| Markdown 导出 | 用户本地文件系统 | WebClipper | 从本地会话派生，支持单文件 / 多文件 |
| Obsidian 笔记 | 本地 vault | WebClipper | chat 与 article 默认写到不同目录 |
| Notion 页面 / 数据库 | 用户 Parent Page | App + WebClipper | 最终交付物，不替代本地事实源 |

- `backup-utils.ts` 会排除 `notion_oauth_token_v1`、`notion_oauth_client_secret`，并排除任何以 `notion_oauth_token` 开头的键。
- `import.ts` 是“merge import”，不是暴力覆盖：它会尽量保留本地已有 mapping / cursor / 非空字段，只在缺失时补充导入值。

## 迁移与演进

| 场景 | 位置 | 变化 | 影响 |
| --- | --- | --- | --- |
| Chats v3 minimal | `ChatCacheService.swift` | 移除 OCR 原始 JSON 字段，改用新 store 文件 | 历史 OCR 原始缓存不再保留，需要重导 |
| Web article cache versioning | `WebArticleCacheService.swift` | `contentVersion = 5` | 抽取策略升级时旧缓存自动 miss |
| NotionAI stable key migration | `schema.ts`, `schema-migration.test.ts` | 统一 conversation key 与 canonical URL | 避免旧 threadId / URL 导致重复会话 |
| Mapping 跟随 stable key | `schema-migration.test.ts` | `sync_mappings` 一起迁移 | 保持增量同步连续性 |
| Unified site logins | `SiteLoginsStore.swift` | 从旧 WeRead / Dedao / GoodLinks key 迁到统一域名表 | 减少多来源各自维护登录态 |

## 常见风险与排查点

| 风险 | 位置 | 现象 | 首查入口 |
| --- | --- | --- | --- |
| Keychain 读取 / 迁移失败 | App | 登录态、试用期、加密密钥异常 | `SiteLoginsStore.swift`, `IAPService.swift`, `EncryptionService.swift` |
| IndexedDB 迁移异常 | WebClipper | 升级后会话重复、mapping 丢失 | `schema.ts`, `schema-migration.test.ts` |
| article 缓存老化 | App | URL 缓存命中却内容不对 | `WebArticleCacheService.swift` |
| 备份导出泄露敏感信息 | WebClipper | backup 包出现 token | `backup-utils.ts` |
| 删除会话后仍保留旧 mapping | WebClipper | 本地删了但同步逻辑仍误判已关联 | `storage-idb.ts` |

## 示例片段
### 片段 1：WebClipper 的本地数据库名称与版本是固定契约
```ts
export const DB_NAME = 'webclipper';
export const DB_VERSION = 3;
```

### 片段 2：App 网页缓存用内容版本控制失效，而不是 TTL
```swift
private var currentContentVersion: Int {
    5
}
```

## 来源引用（Source References）
- `SyncNos/Services/Auth/IAPService.swift`
- `SyncNos/Services/SiteLogins/SiteLoginsStore.swift`
- `SyncNos/Services/DataSources-From/Chats/ChatCacheService.swift`
- `SyncNos/Services/WebArticle/WebArticleCacheService.swift`
- `SyncNos/Models/Sync/SyncedHighlightRecord.swift`
- `Extensions/WebClipper/src/platform/idb/schema.ts`
- `Extensions/WebClipper/src/conversations/data/storage-idb.ts`
- `Extensions/WebClipper/src/sync/backup/export.ts`
- `Extensions/WebClipper/src/sync/backup/import.ts`
- `Extensions/WebClipper/src/sync/backup/backup-utils.ts`
- `Extensions/WebClipper/tests/storage/schema-migration.test.ts`
