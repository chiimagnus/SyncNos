# 运维与运行操作（Operations）

## 页面目标
本页聚焦“如何稳定运行与交付 SyncNos 双产品线”，覆盖：日常运行检查、故障处置路径、发布前后操作、备份与恢复。

- 产品语义入口先读：[business-context.md](business-context.md)
- 架构与数据边界参考：[architecture.md](architecture.md)、[storage.md](storage.md)、[api.md](api.md)
- 商店发布细节参考：[release.md](release.md)

## 运行面矩阵

| 运行面 | 主体 | 关键进程/入口 | 关键状态 | 主要风险 |
| --- | --- | --- | --- | --- |
| macOS App | SwiftUI + AppKit | `SyncNosApp.swift`, `AppDelegate.swift` | onboarding/paywall 状态、自动同步开关、IAP 状态 | 登录态过期、同步中断、用户强退 |
| WebClipper 内容侧 | content script | `src/entrypoints/content.ts` | inpage 显示模式、自动保存开关 | 页面未刷新导致开关未生效、采集不完整 |
| WebClipper 后台侧 | MV3 service worker | `src/entrypoints/background.ts` | 消息路由、sync job 状态、OAuth 回调监听 | 多实例残留 job、消息类型漂移 |
| WebClipper 设置侧 | popup/app UI | `SettingsScene.tsx`, `useSettingsSceneController.ts` | Notion/Obsidian 设置、备份导入导出、Insight 只读统计 | 设置与真实存储不一致 |
| CI/CD 发布侧 | GitHub Actions | `.github/workflows/webclipper-*.yml` | tag、manifest.version、渠道凭据 | 版本不一致、商店凭据缺失 |

## 日常运行检查清单

| 检查项 | App | WebClipper | 频率 |
| --- | --- | --- | --- |
| 构建可用性 | `xcodebuild` 成功 | `npm run compile && npm run build` 成功 | 每次改动 |
| 核心链路可用性 | 至少一条来源可同步到 Notion | 至少一个 chat/article 可落本地并可手动同步 | 每次改动 |
| 配置写入有效性 | onboarding/autoSync/IAP 状态切换正常 | `inpage_display_mode`、`ai_chat_auto_save_enabled`、`ai_chat_cache_images_enabled`、`chat_with_*` 写入可回读 | 每次改动 |
| 备份恢复可用性 | - | Zip v2 导出与导入（merge）正常，且 `article_comments` 能往返 | 每个里程碑 |
| 发布一致性 | - | `manifest.version == tag 去掉 v` | 每次发版 |

## 同步作业生命周期

```mermaid
flowchart LR
  A[触发同步] --> B[读取本地事实源]
  B --> C{目标系统可用?}
  C -- 否 --> D[记录状态/报错]
  C -- 是 --> E[append 或 rebuild]
  E --> F[更新 mapping/cursor]
  F --> G[广播 UI 变更]
```

| 作业类型 | 触发入口 | 状态锚点 | 失败后策略 |
| --- | --- | --- | --- |
| App 自动同步 | `AutoSyncService.start()` | App 本地 store + Notion 写入结果 | 保留本地状态，允许下次重试 |
| Notion 手动同步（扩展） | `NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS` | `sync_mappings` + job store | cursor 不匹配时转 rebuild |
| Obsidian 同步（扩展） | `OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS` | Obsidian sync status + 本地 messages | PATCH 失败自动回退 full rebuild |
| 图片回填（扩展） | `BACKFILL_CONVERSATION_IMAGES` | `updatedMessages/downloadedCount` | 回填失败不阻塞主会话保存 |

## 备份与恢复操作

| 场景 | 操作入口 | 预期结果 | 备注 |
| --- | --- | --- | --- |
| 导出备份 | `exportBackupZipV2()` | 生成 `SyncNos-Backup-*.zip` | 含 manifest、sources、config、image-cache、`article-comments/index.json` |
| 导入 Zip v2 | `importBackupZipV2Merge()` | merge 到本地库，不强制覆盖 | 丢失 bundle 时会 fallback 扫描 `sources/**/*.json`，并恢复 `article_comments` |
| 导入 legacy JSON | `importBackupLegacyJsonMerge()` | 与现有数据合并 | 保留本地非空字段优先 |
| 恢复后核验 | Settings + 列表 + Insight | 会话/消息/评论数量与 UI 可见结果一致 | Insight 只读，不回写新状态 |

## 事件与故障处置 Runbook

| 现象 | 首查文件 | 快速动作 |
| --- | --- | --- |
| 扩展升级后无弹窗引导 | `background.ts` | 确认 `onInstalled` 仅 `install` 打开 About（预期行为） |
| 切换 inpage 开关无变化 | `bootstrap/content.ts` | 刷新页面或新开页面后再验证 |
| `cache-images` 提示更新 0 条 | `image-backfill-job.ts` | 检查是否 chat 会话且消息内存在可下载图片链接 |
| Notion OAuth 回调失败 | `sync/notion/auth/oauth.ts`, worker `index.ts` | 核对 pending state、worker secret、429/超时情况 |
| 发布 workflow 报版本不匹配 | `wxt.config.ts`, `webclipper-*.yml` | 对齐 `manifest.version` 与 tag |

## 运维边界与 Coverage Gaps

- 仓库内已覆盖 WebClipper 的自动化发布与扩展运行面。
- macOS App Store 提交/签名链路仍未在仓库内公开自动化脚本，属于仓库外流程。

## 来源引用（Source References）
- `macOS/SyncNos/SyncNosApp.swift`
- `macOS/SyncNos/AppDelegate.swift`
- `macOS/SyncNos/Services/SyncScheduling/AutoSyncService.swift`
- `webclipper/src/entrypoints/background.ts`
- `webclipper/src/entrypoints/content.ts`
- `webclipper/src/bootstrap/content.ts`
- `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- `webclipper/src/conversations/background/handlers.ts`
- `webclipper/src/conversations/background/image-backfill-job.ts`
- `webclipper/src/sync/backup/export.ts`
- `webclipper/src/sync/backup/import.ts`
- `webclipper/src/sync/backup/backup-utils.ts`
- `webclipper/src/sync/notion/auth/oauth.ts`
- `webclipper/cloudflare-workers/syncnos-notion-oauth/index.ts`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
- `.github/workflows/webclipper-edge-publish.yml`
