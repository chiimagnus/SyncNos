# WebClipper Notion 同步体验优化实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。
> 说明：按你的要求，计划直接维护在 `.github/docs/` 现有文档中，不另外新建 `.github/plans/` 文件。

**Goal（目标）:** 逐步解决 WebClipper 同步到 Notion 时的核心体验问题，先显著缩短大批量同步耗时，再减少整页清空重建，最后补齐错误与 warning 的结构化反馈。

**Non-goals（非目标）:** 本计划不改动 SyncNos macOS App；不在本轮引入新的同步目标；不修改国际化字段；不追求一次性把 Notion 同步重写为全新架构。

**Approach（方案）:** 先处理用户体感最差、风险可控的问题。第一阶段只动 orchestrator 和 sync service，把串行改成有限并发，并把固定 sleep 收敛为按需退避。第二阶段收敛 rebuild 触发条件，避免 article 轻微变化就清空整页。第三阶段再补错误与 warning 的结构化模型。最后单独做 block-level mapping，把同步模型从 append/rebuild 二选一升级为真正的增量 patch。

**Acceptance（验收）:**
- 选择大量 conversation 时，总体同步耗时明显下降，且 `compile`、`test`、`build` 通过。
- 内容发生轻微修改时，不再默认触发整页清空重建，至少 article 先收敛到更精确的 rebuild 策略。
- 常见 Notion 错误在 UI 中显示为可理解、可操作的信息；warning 有结构化上浮出口。
- block-level patch 方案落地后，局部内容变更只更新对应 block，不再清空整个 page。

---

## P1：优化大批量同步性能

### Task 1: 为 Notion 同步增加阶段耗时日志

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

**Step 1: 实现功能**

在 orchestrator 内为单个 conversation 的关键阶段打点，至少覆盖：
- `load conversation`
- `ensure database`
- `check/create page`
- `build blocks`
- `clear page children`
- `append children`
- `save cursor`

输出方式保持最小化，只记录到已有 job/result 数据附近，避免侵入 UI。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: TypeScript 编译通过，没有新增类型错误。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

Run: `git commit -m "chore: task1 - 增加notion同步阶段耗时打点"`

### Task 2: 将 conversation 同步改为有限并发

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

**Step 1: 实现功能**

把当前 `for (const id of ids)` 串行执行改成有限并发队列，初始并发控制在 `2` 或 `3`。

要求：
- 仍然保留稳定的 `currentConversationId/currentStage` 更新能力。
- 失败不能中断整个批次。
- 结果顺序可以按完成顺序，也可以额外整理回输入顺序，但要固定。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: 现有 notion 同步路由测试通过。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

Run: `git commit -m "feat: task2 - 为notion会话同步引入有限并发"`

### Task 3: 去掉 orchestrator 的固定 250ms item 间隔

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

**Step 1: 实现功能**

删除每个 conversation 完成后无条件等待 `250ms` 的逻辑。

要求：
- 正常路径不再固定 sleep。
- 如果并发控制已经存在，不要重复节流。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: 测试通过；同步结果状态不受影响。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

Run: `git commit -m "perf: task3 - 移除notion串行同步固定等待"`

### Task 4: 将 append 节流改为按错误退避

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
- Test（如需）: `Extensions/WebClipper/tests/smoke/notion-sync-service-markdown.test.ts`

**Step 1: 实现功能**

保留 `APPEND_BATCH` 分批，但移除批次间固定 `250ms` sleep，改成：
- 正常请求连续发送
- 仅在 `429` / `503` 时按 `retryAfterMs` 或指数退避重试

要求：
- append 和 delete 的重试策略保持一致风格。
- 不引入无限重试。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- notion-sync-service-markdown`

Expected: 现有 markdown/notion sync service 测试通过。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-service.ts Extensions/WebClipper/tests/smoke/notion-sync-service-markdown.test.ts`

Run: `git commit -m "perf: task4 - 将notion追加节流改为按需退避"`

### Task 5: 提高清空 page children 的并发并保留重试

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`

**Step 1: 实现功能**

把 `CLEAR_DELETE_CONCURRENCY` 从 `3` 提高到一个保守但更合理的值，建议先用 `6`。

要求：
- 保留 `429` / `503` 重试。
- 不和 append 并发调优混成一个大改。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: 编译通过。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`

Run: `git commit -m "perf: task5 - 提高清空notion页面子块并发数"`

### Task 6: 完成性能阶段回归验证

**Files:**
- Modify: 无代码改动，执行验证

**Step 1: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Run: `npm --prefix Extensions/WebClipper run test`

Run: `npm --prefix Extensions/WebClipper run build`

Expected: 全部通过；Notion 同步主链路无编译或测试回归。

**Step 2: 原子提交**

无需提交；作为 P1 的阶段验收检查点。

## P2：降低 rebuild 触发频率

### Task 7: 明确 article 当前 rebuild 判定所依赖的数据

**Files:**
- Modify: `Extensions/WebClipper/src/protocols/conversation-kinds.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-cursor.ts`
- Modify: `Extensions/WebClipper/src/conversations/data/storage-idb.ts`

**Step 1: 实现功能**

先补齐 cursor 可用字段，避免只靠 `lastSyncedAt` 判断。

建议新增或优先使用：
- `lastSyncedMessageUpdatedAt`
- 可选的内容摘要字段，例如 `lastSyncedContentHash`

要求：
- 新字段必须向后兼容旧 mapping。
- 旧数据不存在该字段时，不能直接抛错。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: 编译通过；旧 mapping 读取逻辑兼容。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/protocols/conversation-kinds.ts Extensions/WebClipper/src/sync/notion/notion-sync-cursor.ts Extensions/WebClipper/src/conversations/data/storage-idb.ts`

Run: `git commit -m "refactor: task7 - 补齐notion重建判定所需同步游标字段"`

### Task 8: 将 article rebuild 条件从粗粒度时间戳改为更精确判定

**Files:**
- Modify: `Extensions/WebClipper/src/protocols/conversation-kinds.ts`
- Test（如需）: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

将 article 的 `shouldRebuild` 从“任意 message.updatedAt > lastSyncedAt”调整为更精确的规则。

优先方案：
- 只比较会影响 Notion 页面正文的消息
- 优先比较 `messageKey + updatedAt` 或内容摘要，而不是全量 `lastSyncedAt`

要求：
- 新增消息仍然走 append。
- 仅元数据变化时只更新 page properties，不触发 rebuild。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: article 内容未变化时不 rebuild；新增消息仍正常 append。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/protocols/conversation-kinds.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "fix: task8 - 收敛article同步重建触发条件"`

### Task 9: 为“只更新属性不重建正文”补路径验证

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Test（如需）: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

确保在 `shouldRebuild === false` 且 `inc.newMessages.length === 0` 时，仍能安全更新 page properties，但不清空正文。

要求：
- 不要因为 page properties 更新而误触发 clear/append。
- `no_changes` 模式和“仅属性更新”模式要有清晰区分，必要时新增 mode。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: 正文未变时不调用 `clearPageChildren()`；属性可更新。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "fix: task9 - 支持notion页面属性更新而不重建正文"`

### Task 10: 完成 rebuild 收敛阶段回归验证

**Files:**
- Modify: 无代码改动，执行验证

**Step 1: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync notion-sync-service-markdown`

Expected: rebuild 相关行为符合预期，回归测试通过。

**Step 2: 原子提交**

无需提交；作为 P2 的阶段验收检查点。

## P3：补齐错误与 warning 的结构化反馈

### Task 11: 在 Notion API 层补齐结构化错误字段

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-api.ts`

**Step 1: 实现功能**

在 `notionFetch()` 抛错时补齐结构化字段，至少包括：
- `status`
- `code`
- `retryAfterMs`
- `requestId`
- `notionMessage`

要求：
- 保留现有 `Error.message` 兼容性。
- 解析失败时回退到原始文本。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: 编译通过。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-api.ts`

Run: `git commit -m "refactor: task11 - 为notion错误补齐结构化字段"`

### Task 12: 在 orchestrator 中引入 warning 数据结构

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/src/sync/models.ts`

**Step 1: 实现功能**

为 per-conversation 结果增加 warning 容器，先覆盖现有已知场景，例如：
- 图片上传失败后回退 external image
- 可恢复但影响体验的 Notion 降级路径

要求：
- warning 不影响 `ok/fail` 判定。
- 返回结构兼容现有 UI。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: 编译通过；同步结果类型定义一致。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts Extensions/WebClipper/src/sync/models.ts`

Run: `git commit -m "feat: task12 - 为notion同步结果增加warning结构"`

### Task 13: 在反馈状态模型中接入 warning

**Files:**
- Modify: `Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts`
- Modify: `Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`

**Step 1: 实现功能**

将 warning 纳入 feedback state，但默认只做摘要展示和详情承载，不扩大 notice 占位。

要求：
- 不破坏已经修好的 popover 交互。
- warning 与 failure 分开展示。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- conversations-sync-feedback`

Expected: 反馈 notice 测试通过，warning 不遮挡列表。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`

Run: `git commit -m "feat: task13 - 在同步反馈中展示notion警告信息"`

### Task 14: 完成错误与 warning 阶段回归验证

**Files:**
- Modify: 无代码改动，执行验证

**Step 1: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Run: `npm --prefix Extensions/WebClipper run test`

Expected: 错误与 warning 数据流无类型或测试回归。

**Step 2: 原子提交**

无需提交；作为 P3 的阶段验收检查点。

## P4：引入 block-level mapping，支持局部 patch

### Task 15: 设计并落地 sync mapping 扩展字段

**Files:**
- Modify: `Extensions/WebClipper/src/platform/idb/schema.ts`
- Modify: `Extensions/WebClipper/src/conversations/data/storage-idb.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-cursor.ts`

**Step 1: 实现功能**

为 sync mapping 增加 message/block 映射字段，至少能表达：
- 本地 messageKey
- 对应的 notion block id 列表
- 渲染摘要或 hash
- 更新时间

要求：
- IndexedDB 升级必须兼容旧数据。
- 新字段允许缺省，避免老用户升级后全部失效。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: schema 与读写逻辑一致，编译通过。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/platform/idb/schema.ts Extensions/WebClipper/src/conversations/data/storage-idb.ts Extensions/WebClipper/src/sync/notion/notion-sync-cursor.ts`

Run: `git commit -m "feat: task15 - 扩展notion同步映射支持块级关联"`

### Task 16: 首次同步时保存 message 到 Notion blocks 的映射

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

**Step 1: 实现功能**

在 create / rebuild / append 成功后，把每条消息生成的 block id 回写到本地 mapping。

前提：
- 需要确保 append 返回后可拿到可追踪的 block 信息；如果 Notion API 响应不足，需要在设计上增加分批追踪策略。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: 编译通过；本地映射能成功写入。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-service.ts Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`

Run: `git commit -m "feat: task16 - 持久化消息到notion块的映射关系"`

### Task 17: 对受影响消息执行局部 archive + append

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
- Test（如需）: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

当检测到已有消息内容变化时：
- 仅 archive 该消息对应的旧 blocks
- 仅 append 该消息的新 blocks
- 更新该消息的 block mapping

要求：
- 没有 mapping 的旧数据继续回退到 rebuild，不能直接失败。
- 局部 patch 失败时允许保守回退 rebuild，但要记录 warning。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: 局部更新路径通过；无 mapping 的老数据仍可同步。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts Extensions/WebClipper/src/sync/notion/notion-sync-service.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "feat: task17 - 支持notion消息块局部更新"`

### Task 18: 完成全链路回归验证

**Files:**
- Modify: 无代码改动，执行验证

**Step 1: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Run: `npm --prefix Extensions/WebClipper run test`

Run: `npm --prefix Extensions/WebClipper run build`

Expected: Notion 同步全链路相关测试与构建通过。

**Step 2: 原子提交**

无需提交；作为 P4 的阶段验收检查点。

## 边界条件

- 旧用户本地 mapping 不包含新字段时，必须自动降级，不允许因 schema 升级导致同步完全失效。
- 有些 conversation 没有 `notionPageId` 或目标 page 已被删除，性能优化不能改变已有恢复逻辑。
- 并发提升后要重点关注 `429`、`503` 和 job 状态更新是否错乱。
- 局部 patch 只在 mapping 完整时启用；老数据或脏数据必须允许回退 rebuild。

## 回归策略

- 每完成一个优先级分组，就至少执行一次：
  - `npm --prefix Extensions/WebClipper run compile`
  - `npm --prefix Extensions/WebClipper run test`
- 完成 P1 和 P4 后，再额外执行：
  - `npm --prefix Extensions/WebClipper run build`

## 不确定项

- `Task 16` 依赖 Notion append 后是否能稳定拿到 block id；如果当前 API 包装层拿不到，需要在执行前先确认追踪方案。
- `Task 9` 是否需要单独引入“仅属性更新” mode，需要在实现时根据现有 UI 文案成本决定。
- `Task 12` 的 warning 首批覆盖范围建议先控制在已知场景，不要一次做成过大的错误码字典。

## 下一步

- 直接进入执行：优先从 `P1 / Task 1` 开始，按任务逐个实现、验证、原子提交。
- 先 review：如果你想调整优先级、任务颗粒度或 commit 策略，我再改这份计划。
