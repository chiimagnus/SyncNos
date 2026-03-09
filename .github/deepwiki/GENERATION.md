# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `38d6fb2ce2b3d48da2e7bb7f02ef87ecba24b96e` |
| Branch name | `crh` |
| Generation timestamp | `2026-03-09 19:31:12 CST` |
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
- 刷新生成元数据到当前 `HEAD`（`38d6fb2c`），修复 `GENERATION.md` 中 commit / 时间戳落后于页面内容的问题。
- 校正 WebClipper manifest 版本为 `1.2.2`，继续明确区分 `package.json` 版本 `0.14.6` 与发布 workflow 使用的 `manifest.version`。
- 校正 WebClipper IndexedDB 事实为 `DB_VERSION = 4`，并补充 legacy article canonical key 迁移，不再把文档停留在旧的 `DB_VERSION = 3`。
- 为 WebClipper 模块补充当前页抓取、Chat with AI 设置、Settings 分组导航、浏览器语言自动国际化等近期能力入口。
- 同步刷新 `testing.md`、`configuration.md`、`release.md`、`dependencies.md` 中受版本漂移影响的断言，减少“代码已更新但 wiki 还在旧版本”现象。

## Coverage Notes
- 当前 deepwiki 已覆盖仓库级入口、双产品线模块、配置、测试、存储、发布与排障。
- 本次增量刷新重点修复“版本 / 迁移 / 设置入口”漂移，当前不需要新增页面文件；更适合继续保持稳定文件名并追加事实。
- 仍保留的显式 Coverage Gaps：App Store 提交流程没有仓库内自动化证据；OCR 与键盘焦点专项文档尚未继续拆成 deepwiki 独立子页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库级语义 | `README.md`, `AGENTS.md`, `macOS/SyncNos/AGENTS.md`, `webclipper/AGENTS.md` |
| App 入口与主流程 | `macOS/SyncNos/SyncNosApp.swift`, `macOS/SyncNos/AppDelegate.swift`, `macOS/SyncNos/Views/RootView.swift` |
| App 服务与存储 | `DIContainer.swift`, `NotionSyncEngine.swift`, `IAPService.swift`, `SiteLoginsStore.swift`, `ChatCacheService.swift`, `WebArticleCacheService.swift` |
| WebClipper 运行时与数据 | `background.ts`, `content.ts`, `bootstrap/content.ts`, `current-page-capture.ts`, `message-contracts.ts`, `schema.ts`, `storage-idb.ts` |
| WebClipper 采集、设置与同步 | `register-all.ts`, `googleaistudio-collector.ts`, `article-fetch.ts`, `chatwith-settings.ts`, `i18n/index.ts`, `SettingsSidebarNav.tsx`, `conversation-kinds.ts`, `notion-sync-orchestrator.ts`, `obsidian-sync-orchestrator.ts`, `backup/*` |
| 发布与打包 | `.github/workflows/*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 如果未来补充 App Store 提交流程，优先在 `release.md` 与 `INDEX.md` 中补一条 macOS App 交付路径。
- 如果 OCR、键盘焦点、Notion / Obsidian 集成继续膨胀，适合拆出独立专题页，而不是把细节继续塞回 overview / architecture。
- 如果 Chat with AI、Current Page Capture 或 i18n 继续扩展到更多平台 / 工作流，优先考虑把 `modules/webclipper.md` 中的相关段落拆成独立专题页。
