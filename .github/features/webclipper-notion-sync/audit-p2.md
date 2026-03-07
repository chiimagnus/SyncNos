# Audit P2 - webclipper-notion-sync

- 审计方式：`plan-task-auditor`
- 审计范围：`plan-p2.md`
- feature 目录：`.github/features/webclipper-notion-sync/`
- 粒度：`phase`

## 任务看板

- [x] P2-T1 先打通现有 cursor 字段，再决定是否新增摘要字段
- [x] P2-T2 将 article rebuild 条件改为正文级精确判定
- [x] P2-T3 明确仅属性更新路径并补测试

## 任务到文件的映射

- P2-T1
  - `Extensions/WebClipper/src/sync/notion/notion-sync-cursor.ts`
  - `Extensions/WebClipper/src/sync/backup/backup-utils.ts`
  - `Extensions/WebClipper/tests/unit/notion-sync-cursor.test.ts`
  - `Extensions/WebClipper/tests/domains/backup-utils.test.ts`
- P2-T2
  - `Extensions/WebClipper/src/protocols/conversation-kinds.ts`
  - `Extensions/WebClipper/tests/smoke/conversation-kinds.test.ts`
  - `Extensions/WebClipper/tests/smoke/notion-sync-orchestrator-kind-routing.test.ts`
- P2-T3
  - `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

## 发现项

## 发现 F-01

- 任务：`P2-T1`
- 严重级别：`Medium`
- 状态：`Resolved`
- 位置：`Extensions/WebClipper/src/sync/backup/backup-utils.ts:153`
- 摘要：`mergeSyncMappingRecord() 会在保留本地 lastSyncedMessageKey/lastSyncedSequence 的同时，直接填入来自备份的 lastSyncedMessageUpdatedAt，可能把不同消息的 cursor 字段拼成一个不一致的组合。`
- 风险：`导入或合并备份后，article 的重建判定可能把本地锚点消息和备份里的 updatedAt 混用，导致正文变更被漏判，或者无意义地触发 rebuild。`
- 预期修复：`只有在最终采用同一条 incoming cursor 锚点时才接收 incoming.lastSyncedMessageUpdatedAt；如果本地 key/sequence 已占优且与 incoming 不一致，则保持为空或保留本地值。`
- 验证：`npm --prefix Extensions/WebClipper run test -- notion-sync-cursor backup-utils`
- 解决证据：`mergeSyncMappingRecord() 现在只会在 chosen cursor 与 incoming anchor 一致时接收 incoming.lastSyncedMessageUpdatedAt，并补了 mismatch/match 两条回归测试。`

## 发现 F-02

- 任务：`P2-T3`
- 严重级别：`Medium`
- 状态：`Resolved`
- 位置：`Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts:642`
- 摘要：`当前 properties-only 分支会在所有 shouldRebuild=false 且没有新消息的同步上无条件调用 updatePageProperties()，即使实际上没有任何属性变化。`
- 风险：`真正的 no-op 同步现在也会额外发 Notion PATCH，请求可能被限流或失败，从而把原本应成功的 no-op 同步变成失败；结果 mode 也从 no_changes 漂移成 updated_properties。`
- 预期修复：`仅在确认 metadata 发生变化时才进入 properties-only 路径；真正无变化时保持 no_changes，并补一条“无变化不发 PATCH”的回归测试。`
- 验证：`npm --prefix Extensions/WebClipper run test -- background-router-notion-sync notion-sync-orchestrator-kind-routing`
- 解决证据：`orchestrator 现在会先比较 Notion 现有 page properties 与目标 properties，只有存在差异时才发 PATCH；新增了 unchanged article 维持 no_changes 的回归测试。`

## 修复日志

- 已修复 F-01：避免在 backup merge 时混用不同 cursor 锚点的 lastSyncedMessageUpdatedAt。
- 已修复 F-02：仅在 properties 实际变化时才进入 updated_properties；真正无变化时保留 no_changes。

## 验证日志

- `npm --prefix Extensions/WebClipper run test -- notion-sync-cursor backup-utils background-router-notion-sync notion-sync-orchestrator-kind-routing` -> PASS
- `npm --prefix Extensions/WebClipper run compile` -> PASS
- `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync notion-sync-service-markdown notion-sync-service-rate-limit notion-sync-cursor backup-utils conversation-kinds notion-sync-orchestrator-kind-routing` -> PASS

## 最终状态与剩余风险

- 当前状态：`Resolved`
- 剩余风险：`P2 已避免 article 的无效 rebuild，但还没有 block-level mapping，正文局部 patch 仍留待后续 phase。`

## 审计约束

- 本文件对应一个 phase，不对应单个 task
- 如果由 `executing-plans` 自动进入审计，也沿用同一模板
- 可先由 `subagent` 产出 findings 初稿，再由主代理落盘、修复、验证
