# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `246e4bda356dfedb9db1c0ba0ab474b62223aaf0` |
| Branch name | `main` |
| Generation timestamp | `2026-03-19 01:51:24 CST` |
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
- [modules/syncnos-app.md](modules/syncnos-app.md)
- [modules/webclipper.md](modules/webclipper.md)

### Metadata
- [GENERATION.md](GENERATION.md)

## Asset Inventory
- `assets/repository-flow-01.svg`
- `assets/popup-screenshots.png`
- `assets/setting-screenshots.png`

## What Changed In This Update
- 在 `configuration.md` 同步 `manifest.version=1.3.5`，并补充 App `AutoSyncService.intervalSeconds=5*60` 的配置事实。
- 在 `dependencies.md` 补充 Notion OAuth Worker 作为外部集成边界，明确 token exchange 由 Worker 侧持有密钥完成。
- 在 `api.md` 新增 Notion OAuth Worker 交换流程（授权、回调校验、code exchange、token 入库）与关键参数矩阵。
- 在 `INDEX.md` 的 Coverage Gaps 中补充 OCR 与键盘焦点专项文档的可点击链接。
- 在 `INDEX.md` 与 `GENERATION.md` 补齐 `api.md` / `operations.md` / `security.md` / `glossary.md` 的页面可达性与清单一致性。

## Coverage Notes
- 本次重点是“事实同步 + 外部集成边界补强”，未新增页面，保持文件名稳定。
- deepwiki 继续覆盖双产品线、配置、数据流、存储、测试、发布与排障；并强化“代码/配置优先于文档摘要”的写作约束。
- 仍保留的 Coverage Gaps：App Store 提交流程缺少仓库内自动化证据；OCR 与键盘焦点专项文档尚未拆为 deepwiki 独立专题页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库入口与规范 | `AGENTS.md`, `README.md`, `README.zh-CN.md`, `macOS/SyncNos/AGENTS.md`, `webclipper/AGENTS.md` |
| WebClipper 版本与权限 | `webclipper/wxt.config.ts`, `webclipper/package.json` |
| WebClipper 设置与运行时 | `webclipper/src/entrypoints/background.ts`, `webclipper/src/ui/settings/types.ts`, `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts` |
| OAuth 与外部交换 | `webclipper/src/sync/notion/auth/oauth.ts`, `webclipper/cloudflare-workers/syncnos-notion-oauth/index.ts` |
| WebClipper 存储与迁移 | `webclipper/src/platform/idb/schema.ts`, `webclipper/src/conversations/data/storage-idb.ts` |
| 备份边界 | `webclipper/src/sync/backup/export.ts`, `webclipper/src/sync/backup/import.ts`, `webclipper/src/sync/backup/backup-utils.ts` |
| 发布流程 | `.github/workflows/webclipper-*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 若 manifest、DB schema 或发布 workflow 再次变更，优先更新 `configuration.md`、`storage.md`、`release.md`，再回写索引与元数据。
- 若 WebClipper 设置项继续膨胀，建议拆独立 `settings` 专题页，避免 `modules/webclipper.md` 与 `configuration.md` 重复增厚。
