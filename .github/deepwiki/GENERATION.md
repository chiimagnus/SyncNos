# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `ff222d59acc49dc82808c8ae98f49d87250457ae` |
| Branch name | `main` |
| Generation timestamp | `2026-03-25 20:17:18 +0800` |
| Output language | 中文 |
| Generated directory | `.github/deepwiki/` |
| Update mode | Incremental sync update |

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
- [api.md](api.md)
- [operations.md](operations.md)
- [security.md](security.md)
- [storage.md](storage.md)
- [release.md](release.md)
- [troubleshooting.md](troubleshooting.md)
- [glossary.md](glossary.md)

### Module Pages
- [modules/comments.md](modules/comments.md)
- [modules/syncnos-app.md](modules/syncnos-app.md)
- [modules/webclipper.md](modules/webclipper.md)

### Metadata
- [GENERATION.md](GENERATION.md)

## Asset Inventory
- `assets/repository-flow-01.svg`
- `assets/popup-screenshots.png`
- `assets/setting-screenshots.png`

## What Changed In This Update
- 将 deepwiki 内残留的旧 WebClipper 目录引用（`webclipper/src/{bootstrap,conversations,comments,sync,protocols,i18n}`）统一迁移到当前结构：`webclipper/src/services/*` 与 `webclipper/src/ui/i18n/*`，并同步各页 Source References。
- 在 `configuration.md` 中更新 `manifest.version`（作为单一事实源），其它页面不再写死具体版本值，只引用该页。
- 在 `modules/comments.md`、`storage.md` 等页面同步 comments 子系统的真实实现：使用 `locator`（TextQuote/TextPosition selectors）而非不存在的 `quoteContext`；并修正 threaded comments panel 的真实路径。
- 在 `operations.md`、`testing.md`、`troubleshooting.md`、`glossary.md`、`security.md`、`business-context.md` 等运行/排障/术语/安全页面，补齐与当前代码结构一致的定位入口与引用路径。
- 更新 `GENERATION.md` 元数据（commit/branch/timestamp）与页面清单一致性。

## Coverage Notes
- 本次重点是“目录重构后的事实同步”：把 WebClipper 文档引用统一迁移到 `src/services/*` 与 `src/ui/*`，并清理断链。
- deepwiki 继续覆盖双产品线、配置、数据流、存储、测试、发布与排障；并维持“代码/配置优先于文档摘要”的约束。
- 仍保留的 Coverage Gaps：App Store 提交流程缺少仓库内自动化证据；OCR 与键盘焦点专项文档尚未拆为 deepwiki 独立专题页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库入口与规范 | `AGENTS.md`, `README.md`, `README.zh-CN.md`, `macOS/SyncNos/AGENTS.md`, `webclipper/AGENTS.md` |
| WebClipper 版本与权限 | `webclipper/wxt.config.ts`, `webclipper/package.json` |
| WebClipper 设置与运行时 | `webclipper/src/entrypoints/background.ts`, `webclipper/src/viewmodels/settings/types.ts`, `webclipper/src/viewmodels/settings/useSettingsSceneController.ts`, `webclipper/src/services/integrations/chatwith/chatwith-settings.ts` |
| OAuth 与外部交换 | `webclipper/src/services/sync/notion/auth/oauth.ts`, `webclipper/cloudflare-workers/syncnos-notion-oauth/index.ts` |
| WebClipper 存储与迁移 | `webclipper/src/platform/idb/schema.ts`, `webclipper/src/services/conversations/data/storage-idb.ts` |
| WebClipper 评论线程 | `webclipper/src/services/comments/background/handlers.ts`, `webclipper/src/services/comments/data/storage-idb.ts` |
| 备份边界 | `webclipper/src/services/sync/backup/export.ts`, `webclipper/src/services/sync/backup/import.ts`, `webclipper/src/services/sync/backup/backup-utils.ts` |
| 发布流程 | `.github/workflows/webclipper-*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 若 manifest、DB schema 或发布 workflow 再次变更，优先更新 `configuration.md`、`storage.md`、`release.md`，再回写索引与元数据。
- 若 WebClipper 设置项继续膨胀，建议拆独立 `settings` 专题页，避免 `modules/webclipper.md` 与 `configuration.md` 重复增厚。
