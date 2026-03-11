# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `b8465e7905d876cc714fd8a014f7166fe4be49f1` |
| Branch name | `crh2` |
| Generation timestamp | `2026-03-11 23:55:12 CST` |
| Output language | 中文 |
| Generated directory | `.github/deepwiki/` |
| Update mode | Incremental refresh |

## Page Inventory

### Core / Topic Pages
- [INDEX.md](INDEX.md)
- [business-context.md](business-context.md)
- [overview.md](overview.md)
- [architecture.md](architecture.md)
- [dependencies.md](dependencies.md)
- [data-flow.md](data-flow.md)
- [configuration.md](configuration.md)
- [testing.md](testing.md)
- [workflow.md](workflow.md)
- [storage.md](storage.md)
- [release.md](release.md)
- [troubleshooting.md](troubleshooting.md)
- [glossary.md](glossary.md)

### Module Pages
- [modules/syncnos-app.md](modules/syncnos-app.md)
- [modules/webclipper.md](modules/webclipper.md)

### Metadata
- [GENERATION.md](GENERATION.md)

## Asset Inventory
- `assets/repository-flow-01.svg` (existing asset, sourced from `macOS/Resource/flows.svg`)

## What Changed In This Update
- 刷新生成元数据时间戳到当前更新批次，并保持当前 `HEAD`（`b8465e79`）与分支名 `crh2` 一致。
- 为 `INDEX.md`、`business-context.md`、`overview.md`、`modules/webclipper.md`、`architecture.md` 补充当前分支上的 WebClipper UI / Settings 演进：`General` 分区、手动主题模式、`Chat with AI` 详情头动作、会话来源筛选持久化与窄屏 detail bridge。
- 为 `configuration.md`、`storage.md`、`testing.md` 刷新实际配置键与验证口径：`manifest.version = 1.2.4`、`ui_theme_mode`、`inpage_display_mode`、`ai_chat_auto_save_enabled`、`webclipper_settings_active_section` 默认分组、`webclipper_conversations_source_filter_key` 与 `webclipper_pending_open_conversation_id`。
- 为 `workflow.md`、`release.md` 修正当前 release 事实：商店 workflow 继续以 `webclipper/wxt.config.ts` 的 `manifest.version` 为 tag 校验真源，而不是 `webclipper/package.json`。
- 同步仓库级与 UI 级文档，使 `README*`、`AGENTS.md`、`webclipper/AGENTS.md`、`webclipper/src/ui/AGENTS.md` 与 deepwiki 对齐，避免“代码已支持手动主题，但设计文档仍声称只能跟随系统”这类陈旧描述继续扩散。

## Coverage Notes
- 当前 deepwiki 已覆盖仓库级入口、双产品线模块、配置、测试、存储、发布与排障，并把 WebClipper 的 Insight 统计视图接入到业务入口层和工程入口层。
- 本次增量刷新重点是“设置分组 / 主题模式 / Chat with AI / 窄屏路由桥接 / 本地 UI 状态存储”与既有 Insight 文档的并轨，未新增页面文件，继续保持稳定文件名并在既有页面追加证据。
- 仍保留的显式 Coverage Gaps：App Store 提交流程没有仓库内自动化证据；OCR 与键盘焦点专项文档尚未继续拆成 deepwiki 独立子页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库级语义 | `README.md`, `AGENTS.md`, `macOS/SyncNos/AGENTS.md`, `webclipper/AGENTS.md` |
| App 入口与主流程 | `macOS/SyncNos/SyncNosApp.swift`, `macOS/SyncNos/AppDelegate.swift`, `macOS/SyncNos/Views/RootView.swift` |
| App 服务与存储 | `DIContainer.swift`, `NotionSyncEngine.swift`, `IAPService.swift`, `SiteLoginsStore.swift`, `ChatCacheService.swift`, `WebArticleCacheService.swift` |
| WebClipper 运行时与数据 | `background.ts`, `content.ts`, `bootstrap/content.ts`, `current-page-capture.ts`, `message-contracts.ts`, `schema.ts`, `storage-idb.ts`, `pending-open.ts` |
| WebClipper 采集、设置与同步 | `register-all.ts`, `googleaistudio-collector.ts`, `article-fetch.ts`, `chatwith-settings.ts`, `chatwith-detail-header-actions.ts`, `detail-header-actions.ts`, `i18n/index.ts`, `SettingsSidebarNav.tsx`, `SettingsScene.tsx`, `useSettingsSceneController.ts`, `InsightSection.tsx`, `InsightPanel.tsx`, `insight-stats.ts`, `ConversationListPane.tsx`, `ConversationsScene.tsx`, `useThemeMode.ts`, `conversation-kinds.ts`, `notion-sync-orchestrator.ts`, `obsidian-sync-orchestrator.ts`, `backup/*` |
| 发布与打包 | `.github/workflows/*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 如果未来补充 App Store 提交流程，优先在 `release.md` 与 `INDEX.md` 中补一条 macOS App 交付路径。
- 如果 OCR、键盘焦点、Notion / Obsidian 集成继续膨胀，适合拆出独立专题页，而不是把细节继续塞回 overview / architecture。
- 如果 Insight 继续扩展出时间维度、趋势页或独立配置，优先考虑把 `modules/webclipper.md` / `storage.md` 中的统计说明拆成专题页，而不是继续堆在设置模块页里。
- 如果 `General` 分区继续膨胀（例如加入更多主题 / 布局 / 列表偏好），考虑把 Appearance 与 Inpage 行为拆成独立 deepwiki 专题页，而不是让 `configuration.md` 和 `modules/webclipper.md` 变成“设置项百科全书”。
