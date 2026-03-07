# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `a7a1c7b14921e4605987a4fddd68a96b7ebba9ce` |
| Branch name | `crh` |
| Generation timestamp | `2026-03-07 19:45:31 CST` |
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
- `assets/repository-flow-01.svg` (existing asset, sourced from `Resource/flows.svg`)

## What Changed In This Update
- 新增 `business-context.md`，把 deepwiki 补齐为“业务入口层 + 技术层”的完整结构。
- 重写 `INDEX.md`，明确给出 `business-first`、`engineering-first`、`release-first` 三条阅读路径。
- 校正 WebClipper manifest 版本为 `1.1.3`，并明确区分 `package.json` 版本 `0.14.6` 与发布 workflow 使用的 `manifest.version`。
- 依据实际代码刷新 App 启动 / 门控、Notion 同步、站点登录态、IndexedDB 迁移、article 抓取、Obsidian fallback、发布脚本职责等页面事实。
- 保留现有页面文件名，采用增量更新而非重命名，减少 deepwiki 的链接漂移。

## Coverage Notes
- 当前 deepwiki 已覆盖仓库级入口、双产品线模块、配置、测试、存储、发布与排障。
- 仍保留的显式 Coverage Gaps：App Store 提交流程没有仓库内自动化证据；OCR 与键盘焦点专项文档尚未继续拆成 deepwiki 独立子页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库级语义 | `README.md`, `AGENTS.md`, `.github/docs/business-logic.md` |
| App 入口与主流程 | `SyncNos/SyncNosApp.swift`, `SyncNos/AppDelegate.swift`, `SyncNos/Views/RootView.swift` |
| App 服务与存储 | `DIContainer.swift`, `NotionSyncEngine.swift`, `IAPService.swift`, `SiteLoginsStore.swift`, `ChatCacheService.swift`, `WebArticleCacheService.swift` |
| WebClipper 运行时与数据 | `background.ts`, `content.ts`, `bootstrap/content.ts`, `message-contracts.ts`, `schema.ts`, `storage-idb.ts` |
| WebClipper 采集与同步 | `register-all.ts`, `googleaistudio-collector.ts`, `article-fetch.ts`, `conversation-kinds.ts`, `notion-sync-orchestrator.ts`, `obsidian-sync-orchestrator.ts`, `backup/*` |
| 发布与打包 | `.github/workflows/*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 如果未来补充 App Store 提交流程，优先在 `release.md` 与 `INDEX.md` 中补一条 macOS App 交付路径。
- 如果 OCR、键盘焦点、Notion / Obsidian 集成继续膨胀，适合拆出独立专题页，而不是把细节继续塞回 overview / architecture。
