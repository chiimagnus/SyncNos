# 存储

## 存储总览
SyncNos 的“存储”不是单一数据库，而是三层并存：App 侧的 SwiftData / UserDefaults / Keychain，WebClipper 侧的 IndexedDB / `chrome.storage.local` / Zip 备份，以及 Notion / Obsidian / Release 产物这类外部结果面。

| 存储面 | 产品线 | 技术 / 介质 | 保存内容 | 主要入口 |
| --- | --- | --- | --- | --- |
| SwiftData store 文件 | SyncNos App | `Application Support/SyncNos/*.store` | WeRead、Dedao、Chats、WebArticle、已同步高亮等缓存 | `SyncNos/Services/**/*CacheService.swift` |
| UserDefaults | SyncNos App | macOS 本地偏好 | 自动同步开关、调试引导、IAP 缓存、欢迎态、提醒态 | `SyncNos/SyncNosApp.swift`, `Services/Auth/IAPService.swift` |
| Keychain | SyncNos App | macOS Keychain | 站点 Cookie、聊天加密密钥、试用期备份数据、设备指纹等敏感信息 | `SiteLoginsStore.swift`, `EncryptionService.swift`, `IAPService.swift` |
| IndexedDB | WebClipper | 浏览器本地数据库 | conversations、messages、sync mappings | `Extensions/WebClipper/src/platform/idb/schema.ts` |
| `chrome.storage.local` | WebClipper | 浏览器本地 KV | 非敏感设置、inpage 开关、同步配置 | `Extensions/WebClipper/AGENTS.md` |
| Zip v2 备份 | WebClipper | 用户导出文件 | 会话 CSV、分源文件、`storage-local.json` | `Extensions/WebClipper/AGENTS.md` |
| 外部目标 | 双产品线 | Notion / Obsidian / 文件系统 | 页面、数据库、Markdown、vault 文件 | `.github/docs/business-logic.md`, `.github/guide/obsidian/LocalRestAPI.zh.md` |

## SyncNos App：本地持久化
| 存储文件 | 位置 | 负责模块 | 内容 |
| --- | --- | --- | --- |
| `weread.store` | `Application Support/SyncNos/` | `WeReadCacheService` | 微信读书书籍、高亮与同步状态缓存。 |
| `dedao.store` | `Application Support/SyncNos/` | `DedaoCacheService` | 得到书籍、高亮与同步状态缓存。 |
| `chats_v3_minimal.store` | `Application Support/SyncNos/` | `ChatCacheService` | 对话、截图、消息；不再保留 OCR 原始 JSON。 |
| `web_article_cache.store` | `Application Support/SyncNos/` | `WebArticleCacheService` | 网页抓取缓存与内容版本号。 |
| `synced-highlights.store` | `Application Support/SyncNos/` | `SyncedHighlightRecord` | 已同步高亮映射，避免重复遍历 Notion children。 |

- 这些 store 都通过 `URL.applicationSupportDirectory.appendingPathComponent("SyncNos")` 落到应用支持目录，不与系统外部数据源混存。
- Apple Books / GoodLinks 本身依赖用户授权的外部数据库路径，它们是“来源库”，不是 SyncNos 自己维护的缓存库。
- App 启动时会显式预热 WeRead 缓存与 SyncedHighlightStore，以减少首次同步时的容器冷启动成本。

## SyncNos App：轻量状态与敏感数据
| 类别 | 位置 | 典型键 / 服务名 | 用途 |
| --- | --- | --- | --- |
| 自动同步与引导 | UserDefaults | `autoSync.appleBooks`, `autoSync.goodLinks`, `autoSync.weRead`, `debug.forceOnboardingEveryLaunch` | 决定启动后行为与 Debug 引导。 |
| 订阅 / 试用期缓存 | UserDefaults + Keychain | `syncnos.first.launch.date`, `syncnos.device.fingerprint`, `syncnos.has.shown.welcome` | 试用期、设备指纹与欢迎态。 |
| 站点登录态 | Keychain | `SyncNos.SiteLogins` / `SiteLoginsCookieHeaderByDomainV1` | 按 domain 保存 Cookie Header，并做旧 key 迁移。 |
| 聊天加密密钥 | Keychain | `com.syncnos.encryption` / `chats.aes.key` | AES-256-GCM 密钥，只在设备解锁时可访问。 |
| Notion OAuth 配置 | Keychain + 默认配置 | `NotionOAuthConfig` 优先读 Keychain | 支持自定义 Client ID 或默认回退。 |

- `SiteLoginsStore` 采用延迟加载：只有真正读取站点登录域名时才访问 Keychain，避免启动就触发权限相关副作用。
- `EncryptionService` 明确关闭 iCloud Keychain 同步，并把密钥访问级别限制为 `WhenUnlocked`。
- `IAPService` 采用 UserDefaults + Keychain 双写，是为了在本地缓存速度和卸载/重装后的持久性之间折中。

## WebClipper：IndexedDB 与浏览器设置
| 存储层 | 名称 / 版本 | 结构 | 用途 |
| --- | --- | --- | --- |
| IndexedDB | `webclipper` / `DB_VERSION = 3` | `conversations`, `messages`, `sync_mappings` | 保存会话、消息和 Notion 页面映射。 |
| `conversations` store | `keyPath: id` | `source`, `conversationKey`, `title`, `url`, `notionPageId`, `lastCapturedAt` | 列出会话及其元信息。 |
| `messages` store | `keyPath: id` | `conversationId`, `messageKey`, `contentText`, `contentMarkdown`, `sequence`, `updatedAt` | 保存消息正文与排序。 |
| `sync_mappings` store | `keyPath: id` | `source`, `conversationKey`, `notionPageId`, `updatedAt` | 跟踪 Notion 同步映射与后续增量更新。 |
| `chrome.storage.local` | 非敏感 KV | `inpage_supported_only`、Notion / Obsidian 设置等 | 保存 popup / app 可编辑的运行配置。 |

- `storage-idb.ts` 在 `upsertConversation` 和 `syncConversationMessages` 中保证 conversations / messages 的快照式更新，并在重同步时清理已删除消息。
- `deleteConversationsByIds()` 会同时删除会话、消息和 `sync_mappings`，避免本地删除后仍残留旧的 Notion 关联。
- `chrome.storage.local` 的备份采用“全量非敏感键”策略，敏感键显式排除。

## 备份、导出与外部落点
| 产物 | 位置 / 目标 | 生成方 | 说明 |
| --- | --- | --- | --- |
| Zip v2 备份 | 用户本地 zip 文件 | WebClipper | 固定包含 `manifest.json + sources/conversations.csv + sources/... + config/storage-local.json`。 |
| Markdown 导出 | 用户本地文件系统 | WebClipper | 会话可以导出为单文件或多文件 zip。 |
| Obsidian 笔记 | 本地 vault | WebClipper | 按 kind 分目录，文件名为 `<source>-<title>-<stableId10>.md`。 |
| Notion 页面 / 数据库 | 用户 Parent Page | App + WebClipper | 最终同步落点，不属于本地事实存储。 |

- Obsidian 输出虽然是外部目标，但仍属于“本机可见的长期持久化”，对用户来说经常和本地缓存一起被当作恢复面或核对面。
- Release 产物、AMO Source 包等属于交付面，不纳入业务事实存储，已在 [release.md](release.md) 专门拆开描述。

## 迁移、版本与数据演进
| 场景 | 位置 | 变化 | 影响 |
| --- | --- | --- | --- |
| Chats v3 minimal | `ChatCacheService.swift` | 删除 OCR 原始 JSON，改用 `chats_v3_minimal.store` | 破坏性升级，需要重新导入。 |
| NotionAI thread migration | `schema.ts` + `schema-migration.test.ts` | IndexedDB v3 统一 stable conversation key 与 canonical chat URL | 避免旧 conversationKey 导致映射混乱。 |
| `sync_mappings` 跟随 stable key 重写 | `schema-migration.test.ts` | 迁移时同步修复 Notion page mapping | 保持后续增量同步可继续工作。 |
| SiteLogins 统一 Keychain store | `SiteLoginsStore.swift` | 从旧的 WeRead / Dedao / GoodLinks key 迁移到统一域名表 | 避免不同来源各自维护一套 Cookie 存储。 |

- Storage 页面最值得关注的不是“存在哪”，而是“升级时谁会失效、谁会自动迁移、谁需要人工恢复”。
- 对 SyncNos App 来说，聊天 OCR 是唯一明确写出“破坏性升级需重新导入”的存储面；这也是排障时需要优先问清的历史版本问题。

## 典型读写路径
| 路径 | 读写顺序 | 说明 |
| --- | --- | --- |
| App 读取来源并缓存 | 外部来源 / 站点 → SwiftData store → ViewModel / SyncEngine → Notion | SyncNos 自己维护的是缓存和同步映射，不直接拥有 Apple Books / GoodLinks 的原始库。 |
| WebClipper 自动采集 | DOM → IndexedDB (`conversations` / `messages`) → popup / app → 导出 / Notion / Obsidian | IndexedDB 是扩展侧事实源，外部目标都由它派生。 |
| WebClipper 删除会话 | UI → `deleteConversationsByIds()` → 删除 messages + mappings | 删除本地内容时会顺带清理 sync mapping。 |
| 恢复与重建 | Zip v2 / legacy JSON → 本地库 / `chrome.storage.local` | 备份导入是“合并模式”，不是无脑覆盖。 |

## 安全边界与常见风险
| 风险 | 位置 | 当前边界 | 排查入口 |
| --- | --- | --- | --- |
| Keychain 读取失败 | App | 站点 Cookie、加密密钥、试用期备份读取失败时应提示重新登录或重新授权 | `SiteLoginsStore.swift`, `EncryptionService.swift`, `IAPService.swift` |
| 扩展敏感配置被导出 | WebClipper | `notion_oauth_token*` 与 `notion_oauth_client_secret` 被排除在备份外 | `Extensions/WebClipper/AGENTS.md` |
| IndexedDB 迁移异常 | WebClipper | v3 专门处理 NotionAI thread 合并与 mapping 跟随 | `schema.ts`, `schema-migration.test.ts` |
| 破坏性 Chats 升级 | App | `chats_v3_minimal.store` 不兼容旧 OCR JSON 缓存 | `ChatCacheService.swift` |

## 示例片段
### 片段 1：SyncNos App 的 SwiftData store 统一写入 `Application Support/SyncNos/`
```swift
let storeURL = URL.applicationSupportDirectory
    .appendingPathComponent("SyncNos", isDirectory: true)
    .appendingPathComponent("weread.store")
```

### 片段 2：WebClipper 的本地数据库名称和版本是固定契约
```ts
export const DB_NAME = 'webclipper';
export const DB_VERSION = 3;
```

## Coverage Gaps（如有）
- 当前已把高价值持久化面集中到本页，但尚未继续拆出“Notion 侧数据模型”和“App 某些轻量 store（如 bookmark / config store）”的独立页面。
- 若后续围绕同步幂等或备份恢复进行深度改动，可继续把 WebClipper 的 `conversations/` 与 App 的 `SyncScheduling/` 细化成单独子页。

## 来源引用（Source References）
- `.github/docs/business-logic.md`
- `SyncNos/SyncNosApp.swift`
- `SyncNos/Services/Auth/IAPService.swift`
- `SyncNos/Services/Core/EncryptionService.swift`
- `SyncNos/Services/DataSources-To/Notion/Auth/NotionOAuthService.swift`
- `SyncNos/Services/SiteLogins/SiteLoginsStore.swift`
- `SyncNos/Services/DataSources-From/WeRead/WeReadCacheService.swift`
- `SyncNos/Services/DataSources-From/Dedao/DedaoCacheService.swift`
- `SyncNos/Services/DataSources-From/Chats/ChatCacheService.swift`
- `SyncNos/Services/WebArticle/WebArticleCacheService.swift`
- `SyncNos/Models/Sync/SyncedHighlightRecord.swift`
- `Extensions/WebClipper/AGENTS.md`
- `Extensions/WebClipper/src/platform/idb/schema.ts`
- `Extensions/WebClipper/src/conversations/data/storage-idb.ts`
- `Extensions/WebClipper/tests/storage/conversations-idb.test.ts`
- `Extensions/WebClipper/tests/storage/schema-migration.test.ts`
- `.github/guide/obsidian/LocalRestAPI.zh.md`
