# Plan P1 - webclipper-notion-sync

**Goal:** 优化大批量同步到 Notion 的性能，先解决固定等待、统一退避、conversation 串行和清空 page children 并发过低的问题。

**Non-goals:** 本 phase 不改 rebuild 模型，不处理 warning 管线，不引入 block-level mapping。

**Approach:** 先建立性能观察基线，再把 append/delete 从固定 sleep 改成按错误退避，随后引入保守的 conversation 有限并发，并移除 orchestrator 的固定等待。最后调高清空 page children 的并发，并通过独立限流测试约束回归风险。

**Acceptance:**
- 大量 conversation 同步时，总体耗时明显下降。
- `compile`、`test`、`build` 通过。
- `429` / `503` 下有退避，不靠固定 sleep 维持稳定性。
- P1 审计通过，剩余风险收敛到 P2/P3。

---

## P1-T1 建立 Notion 同步性能基线

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

**Step 1: 实现功能**

在 orchestrator 内为单个 conversation 的关键阶段增加轻量诊断打点，至少覆盖：
- `load conversation`
- `ensure database`
- `check/create page`
- `build blocks`
- `clear page children`
- `append children`
- `save cursor`

要求：
- 仅用于本地诊断，不扩展现有 UI 数据模型。
- 结果可以写入内部 debug log 或临时 trace 辅助函数，不新增用户可见字段。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: TypeScript 编译通过，没有新增类型错误。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

Run: `git commit -m "chore: task1 - 增加notion同步性能诊断打点"`

---

## P1-T2 为 append/delete 建立统一的按需退避策略

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
- Create: `Extensions/WebClipper/tests/smoke/notion-sync-service-rate-limit.test.ts`

**Step 1: 实现功能**

把 Notion 请求节流从“固定 sleep”改成“按错误退避”。

要求：
- append 保留分批，但移除批次间固定 `250ms` sleep。
- delete 保留重试，并与 append 共享统一的 `429` / `503` 退避策略。
- 优先使用 `retryAfterMs`；没有时再走指数退避。
- 不引入无限重试。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- notion-sync-service-rate-limit`

Expected: append/delete 在 `429` / `503` 下会重试，正常路径不再固定等待。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-service.ts Extensions/WebClipper/tests/smoke/notion-sync-service-rate-limit.test.ts`

Run: `git commit -m "perf: task2 - 统一notion请求按需退避策略"`

---

## P1-T3 将 conversation 同步改为有限并发

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

把当前 `for (const id of ids)` 串行执行改成有限并发队列，初始并发控制在 `2` 或 `3`。

要求：
- 失败不能中断整个批次。
- 结果顺序必须固定，建议最终按输入顺序整理。
- `currentConversationId/currentStage/currentConversationTitle` 在 P1 仍表示“最近活跃项”，不尝试在当前 notice 中展示多个并发项。
- `done/total` 必须继续准确驱动进度条与摘要。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: 现有 notion 同步路由测试通过，并新增覆盖并发结果收集与 job 更新语义。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "feat: task3 - 为notion会话同步引入有限并发"`

---

## P1-T4 去掉 orchestrator 的固定 item 间隔

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

删除每个 conversation 完成后无条件等待 `250ms` 的逻辑。

要求：
- 正常路径不再固定 sleep。
- 与 P1-T2 的按需退避策略配合工作，不新增第二套节流。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync notion-sync-service-rate-limit`

Expected: 测试通过；同步结果状态不受影响；正常路径不再依赖固定等待。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "perf: task4 - 移除notion同步固定等待"`

---

## P1-T5 提高清空 page children 的并发并校验限流风险

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
- Modify: `Extensions/WebClipper/tests/smoke/notion-sync-service-rate-limit.test.ts`

**Step 1: 实现功能**

把 `CLEAR_DELETE_CONCURRENCY` 从 `3` 提高到一个保守但更合理的值，建议先用 `6`。

要求：
- 保留 `429` / `503` 重试。
- 只在统一退避策略已经落地后再调高并发。
- 如果测试显示高并发会显著放大重试次数，可回退到 `4` 或 `5`，不要死守 `6`。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- notion-sync-service-rate-limit`

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: 限流测试通过；编译通过。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-service.ts Extensions/WebClipper/tests/smoke/notion-sync-service-rate-limit.test.ts`

Run: `git commit -m "perf: task5 - 优化notion清空页面子块并发"`

---

## Phase Audit

- Run: `npm --prefix Extensions/WebClipper run compile`
- Run: `npm --prefix Extensions/WebClipper run test`
- Run: `npm --prefix Extensions/WebClipper run build`
- Audit file: `audit-p1.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入 `audit-p1.md` 的审计闭环，再推进到 P2
- Flow:
  1. 先由主代理或只读 `subagent` 记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
