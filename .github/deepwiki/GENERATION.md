# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `f817e4a8894274d9155521f9b4c63a74c2a147b1` |
| Branch name | `main` |
| Generation timestamp | `2026-03-15 01:45:30 CST` |
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
- `assets/popup-screenshots.png` (existing screenshot asset, used in README / deepwiki)
- `assets/setting-screenshots.png` (existing screenshot asset, used in README / deepwiki)

## What Changed In This Update
- 刷新生成元数据到 `main` 分支当前 `HEAD`（`f817e4a8`），并更新本次增量覆盖说明。
- 更新 deepwiki 中的 WebClipper 版本事实：`INDEX.md`、`configuration.md`、`dependencies.md`、`release.md`、`testing.md` 已统一对齐 `manifest.version = 1.3.2`。
- 同步 deepwiki 中的发布链路清单：`overview.md`、`workflow.md`、`release.md`、`dependencies.md`、`troubleshooting.md` 已显式纳入 `webclipper-edge-publish.yml` 与 `publish-edge.mjs` 相关事实。
- 同步 deepwiki 与仓库入口文档中的专项文档路径：把失效旧路径统一修正为 `macOS/SyncNos/键盘导航与焦点管理技术文档（全项目）.md`。
- 同步权限事实：文档中的扩展权限说明与示例片段已纳入 `contextMenus`，与 `wxt.config.ts` 当前声明一致。
- 同步相关执行文档：更新 `AGENTS.md` 与 `webclipper/AGENTS.md`，确保仓库入口、发布脚本说明与产品线执行文档保持一致。
- 本次未新增页面文件，继续保持稳定文件名并在既有页面做增量修正。

## Coverage Notes
- 当前 deepwiki 已覆盖仓库级入口、双产品线模块、配置、测试、存储、发布与排障，并持续把 WebClipper 的 Insight 统计能力串入业务入口层和工程入口层。
- 本次增量刷新重点是“版本事实与文档路径纠偏”：manifest 版本对齐 `1.3.2`、专项文档路径对齐真实目录、权限声明补齐 `contextMenus`。
- 仍保留的显式 Coverage Gaps：App Store 提交流程没有仓库内自动化证据；OCR 与键盘焦点专项文档尚未继续拆成 deepwiki 独立子页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库级语义 | `README.md`, `AGENTS.md`, `macOS/SyncNos/AGENTS.md`, `webclipper/AGENTS.md` |
| App 入口与主流程 | `macOS/SyncNos/SyncNosApp.swift`, `macOS/SyncNos/AppDelegate.swift`, `macOS/SyncNos/Views/RootView.swift` |
| App 服务与存储 | `DIContainer.swift`, `NotionSyncEngine.swift`, `IAPService.swift`, `SiteLoginsStore.swift`, `ChatCacheService.swift`, `WebArticleCacheService.swift` |
| WebClipper 运行时与数据 | `background.ts`, `content.ts`, `bootstrap/content.ts`, `current-page-capture.ts`, `message-contracts.ts`, `schema.ts`, `storage-idb.ts`, `conversations/background/handlers.ts`, `conversations/background/image-backfill-job.ts`, `pending-open.ts`, `PopupShell.tsx`, `AppShell.tsx`, `DetailNavigationHeader.tsx`, `conversations-context.tsx`, `MenuPopover.tsx`, `SelectMenu.tsx` |
| WebClipper 采集、设置与同步 | `register-all.ts`, `gemini-collector.ts`, `kimi-collector.ts`, `zai-collector.ts`, `googleaistudio-collector.ts`, `article-fetch.ts`, `chatwith-settings.ts`, `chatwith-detail-header-actions.ts`, `detail-header-actions.ts`, `detail-header-action-types.ts`, `SettingsSidebarNav.tsx`, `SettingsScene.tsx`, `useSettingsSceneController.ts`, `InsightSection.tsx`, `InsightPanel.tsx`, `insight-stats.ts`, `ConversationListPane.tsx`, `ConversationDetailPane.tsx`, `ConversationsScene.tsx`, `DetailHeaderActionBar.tsx`, `useThemeMode.ts`, `conversation-kinds.ts`, `notion-sync-orchestrator.ts`, `obsidian-sync-orchestrator.ts`, `backup/*`, `tests/collectors/*` |
| 相关文档与执行约束 | `AGENTS.md`, `webclipper/AGENTS.md`, `webclipper/src/ui/AGENTS.md`, `README.md`, `README.zh-CN.md` |
| 发布与打包 | `.github/workflows/*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 如果未来补充 App Store 提交流程，优先在 `release.md` 与 `INDEX.md` 中补一条 macOS App 交付路径。
- 如果 OCR、键盘焦点、Notion / Obsidian 集成继续膨胀，适合拆出独立专题页，而不是把细节继续塞回 overview / architecture。
- 如果 Insight 继续扩展出时间维度、趋势页或独立配置，优先考虑把 `modules/webclipper.md` / `storage.md` 中的统计说明拆成专题页，而不是继续堆在设置模块页里。
- 如果 `General` 分区继续膨胀（例如加入更多主题 / 布局 / 列表偏好），考虑把 Appearance 与 Inpage 行为拆成独立 deepwiki 专题页，而不是让 `configuration.md` 和 `modules/webclipper.md` 变成“设置项百科全书”。
- 如果 `cache-images` 后续增加批处理、队列或并行下载策略，建议补 `handlers + image-backfill-job + UI slot` 联动测试并在 `testing.md` 升级为自动化回归项。
