# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `32a2cea3af18ae289890df66eb5e6cc8853c461c` |
| Branch name | `main` |
| Generation timestamp | `2026-03-09 21:51:26 CST` |
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
- 刷新生成元数据时间戳到当前更新批次，并保持当前 `HEAD`（`32a2cea3`）与分支名 `main` 一致。
- 为 `business-context.md`、`overview.md`、`modules/webclipper.md` 补充 WebClipper `Settings → Insight` 的用户价值、只读统计语义与实际入口文件。
- 为 `storage.md`、`configuration.md`、`testing.md` 补充 Insight 的本地聚合事实：数据来自 `conversations + messages`、Top N 限制分别是 `4 / 8 / 3`、并新增对应验证路径。
- 在 `dependencies.md` 记录 `recharts` 已成为 WebClipper 运行时依赖，用于 Insight 的条形图可视化。
- 在 `INDEX.md` 增加“Insight 仪表盘从哪来、改哪里、怎么验证”的导航入口，减少读者在设置、存储、测试页面之间来回盲找。

## Coverage Notes
- 当前 deepwiki 已覆盖仓库级入口、双产品线模块、配置、测试、存储、发布与排障，并把 WebClipper 的 Insight 统计视图接入到业务入口层和工程入口层。
- 本次增量刷新重点是“新功能落点 + 本地统计事实 + 验证路径”，未新增页面文件，继续保持稳定文件名并在既有页面追加证据。
- 仍保留的显式 Coverage Gaps：App Store 提交流程没有仓库内自动化证据；OCR 与键盘焦点专项文档尚未继续拆成 deepwiki 独立子页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库级语义 | `README.md`, `AGENTS.md`, `macOS/SyncNos/AGENTS.md`, `webclipper/AGENTS.md` |
| App 入口与主流程 | `macOS/SyncNos/SyncNosApp.swift`, `macOS/SyncNos/AppDelegate.swift`, `macOS/SyncNos/Views/RootView.swift` |
| App 服务与存储 | `DIContainer.swift`, `NotionSyncEngine.swift`, `IAPService.swift`, `SiteLoginsStore.swift`, `ChatCacheService.swift`, `WebArticleCacheService.swift` |
| WebClipper 运行时与数据 | `background.ts`, `content.ts`, `bootstrap/content.ts`, `current-page-capture.ts`, `message-contracts.ts`, `schema.ts`, `storage-idb.ts` |
| WebClipper 采集、设置与同步 | `register-all.ts`, `googleaistudio-collector.ts`, `article-fetch.ts`, `chatwith-settings.ts`, `i18n/index.ts`, `SettingsSidebarNav.tsx`, `SettingsScene.tsx`, `useSettingsSceneController.ts`, `InsightSection.tsx`, `InsightPanel.tsx`, `insight-stats.ts`, `conversation-kinds.ts`, `notion-sync-orchestrator.ts`, `obsidian-sync-orchestrator.ts`, `backup/*` |
| 发布与打包 | `.github/workflows/*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 如果未来补充 App Store 提交流程，优先在 `release.md` 与 `INDEX.md` 中补一条 macOS App 交付路径。
- 如果 OCR、键盘焦点、Notion / Obsidian 集成继续膨胀，适合拆出独立专题页，而不是把细节继续塞回 overview / architecture。
- 如果 Insight 继续扩展出时间维度、趋势页或独立配置，优先考虑把 `modules/webclipper.md` / `storage.md` 中的统计说明拆成专题页，而不是继续堆在设置模块页里。
