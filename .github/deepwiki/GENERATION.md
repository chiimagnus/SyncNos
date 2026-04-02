# Generation Metadata

## Repository State

| Field | Value |
| --- | --- |
| Repository | `chiimagnus/SyncNos` |
| Commit hash | `3010574e0ac817a2988fd5b214a54535c7efb491` |
| Branch name | `main` |
| Generation timestamp | `2026-04-02 16:46:27 +0800` |
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
- 对齐会话详情动作槽位：统一为 `open / tools`，移除文档中的 `chat-with` 独立槽位表述，并说明 Chat with AI 复用 `tools`。
- 刷新图片缓存链路文档：补齐 `web_article_cache_images_enabled`，并将 cache-images 说明改为“历史会话手动回填 + 统计反馈”。
- 同步 article comments 事实：更新为会在 article 同步时进入 Notion/Obsidian 评论区段，同时保持 local-first + Zip v2 备份恢复。
- 修复 deepwiki 中 `conversations-context.tsx` 的路径漂移：统一改为 `src/viewmodels/conversations/conversations-context.tsx`。
- 更新 `configuration.md` 的版本与权限事实：`manifest.version` 对齐 `1.5.1`，权限列表补齐 `tabGroups`。

## Coverage Notes
- 本次重点是“WebClipper inpage 交互与消息契约事实同步”：修正双击入口、补齐 `$ mention` 与消息分组，避免文档与代码行为冲突。
- deepwiki 继续覆盖配置、数据流、存储、测试、发布与排障；并维持“代码/配置优先于文档摘要”的约束。
- 仍保留的 Coverage Gaps：历史专项文档尚未拆为 deepwiki 独立专题页。

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
