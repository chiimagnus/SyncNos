# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `1327be6765cc1875476f8846f2dd531a30bcb023` |
| Branch name | `main` |
| Generation timestamp | `2026-03-30 12:22:32 +0800` |
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
- 同步 WebClipper Settings section key 漂移：将文档中的 `insight/about` 更新为 `aboutyou/aboutme`，并对齐相关 deep-link（安装后默认打开 About Me，列表底部统计入口跳 About You）。
- 补齐 Notion 设置侧文档链路：新增 `LIST_PARENT_PAGES` 消息契约说明、Parent Page 发现（分页/过滤/resolve 已保存 page）与 429 retry 提示；并同步 OAuth pending/error 状态键与断开连接清理范围。
- 刷新 `configuration.md` 的扩展侧存储键与门控事实：补齐 OAuth/Sync Provider gate 的关键键位，并对齐版本事实源维护规则（避免多处重复写死版本）。
- 更新 `api.md` / `data-flow.md` / `modules/webclipper.md` / `testing.md` / `troubleshooting.md`：确保消息契约、数据链路、测试入口与排障提示与当前源码一致。

## Coverage Notes
- 本次重点是“WebClipper inpage 交互与消息契约事实同步”：修正双击入口、补齐 `$ mention` 与消息分组，避免文档与代码行为冲突。
- deepwiki 继续覆盖双产品线、配置、数据流、存储、测试、发布与排障；并维持“代码/配置优先于文档摘要”的约束。
- 仍保留的 Coverage Gaps：App Store 提交流程缺少仓库内自动化证据；OCR 与键盘焦点专项文档尚未拆为 deepwiki 独立专题页。

## Audit Basis

| 类别 | 主要来源 |
| --- | --- |
| 仓库入口与规范 | `AGENTS.md`, `README.md`, `README.zh-CN.md`, `macOS/SyncNos/AGENTS.md`, `webclipper/AGENTS.md` |
| WebClipper 版本与权限 | `webclipper/wxt.config.ts`, `webclipper/package.json` |
| WebClipper 设置与运行时 | `webclipper/src/entrypoints/background.ts`, `webclipper/src/services/bootstrap/content-controller.ts`, `webclipper/src/platform/messaging/ui-background-handlers.ts`, `webclipper/src/viewmodels/settings/types.ts`, `webclipper/src/viewmodels/settings/useSettingsSceneController.ts`, `webclipper/src/services/integrations/chatwith/chatwith-settings.ts` |
| `$ mention`（item-mention） | `webclipper/src/services/integrations/item-mention/background-handlers.ts`, `webclipper/src/services/integrations/item-mention/mention-contract.ts`, `webclipper/src/services/integrations/item-mention/mention-search.ts`, `webclipper/tests/smoke/background-router-item-mention.test.ts` |
| OAuth 与外部交换 | `webclipper/src/services/sync/notion/auth/oauth.ts`, `webclipper/src/services/sync/notion/auth/token-store.ts`, `webclipper/src/services/sync/notion/settings-background-handlers.ts`, `webclipper/src/services/sync/notion/notion-parent-pages.ts`, `webclipper/cloudflare-workers/syncnos-notion-oauth/index.ts` |
| WebClipper 存储与迁移 | `webclipper/src/platform/idb/schema.ts`, `webclipper/src/services/conversations/data/storage-idb.ts` |
| WebClipper 评论线程 | `webclipper/src/services/comments/background/handlers.ts`, `webclipper/src/services/comments/data/storage-idb.ts` |
| 备份边界 | `webclipper/src/services/sync/backup/export.ts`, `webclipper/src/services/sync/backup/import.ts`, `webclipper/src/services/sync/backup/backup-utils.ts` |
| 发布流程 | `.github/workflows/webclipper-*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 若 manifest、DB schema 或发布 workflow 再次变更，优先更新 `configuration.md`、`storage.md`、`release.md`，再回写索引与元数据。
- 若 WebClipper 设置项继续膨胀，建议拆独立 `settings` 专题页，避免 `modules/webclipper.md` 与 `configuration.md` 重复增厚。
