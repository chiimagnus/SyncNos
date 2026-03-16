# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `ea57c00506d9e0b4ba90868ccbc23fa6a4db4435` |
| Branch name | `main` |
| Generation timestamp | `2026-03-16 18:41:56 CST` |
| Output language | 中文 |
| Generated directory | `.github/deepwiki/` |
| Update mode | Incremental cleanup |

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
- `assets/repository-flow-01.svg`
- `assets/popup-screenshots.png`
- `assets/setting-screenshots.png`

## What Changed In This Update
- 清理 `INDEX.md` 的日期型“变更流水”内容，改为稳定入口与事实源说明，减少跨页重复与时效性噪声。
- 将 deepwiki 中 WebClipper manifest 版本事实统一更新为 `1.3.3`（`dependencies.md`、`configuration.md`、`release.md`、`testing.md`）。
- 将 deepwiki 中 IndexedDB 版本事实统一更新为 `DB_VERSION = 6`，并补齐 `oldVersion < 6` 清理迁移说明（`storage.md`、`modules/webclipper.md`）。
- 在存储专题页补充 `image_cache` store 与备份边界（Zip v2 不包含 `image_cache`），避免“缓存层=备份层”的误读。
- 删除模块页中易过期的“近期修复流水”表述，保留稳定的职责、边界与入口信息。

## Coverage Notes
- 本次重点是“去冗余 + 去老旧 + 校准事实源”，未新增页面，保持文件名稳定。
- deepwiki 继续覆盖双产品线、配置、数据流、存储、测试、发布与排障；并强化“代码/配置优先于文档摘要”的写作约束。
- 仍保留的 Coverage Gaps：App Store 提交流程缺少仓库内自动化证据；OCR 与键盘焦点专项文档尚未拆为 deepwiki 独立专题页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库入口与规范 | `AGENTS.md`, `README.md`, `README.zh-CN.md`, `macOS/SyncNos/AGENTS.md`, `webclipper/AGENTS.md` |
| WebClipper 版本与权限 | `webclipper/wxt.config.ts`, `webclipper/package.json` |
| WebClipper 设置与运行时 | `webclipper/src/entrypoints/background.ts`, `webclipper/src/ui/settings/types.ts`, `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts` |
| WebClipper 存储与迁移 | `webclipper/src/platform/idb/schema.ts`, `webclipper/src/conversations/data/storage-idb.ts` |
| 备份边界 | `webclipper/src/sync/backup/export.ts`, `webclipper/src/sync/backup/import.ts`, `webclipper/src/sync/backup/backup-utils.ts` |
| 发布流程 | `.github/workflows/webclipper-*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 若 manifest、DB schema 或发布 workflow 再次变更，优先更新 `configuration.md`、`storage.md`、`release.md`，再回写索引与元数据。
- 若 WebClipper 设置项继续膨胀，建议拆独立 `settings` 专题页，避免 `modules/webclipper.md` 与 `configuration.md` 重复增厚。
