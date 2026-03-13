# 术语表

## 使用说明
- 本页按“仓库级 → App → WebClipper → 同步 / 存储 → 发布”分组，确保同一个词在不同页面里不会被误解。
- 如果你在其他页面看到 `Parent Page`、`cursor`、`conversation kind`、`EnsureCache`、`inpage_display_mode` 等词，建议先回到这里校准语义。

## 仓库级术语

| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| 双产品线 | 同一仓库内同时维护的 macOS App 与浏览器扩展 | `README.md`, `AGENTS.md` |
| Parent Page | Notion 中承载 SyncNos 产物的父页面 | `business-context.md`, Settings / Notion 配置 |
| 条目（Item） | 一个可同步对象，如书、文章、会话 | `business-context.md`, `data-flow.md` |
| 内容片段 | 条目里的高亮、笔记、消息或正文 | `business-context.md`, `data-flow.md` |
| 本地事实源 | 当前最可信的本地状态，而不是派生结果 | `storage.md`, `data-flow.md` |

## SyncNos App 术语

| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| Onboarding | 用户首次进入主流程前必须完成的引导 | `RootView.swift`, `OnboardingViewModel.swift` |
| PayWall | 根据试用期 / 购买状态决定是否阻断主界面的视图 | `RootView.swift`, `PayWallViewModel.swift`, `IAPService.swift` |
| `DIContainer` | App 组合根，统一做协议与实现的惰性装配 | `Services/Core/DIContainer.swift` |
| `NotionSyncSourceProtocol` | App 各来源适配器与统一同步引擎之间的契约 | `NotionSyncSourceProtocol.swift` |
| `EnsureCache` | `NotionSyncEngine` 内部 actor，用来去重并发 ensure 动作 | `NotionSyncEngine.swift` |
| `@ModelActor` | SwiftData 后台访问模式 | `Services/AGENTS.md`, 各 cache service |

## WebClipper 术语

| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| collector | 负责识别站点并抽取消息 / 正文的适配器 | `collectors/`, `register-all.ts` |
| inpage | 页面内按钮与提示 UI，不等于 popup | `content.ts`, `inpage-button-shadow.ts` |
| popup | 浏览器工具栏弹窗 UI | `src/entrypoints/popup/` |
| app | 扩展内部完整页面 UI | `src/entrypoints/app/` |
| conversation kind | WebClipper 会话分类，目前主要是 `chat` 与 `article` | `conversation-kinds.ts` |
| `article_body` | article 会话的正文消息 key | `article-fetch.ts` |
| `inpage_display_mode` | 控制 inpage UI 显示范围的开关（`supported / all / off`，并兼容旧 `inpage_supported_only`） | `bootstrap/content.ts`, Settings |

## 同步与存储术语

| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| cursor | 表示同步进度的游标，用于判断 append 还是 rebuild | `notion-sync-cursor.test.ts`, `sync_mappings` |
| `sync_mappings` | WebClipper 本地记录的 Notion page / cursor 映射 | IndexedDB |
| `contentMarkdown` | 可直接被 Notion / Markdown / Obsidian 消费的消息文本 | WebClipper messages |
| Zip v2 | 当前标准备份格式 | `backup/export.ts`, `backup/import.ts` |
| `contentVersion` | App 网页缓存的抽取算法版本 | `WebArticleCacheService.swift` |
| stable conversation key | 为 NotionAI thread 迁移引入的稳定会话 key | `schema.ts` |

## 发布与工程术语

| 术语 | 定义 | 常见位置 |
| --- | --- | --- |
| WXT | WebClipper 使用的扩展开发 / 构建框架 | `package.json`, `wxt.config.ts` |
| MV3 | 浏览器扩展 Manifest V3 模式 | `wxt.config.ts` |
| `workflow_dispatch` | 可手动触发的 GitHub Actions 入口 | `.github/workflows/*.yml` |
| AMO | Firefox Add-ons 发布渠道 | `webclipper-amo-publish.yml` |
| CWS | Chrome Web Store 发布渠道 | `webclipper-cws-publish.yml` |
| Release Assets | GitHub Release 附带的 zip / xpi 产物 | `webclipper-release.yml` |

## 来源引用（Source References）
- `README.md`
- `macOS/SyncNos/Views/RootView.swift`
- `macOS/SyncNos/ViewModels/Settings/OnboardingViewModel.swift`
- `macOS/SyncNos/ViewModels/Account/PayWallViewModel.swift`
- `macOS/SyncNos/Services/DataSources-To/Notion/Sync/NotionSyncEngine.swift`
- `macOS/SyncNos/Services/DataSources-To/Notion/Sync/NotionSyncSourceProtocol.swift`
- `webclipper/src/collectors/register-all.ts`
- `webclipper/src/collectors/web/article-fetch.ts`
- `webclipper/src/bootstrap/content.ts`
- `webclipper/src/platform/idb/schema.ts`
- `webclipper/src/platform/messaging/message-contracts.ts`
- `.github/workflows/webclipper-release.yml`
