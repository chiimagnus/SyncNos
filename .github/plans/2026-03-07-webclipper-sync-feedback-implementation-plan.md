# WebClipper Sync Feedback 实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 从结构上修复 WebClipper 会话列表中的 Notion / Obsidian 同步反馈问题，让 popup 面板和 app 路由版都具备可见的进行中反馈、完成总结、以及失败时的直接提示。

**Non-goals（非目标）:**
- 不修改国际化字段。
- 不重做设置页整体信息架构，也不顺手改 unrelated UI 文案。
- 不引入与 `chrome.storage.local` 并列的全新持久化后端；允许在现有 sync job / status 通道上收敛为共享 sync job store。
- 不改动 Notion / Obsidian 具体同步算法本身，除非为统一返回契约所必需。

**Approach（方案）:** 这次修复不在按钮上补文案，也不继续依赖原生 `alert()`。核心思路是把“同步任务反馈”上升为共享契约：先统一前后台同步结果与 job status 的类型，并把 Notion / Obsidian 收敛到同一套持久化 sync job store，再在 `ConversationsProvider` 中接入一个共享的 sync task controller，负责启动任务、hydrate 既有任务、接管正在运行的 job、轮询后台进度、归一化成功/部分失败/失败结果，最后由 `ConversationListPane` 渲染统一的反馈 UI。因为 popup 与 app 都复用 `src/ui/conversations/*`，只要控制器与列表面板修好，两端会一起修复。

**Acceptance（验收）:**
- popup 与 app 会话列表点击 `Notion` / `Obsidian` 后，能看到明确的“同步中”反馈，而不是只有按钮禁用。
- 同步完成后，若全部成功，能看到成功总结；若部分失败或全部失败，能直接看到失败提示和失败摘要。
- 前置校验失败（例如未连接 Notion、未配置 Obsidian Key）与执行中单条会话失败，前端都走同一套反馈模型，不再依赖原生 `alert()` 才能暴露错误。
- `ConversationsProvider` 不再只维护 `boolean` busy 状态，而是维护可被 UI 消费的结构化 sync feedback state。
- 至少补一组针对 `ConversationsProvider/ConversationListPane` 的回归测试，覆盖 “运行中 -> 成功” 和 “运行中 -> 部分失败/失败”。
- 完成后运行：
  - `npm --prefix Extensions/WebClipper run compile`
  - `npm --prefix Extensions/WebClipper run test`
  - `npm --prefix Extensions/WebClipper run build`

---

## P1（最高优先级）：统一同步反馈契约与前端控制器

### Task 1: 统一 sync 返回类型，消灭 `any` 和“resolve 但 silent fail”的盲区

**Files:**
- Create: `Extensions/WebClipper/src/sync/sync-job-store.ts`
- Modify: `Extensions/WebClipper/src/sync/models.ts`
- Modify: `Extensions/WebClipper/src/sync/repo.ts`
- Modify: `Extensions/WebClipper/src/platform/messaging/message-contracts.ts`
- Modify: `Extensions/WebClipper/src/sync/background-handlers.ts`
- Modify: `Extensions/WebClipper/src/entrypoints/background.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-job-store.ts`
- Modify: `Extensions/WebClipper/src/sync/obsidian/obsidian-sync-orchestrator.ts`
- Create: `Extensions/WebClipper/src/sync/obsidian/obsidian-sync-job-store.ts`

**Step 1: 定义共享类型**

在 `src/sync/models.ts` 中补充明确的共享契约，并在 `src/sync/sync-job-store.ts` 中实现 provider 共享的持久化 job store，至少包含：
- `SyncProvider = 'notion' | 'obsidian'`
- `SyncPerConversationResult`
- `SyncRunSummary`
- `SyncJobSnapshot`
- `SyncJobStatusResponse`

要求：
- 两个 provider 最终都能映射到同一组字段：`status`、`conversationIds`、`perConversation`、`okCount`、`failCount`、`startedAt`、`finishedAt`
- 避免继续暴露 `any`

**Step 2: 统一 repo 层返回值**

在 `src/sync/repo.ts` 中：
- 为 `syncNotionConversations` / `syncObsidianConversations` 标注明确返回类型
- 为 `getNotionSyncJobStatus` / `getObsidianSyncStatus` 标注统一后的状态类型
- 保持现有消息协议名不变，只收敛类型和 unwrap 后的数据形状

**Step 3: 对齐 orchestrator 输出**

在两个 orchestrator 中确保：
- 正常完成时都返回可直接被 UI 消费的 `SyncRunSummary`
- job/status 字段含义一致，避免 Notion 的 `done`、Obsidian 的 `finished` 在前端重复分支
- `failures` 列表和 `perConversation` 保留足够信息供 UI 直接展示

**Step 4: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected:
- TypeScript 编译通过
- `src/sync/repo.ts` 中不再有同步返回值的 `any`

**Step 5:（可选）原子提交**

Run: `git add Extensions/WebClipper/src/sync/models.ts Extensions/WebClipper/src/sync/repo.ts Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts Extensions/WebClipper/src/sync/obsidian/obsidian-sync-orchestrator.ts`

Run: `git commit -m "refactor: task1 - normalize webclipper sync result contracts"`

### Task 2: 在 conversations 层引入共享 sync task controller

**Files:**
- Modify: `Extensions/WebClipper/src/ui/conversations/conversations-context.tsx`
- Create: `Extensions/WebClipper/src/ui/conversations/conversation-sync-feedback.ts` 或 `Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts`

**Step 1: 提取统一任务状态模型**

新增共享控制器，负责：
- 启动 `Notion` / `Obsidian` 同步
- 保存当前 provider、运行状态、起止时间、done/total、失败摘要
- 轮询后台 job/status（优先复用现有 `getNotionSyncJobStatus` / `getObsidianSyncStatus`）
- 将 “前置异常 reject” 和 “后台结果 failCount > 0” 统一归一化成前端反馈状态

建议状态最少包含：
- `phase: 'idle' | 'running' | 'success' | 'partial-failed' | 'failed'`
- `provider`
- `message`
- `done`
- `total`
- `failures`
- `updatedAt`

**Step 2: 收编 `conversations-context` 里的同步逻辑**

在 `conversations-context.tsx` 中：
- 移除 `syncingNotion` / `syncingObsidian` 仅靠 `boolean` 的设计
- 用共享 controller 输出的结构化 state 替代
- 删除同步相关的 `alert(...)`
- 保留 `busy` 语义，但从 controller 派生，而不是散落在多个 `try/finally`

**Step 3: 处理轮询生命周期**

要求：
- 只在同步运行期间轮询，结束后停止
- provider 切换时不串状态
- 组件卸载时清理 timer
- 如果 popup 因扩展重载失效，不让 UI 留在永久 running

**Step 4: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected:
- `ConversationsProvider` 暴露的同步状态已变成结构化对象
- 代码中不再存在同步相关的 `alert(...)`

**Step 5:（可选）原子提交**

Run: `git add Extensions/WebClipper/src/ui/conversations/conversations-context.tsx Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts`

Run: `git commit -m "feat: task2 - add shared webclipper sync feedback controller"`

### Task 3: 在共享列表 UI 中渲染运行中 / 成功 / 失败反馈

**Files:**
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx`
- Create: `Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`（若需要）

**Step 1: 设计统一反馈区域**

在列表底部操作区附近增加共享反馈 UI，要求：
- 同步运行时可见当前 provider 和进度，例如 `3 / 8`
- 成功时显示简洁总结
- 部分失败 / 全部失败时显示明确错误提示，且能看到失败条目数，必要时展示前几条失败原因
- 使用 React 组件内反馈，不使用浏览器原生 `alert()`

**Step 2: 保持按钮语义清晰**

按钮层需要：
- 继续有 disabled 保护，避免并发重复提交
- 运行中状态和反馈条不互相替代；按钮只负责触发，反馈条负责表达任务状态
- popup 与 app 不做两套实现，统一由 `ConversationListPane` 消费 context

**Step 3: 处理可访问性与关闭策略**

建议：
- 错误/部分失败提示使用 `role="alert"` 或 `aria-live`
- 成功提示允许自动消失或手动关闭，但行为要统一
- running 态不能自动闪退，必须在任务结束后再转场

**Step 4: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected:
- `ConversationListPane` 不再只显示 `Notion...` / `Obsidian...`
- 同步反馈在 popup/app 共用列表中都可复用

**Step 5:（可选）原子提交**

Run: `git add Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`

Run: `git commit -m "feat: task3 - render shared sync progress and failure feedback"`

## P2（高优先级）：回归测试与边界兜底

### Task 4: 为 conversations sync feedback 补回归测试

**Files:**
- Create: `Extensions/WebClipper/tests/smoke/conversations-sync-feedback.test.ts`
- Modify: `Extensions/WebClipper/src/ui/conversations/conversations-context.tsx`（如需导出可测试 helper）
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx`（如需稳定选择器）

**Step 1: 补 running -> success 场景**

测试至少覆盖：
- 点击同步后进入 running 状态
- UI 显示 provider 与进度
- 后台状态结束后，UI 显示成功总结

**Step 2: 补 running -> partial-failed / failed 场景**

测试至少覆盖：
- 后台返回 `failCount > 0`
- UI 直接展示失败提示，而不是静默 resolve
- 失败摘要可见，且按钮从 running 恢复

**Step 3: 补 preflight error 场景**

测试至少覆盖：
- repo 层直接 reject
- UI 仍走统一反馈通道，而不是依赖原生 `alert`

**Step 4: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/conversations-sync-feedback.test.ts`

Expected:
- 新增 smoke test 通过

**Step 5:（可选）原子提交**

Run: `git add Extensions/WebClipper/tests/smoke/conversations-sync-feedback.test.ts`

Run: `git commit -m "test: task4 - cover webclipper sync feedback states"`

### Task 5: 全量回归并检查残留的旧反馈实现

**Files:**
- Modify: `Extensions/WebClipper/src/ui/conversations/conversations-context.tsx`（如全量验证后需收尾）
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx`（如需收尾）

**Step 1: 清理残留旧路径**

确认以下残留被清掉：
- conversations sync 路径上的原生 `alert(...)`
- 仅靠 `syncingNotion/syncingObsidian` 布尔值判断的旧代码
- 因 Notion / Obsidian status 形状不一致造成的临时分支

**Step 2: 运行全量验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Run: `npm --prefix Extensions/WebClipper run test`

Run: `npm --prefix Extensions/WebClipper run build`

Expected:
- 三个命令全部通过
- popup / app 共用会话同步链路无类型错误、无 smoke 回归

**Step 3: 手工冒烟**

建议手工验证：
- popup 中选择多条会话，触发 Notion 同步，观察 running / success / failure UI
- app 路由版侧边栏中执行同样动作，确认反馈一致
- 制造一个可控失败（例如断开 Obsidian 服务或使用无效配置），确认失败直接可见

**Step 4:（可选）原子提交**

Run: `git add Extensions/WebClipper/src/ui/conversations/conversations-context.tsx Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx Extensions/WebClipper/src/sync/models.ts Extensions/WebClipper/src/sync/repo.ts Extensions/WebClipper/tests/smoke/conversations-sync-feedback.test.ts`

Run: `git commit -m "fix: task5 - finalize webclipper sync feedback flow"`

---

## 边界条件

- Notion / Obsidian 在启动前就失败：前端必须直接显示错误，不能 silent fail，也不能只靠 console。
- 同步过程中部分会话失败：整体 Promise 可能 resolve，但 UI 仍必须进入 `partial-failed`，不能当成功处理。
- popup 关闭 / 扩展重载 / service worker 重启：running 状态不能永久悬挂；轮询恢复后应从后台 status 重建可见状态，或安全退出到 failed/idle。
- 重复点击：running 期间禁止重复提交同 provider，同步按钮状态与反馈状态必须来源一致。
- 零选择：保持现有禁用逻辑，不需要新增提示噪声。

## 回归策略

- 每完成一个 Task，至少跑一次 `npm --prefix Extensions/WebClipper run compile`
- 完成 P1 后先跑新增的 targeted smoke test
- 全部完成后跑 `compile + test + build`

## 不确定项

- 成功/失败反馈在 UI 上是采用“可关闭 banner”还是“自动消失 notice”，实现前可在不改整体架构的前提下再定视觉细节。
- 如果现有后台 status 对 popup 关闭后恢复不够稳定，执行阶段可能需要补一处最小的后台状态归一化收尾，但仍应限制在同步反馈契约内。

## 交接给执行

- 直接进入执行：使用 `executing-plans` 按 Task 顺序实现，并按任务粒度做原子提交。
- 先 review：如果你要先调计划粒度或 UI 反馈形式，我先改计划，再开始执行。
