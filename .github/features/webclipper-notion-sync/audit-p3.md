# Audit P3 - webclipper-notion-sync

- 审计方式：`plan-task-auditor`
- 审计范围：`plan-p3.md`
- feature 目录：`.github/features/webclipper-notion-sync/`
- 粒度：`phase`

## 任务看板

- [ ] P3-T1 在 Notion API 层补齐结构化错误字段并补解析测试
- [ ] P3-T2 在同步结果中引入 warning，并打通图片上传降级场景
- [ ] P3-T3 在反馈状态模型中接入 warning

## 任务到文件的映射

- P3-T1
  - `Extensions/WebClipper/src/sync/notion/notion-api.ts`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- P3-T2
  - `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
  - `Extensions/WebClipper/src/sync/models.ts`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- P3-T3
  - `Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts`
  - `Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`
  - `Extensions/WebClipper/tests/smoke/conversations-sync-feedback.test.ts`

## 发现项

待审计。

## 修复日志

- 待填充

## 验证日志

- 待填充

## 最终状态与剩余风险

- 当前状态：`Open`
- 剩余风险：`待 P3 实现与审计完成后更新`

## 审计约束

- 本文件对应一个 phase，不对应单个 task
- 如果由 `executing-plans` 自动进入审计，也沿用同一模板
- 可先由 `subagent` 产出 findings 初稿，再由主代理落盘、修复、验证
