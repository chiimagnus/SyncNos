# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `f3257e3b1c5bf6ce1891d62232fae6ed63e6f7b5` |
| Branch name | `main` |
| Generation timestamp | `2026-03-14 10:48:17 CST` |
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
- 刷新生成元数据到 `main` 分支当前 `HEAD`（`f3257e3b`），并更新本次增量覆盖说明。
- 为 `INDEX.md`、`overview.md`、`architecture.md`、`configuration.md`、`modules/webclipper.md` 增量同步最新 UI 行为：`SelectMenu` 新增 `adaptiveMaxHeight`，并通过 `findNearestClippingRect()` 基于最近可裁剪容器计算可用高度，减少底部筛选菜单多余滚动条与裁切。
- 为 `testing.md`、`troubleshooting.md`、`workflow.md`、`glossary.md` 补充对应验证与排障语义：source/site 筛选菜单不再固定 `maxHeight=320`，而是按视口和容器动态变化。
- 同步相关执行文档：`AGENTS.md`、`webclipper/AGENTS.md`、`webclipper/src/ui/AGENTS.md`，确保仓库级与 UI 级规范都覆盖最新下拉菜单可视区域策略。
- 本次未新增页面文件，继续保持稳定文件名并在既有页面追加证据。

## Coverage Notes
- 当前 deepwiki 已覆盖仓库级入口、双产品线模块、配置、测试、存储、发布与排障，并持续把 WebClipper 的 Insight 统计能力串入业务入口层和工程入口层。
- 本次增量刷新重点是“筛选下拉可视区域自适应（`adaptiveMaxHeight` + `findNearestClippingRect`）”，并把该行为同步到架构、配置、模块、测试、排障与协作文档链路。
- 仍保留的显式 Coverage Gaps：App Store 提交流程没有仓库内自动化证据；OCR 与键盘焦点专项文档尚未继续拆成 deepwiki 独立子页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库级语义 | `README.md`, `AGENTS.md`, `macOS/SyncNos/AGENTS.md`, `webclipper/AGENTS.md` |
| App 入口与主流程 | `macOS/SyncNos/SyncNosApp.swift`, `macOS/SyncNos/AppDelegate.swift`, `macOS/SyncNos/Views/RootView.swift` |
| App 服务与存储 | `DIContainer.swift`, `NotionSyncEngine.swift`, `IAPService.swift`, `SiteLoginsStore.swift`, `ChatCacheService.swift`, `WebArticleCacheService.swift` |
| WebClipper 运行时与数据 | `background.ts`, `content.ts`, `bootstrap/content.ts`, `current-page-capture.ts`, `message-contracts.ts`, `schema.ts`, `storage-idb.ts`, `pending-open.ts`, `PopupShell.tsx`, `AppShell.tsx`, `CapturedListSidebar.tsx`, `MenuPopover.tsx`, `SelectMenu.tsx` |
| WebClipper 采集、设置与同步 | `register-all.ts`, `gemini-collector.ts`, `kimi-collector.ts`, `zai-collector.ts`, `googleaistudio-collector.ts`, `article-fetch.ts`, `chatwith-settings.ts`, `chatwith-detail-header-actions.ts`, `detail-header-actions.ts`, `i18n/index.ts`, `SettingsSidebarNav.tsx`, `SettingsScene.tsx`, `useSettingsSceneController.ts`, `InsightSection.tsx`, `InsightPanel.tsx`, `insight-stats.ts`, `ConversationListPane.tsx`, `ConversationsScene.tsx`, `useThemeMode.ts`, `conversation-kinds.ts`, `notion-sync-orchestrator.ts`, `obsidian-sync-orchestrator.ts`, `backup/*`, `tests/collectors/*` |
| 相关文档与执行约束 | `AGENTS.md`, `webclipper/AGENTS.md`, `webclipper/src/ui/AGENTS.md` |
| 发布与打包 | `.github/workflows/*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 如果未来补充 App Store 提交流程，优先在 `release.md` 与 `INDEX.md` 中补一条 macOS App 交付路径。
- 如果 OCR、键盘焦点、Notion / Obsidian 集成继续膨胀，适合拆出独立专题页，而不是把细节继续塞回 overview / architecture。
- 如果 Insight 继续扩展出时间维度、趋势页或独立配置，优先考虑把 `modules/webclipper.md` / `storage.md` 中的统计说明拆成专题页，而不是继续堆在设置模块页里。
- 如果 `General` 分区继续膨胀（例如加入更多主题 / 布局 / 列表偏好），考虑把 Appearance 与 Inpage 行为拆成独立 deepwiki 专题页，而不是让 `configuration.md` 和 `modules/webclipper.md` 变成“设置项百科全书”。
- 如果 `SelectMenu` 的 `adaptiveMaxHeight` 继续扩展到更多入口，建议补组件级测试（`top/bottom + clipping parent`）并在 `testing.md` 中升级为自动化回归项。
