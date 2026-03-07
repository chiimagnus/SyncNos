# Audit P2 - webclipper-notion-sync

- 审计方式：`plan-task-auditor`
- 审计范围：`plan-p2.md`
- feature 目录：`.github/features/webclipper-notion-sync/`
- 粒度：`phase`

## 任务看板

- [ ] P2-T1 先打通现有 cursor 字段，再决定是否新增摘要字段
- [ ] P2-T2 将 article rebuild 条件改为正文级精确判定
- [ ] P2-T3 明确仅属性更新路径并补测试

## 任务到文件的映射

- P2-T1
  - `Extensions/WebClipper/src/sync/notion/notion-sync-cursor.ts`
  - `Extensions/WebClipper/src/conversations/data/storage-idb.ts`
  - `Extensions/WebClipper/src/sync/backup/backup-utils.ts`
- P2-T2
  - `Extensions/WebClipper/src/protocols/conversation-kinds.ts`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- P2-T3
  - `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

## 发现项

待审计。

## 修复日志

- 待填充

## 验证日志

- 待填充

## 最终状态与剩余风险

- 当前状态：`Open`
- 剩余风险：`待 P2 实现与审计完成后更新`

## 审计约束

- 本文件对应一个 phase，不对应单个 task
- 如果由 `executing-plans` 自动进入审计，也沿用同一模板
- 可先由 `subagent` 产出 findings 初稿，再由主代理落盘、修复、验证
