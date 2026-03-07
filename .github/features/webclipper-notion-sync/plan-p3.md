# Plan P3 - webclipper-notion-sync

**Goal:** 补齐 Notion 错误与 warning 的结构化反馈，让同步失败和降级结果能稳定进入反馈模型，而不是继续散落在原始错误字符串或静默分支里。

**Non-goals:** 本 phase 不处理 block-level mapping；不重做 notice 的整体交互；不扩展到其他同步目标。

**Approach:** 先在 Notion API 层把原始错误结构化，再把可恢复但影响体验的降级路径整理成 warning，最后把 warning 接入现有反馈 notice，但保持已经修好的 popover 交互和占位约束。

**Acceptance:**
- 常见 Notion 错误具备结构化字段。
- 图片上传等降级路径能上浮为 warning。
- feedback notice 可以承载 warning，但不重新遮挡列表。

---

## P3-T1 在 Notion API 层补齐结构化错误字段并补解析测试

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-api.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

在 `notionFetch()` 抛错时补齐结构化字段，至少包括：
- `status`
- `code`
- `retryAfterMs`
- `requestId`
- `notionMessage`

要求：
- 保留现有 `Error.message` 兼容性。
- 优先从响应体解析 `request_id` 和 `message`；缺失时回退到原始文本。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: 新增错误解析断言通过；兼容现有 orchestrator 行为。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-api.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "refactor: task1 - 为notion错误补齐结构化字段"`

---

## P3-T2 在同步结果中引入 warning，并打通图片上传降级场景

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/src/sync/models.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

为 per-conversation 结果增加 warning 容器，先覆盖现有已知场景，例如：
- 图片上传失败后回退 external image
- 可恢复但影响体验的 Notion 降级路径

要求：
- warning 不影响 `ok/fail` 判定。
- 当前 `buildBlocksForSync()` 内对图片上传失败是直接吞掉，需要改成返回 warning，而不是继续静默。
- 返回结构兼容现有 UI。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: 降级场景会返回 warning；同步结果类型定义一致。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts Extensions/WebClipper/src/sync/models.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "feat: task2 - 为notion同步结果增加warning结构"`

---

## P3-T3 在反馈状态模型中接入 warning

**Files:**
- Modify: `Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts`
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`
- Modify: `Extensions/WebClipper/tests/smoke/conversations-sync-feedback.test.ts`

**Step 1: 实现功能**

将 warning 纳入 feedback state，但默认只做摘要展示和详情承载，不扩大 notice 占位。

要求：
- 不破坏已经修好的 popover 交互。
- warning 与 failure 分开展示。
- 摘要区仍以进度和结果统计为主，避免重新出现 notice 遮挡 list 的问题。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- conversations-sync-feedback`

Expected: 反馈 notice 测试通过，warning 不遮挡列表。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx Extensions/WebClipper/tests/smoke/conversations-sync-feedback.test.ts`

Run: `git commit -m "feat: task3 - 在同步反馈中展示notion警告信息"`

---

## Phase Audit

- Run: `npm --prefix Extensions/WebClipper run compile`
- Run: `npm --prefix Extensions/WebClipper run test`
- Audit file: `audit-p3.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入 `audit-p3.md` 的审计闭环
- Flow:
  1. 先由主代理或只读 `subagent` 记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
