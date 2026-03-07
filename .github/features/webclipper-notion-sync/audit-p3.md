# Audit P3 - webclipper-notion-sync

- 审计方式：`plan-task-auditor`
- 审计范围：`plan-p3.md`
- feature 目录：`.github/features/webclipper-notion-sync/`
- 粒度：`phase`

## 任务看板

- [x] P3-T1 在 Notion API 层补齐结构化错误字段并补解析测试
- [x] P3-T2 在同步结果中引入 warning，并打通图片上传降级场景
- [x] P3-T3 在反馈状态模型中接入 warning

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

本 phase 未发现需要返工的缺陷或明显回归风险。

已确认点：
- `notionFetch()` 失败时 `Error.message` 兼容性保留，同时补齐 `status/code/retryAfterMs/requestId/notionMessage` 字段。
- `warnings` 不影响 `ok/fail` 判定，且进入 per-conversation snapshot 与 UI feedback。
- notice 的摘要区仍保持紧凑；warning 详情仅在 popover 中展示，不重新遮挡 list view。

## 修复日志

- 已完成：P3-T1 `2a648df7`
- 已完成：P3-T2 `017ce2bf`
- 已完成：P3-T3 `bd6abc4f`

## 验证日志

- `npm --prefix Extensions/WebClipper run compile` passed
- `npm --prefix Extensions/WebClipper run test` passed

## 最终状态与剩余风险

- 当前状态：`Resolved`
- 剩余风险：warning 目前仅展示 `message`（未展开 `extra`）；若后续需要更强 debug 能力，可以在 popover 中按需追加折叠的 raw JSON 展示，但不应影响摘要区布局。

## 审计约束

- 本文件对应一个 phase，不对应单个 task
- 如果由 `executing-plans` 自动进入审计，也沿用同一模板
- 可先由 `subagent` 产出 findings 初稿，再由主代理落盘、修复、验证
