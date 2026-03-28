# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `7180ae92eeb1f6c5a09e94745727cfb35c781194` |
| Branch name | `crh2` |
| Generation timestamp | `2026-03-29 00:52:03 +0800` |
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
- 更正 WebClipper inpage 双击行为的文档事实：双击不再打开 popup，而是打开页面内评论侧边栏（inpage comments panel），并补齐其 UI→background→content 的消息链路（`OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL` → `OPEN_INPAGE_COMMENTS_PANEL`）。
- 补齐 `$ mention`（item-mention）能力的文档入口：新增 `ai_chat_dollar_mention_enabled` 配置键、站点门控（`features.dollarMention`）、`ITEM_MENTION_MESSAGE_TYPES` 消息契约、失败模式与测试抓手。
- 更正 `wxt.config.ts` 的图标事实：manifest icons 仍包含 `16/48/128`，但 `web_accessible_resources` 仅暴露 `icons/icon-128.png`。
- 同步 `api.md` / `architecture.md` 的消息契约分组：补齐 `CHATGPT_MESSAGE_TYPES`、`CURRENT_PAGE_MESSAGE_TYPES`、`ITEM_MENTION_MESSAGE_TYPES`、`COMMENTS_MESSAGE_TYPES`，并明确 `CONTENT_MESSAGE_TYPES` 属于 background→content 指令而非 router handler。
- 更新 `testing.md` / `troubleshooting.md` 的回归与排障清单：加入 `$ mention` 覆盖与“打开评论侧边栏”的新交互，减少旧的 popup 误导。

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
| OAuth 与外部交换 | `webclipper/src/services/sync/notion/auth/oauth.ts`, `webclipper/cloudflare-workers/syncnos-notion-oauth/index.ts` |
| WebClipper 存储与迁移 | `webclipper/src/platform/idb/schema.ts`, `webclipper/src/services/conversations/data/storage-idb.ts` |
| WebClipper 评论线程 | `webclipper/src/services/comments/background/handlers.ts`, `webclipper/src/services/comments/data/storage-idb.ts` |
| 备份边界 | `webclipper/src/services/sync/backup/export.ts`, `webclipper/src/services/sync/backup/import.ts`, `webclipper/src/services/sync/backup/backup-utils.ts` |
| 发布流程 | `.github/workflows/webclipper-*.yml`, `.github/scripts/webclipper/*.mjs` |

## Notes For Next Update
- 若 manifest、DB schema 或发布 workflow 再次变更，优先更新 `configuration.md`、`storage.md`、`release.md`，再回写索引与元数据。
- 若 WebClipper 设置项继续膨胀，建议拆独立 `settings` 专题页，避免 `modules/webclipper.md` 与 `configuration.md` 重复增厚。
