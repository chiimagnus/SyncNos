# WebClipper Notion 同步体验优化实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。
> 说明：按你的要求，计划直接维护在 `.github/docs/` 现有文档中，不另外新建 `.github/plans/` 文件。
> 审计状态：本版已按当前代码实现做过一次执行前审计，修正了任务顺序、测试覆盖、数据模型边界和 block patch 落地方式。

**Goal（目标）:** 逐步解决 WebClipper 同步到 Notion 时的核心体验问题，先显著缩短大批量同步耗时，再减少整页清空重建，最后补齐错误与 warning 的结构化反馈，并为真正的局部 block patch 建立数据基础。

**Non-goals（非目标）:** 本计划不改动 SyncNos macOS App；不在本轮引入新的同步目标；不修改国际化字段；不追求一次性重写整个 Notion 同步架构；不在性能阶段同时大改 UI 展示模型。

**Approach（方案）:** 先处理用户体感最差、风险可控的问题。P1 先把 Notion 请求节流从“固定 sleep”改成“按错误退避”，再引入 conversation 级有限并发，避免一边提速一边把 429 打爆。P2 收敛 rebuild 触发条件，优先解决 article 轻微变化就整页重建的问题。P3 再补齐错误与 warning 的结构化数据流。P4 最后引入 block mapping，但不把 mapping 塞进现有 `sync_mappings` 大对象里，而是使用独立 store，避免后续 cursor 更新频繁重写大记录。

**Acceptance（验收）:**
- 选择大量 conversation 时，总体同步耗时明显下降，且 `compile`、`test`、`build` 通过。
- 内容发生轻微修改时，不再默认触发整页清空重建，至少 article 先收敛到更精确的 rebuild 策略。
- 常见 Notion 错误在 UI 中显示为可理解、可操作的信息；warning 有结构化上浮出口。
- block-level patch 方案落地后，局部内容变更只更新对应消息段的 top-level blocks，不再清空整个 page。

---

## 审计后修订重点

- 原计划把“提速”和“提高并发”放在“退避治理”之前，顺序不安全。现已调整为：先统一请求退避，再提高 orchestrator 并发。
- 原计划默认并发后仍沿用单一 `currentConversationId/currentStage`，但没有说明语义。现已明确：P1 不改 UI 结构，只把该字段视为“最近活跃项”的代表值，进度以 `done/total` 为准。
- 原计划对 append/delete 的验证过弱，`notion-sync-service-markdown.test.ts` 无法覆盖限流重试。现已补充独立的 service 限流/重试测试任务。
- 原计划把 block mapping 塞进 `sync_mappings`，长期会导致单条记录过大、cursor 更新成本过高，也遗漏了 backup 导入导出链路。现已改为独立 store，并显式纳入 `schema`、`backup export`、`backup import`、`backup merge`。
- 原计划的“局部 archive + append”没有处理正文顺序。现已明确：patch 必须保存 top-level block 顺序，优先使用 anchor-based insert；拿不到可靠 anchor 时回退 rebuild。

## P1：优化大批量同步性能

### Task 1: 建立 Notion 同步性能基线

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

### Task 2: 为 append/delete 建立统一的按需退避策略

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

### Task 3: 将 conversation 同步改为有限并发

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

### Task 4: 去掉 orchestrator 的固定 item 间隔

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

删除每个 conversation 完成后无条件等待 `250ms` 的逻辑。

要求：
- 正常路径不再固定 sleep。
- 与 Task 2 的按需退避策略配合工作，不新增第二套节流。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync notion-sync-service-rate-limit`

Expected: 测试通过；同步结果状态不受影响；正常路径不再依赖固定等待。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "perf: task4 - 移除notion同步固定等待"`

### Task 5: 提高清空 page children 的并发并校验限流风险

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

### Task 7: 先打通现有 cursor 字段，再决定是否新增摘要字段

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-cursor.ts`
- Modify: `Extensions/WebClipper/src/conversations/data/storage-idb.ts`
- Modify: `Extensions/WebClipper/src/sync/backup/backup-utils.ts`

**Step 1: 实现功能**

先把当前已有但未被 notion cursor 充分利用的字段打通，优先使用：
- `lastSyncedMessageUpdatedAt`

只有在现有字段不足以准确判断正文变化时，才新增摘要字段，例如：
- `lastSyncedContentHash`

要求：
- 新字段必须向后兼容旧 mapping。
- 如果新增持久化字段，必须同步更新 backup merge 逻辑。
- 不要在这一 task 提前引入 block mapping。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: 编译通过；旧 mapping 读取逻辑兼容。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-cursor.ts Extensions/WebClipper/src/conversations/data/storage-idb.ts Extensions/WebClipper/src/sync/backup/backup-utils.ts`

Run: `git commit -m "refactor: task7 - 打通notion重建判定所需游标字段"`

### Task 8: 将 article rebuild 条件改为正文级精确判定

**Files:**
- Modify: `Extensions/WebClipper/src/protocols/conversation-kinds.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

将 article 的 `shouldRebuild` 从“任意 message.updatedAt > lastSyncedAt”调整为更精确的规则。

优先方案：
- 只比较会影响 Notion 正文 block 的消息
- 优先比较 `messageKey + updatedAt` 或正文内容摘要
- 元数据字段变动不直接触发 rebuild

要求：
- 新增消息仍然走 append。
- 仅元数据变化时只更新 page properties，不重建正文。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: article 内容未变化时不 rebuild；正文变化时仍可正确进入 rebuild 或后续 patch 路径。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/protocols/conversation-kinds.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "fix: task8 - 收敛article同步重建触发条件"`

### Task 9: 明确“仅属性更新”路径并补测试

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

确保在 `shouldRebuild === false` 且 `inc.newMessages.length === 0` 时，可以安全更新 page properties，但不清空正文。

要求：
- 不要因为 page properties 更新而误触发 clear/append。
- 如需新增 mode，优先使用类似 `updated_properties` 的明确命名。
- 如果最终决定不新增 mode，也要在测试中明确断言“更新属性但未重建正文”。

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

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync notion-sync-service-markdown notion-sync-service-rate-limit`

Expected: rebuild 相关行为符合预期，回归测试通过。

**Step 2: 原子提交**

无需提交；作为 P2 的阶段验收检查点。

## P3：补齐错误与 warning 的结构化反馈

### Task 11: 在 Notion API 层补齐结构化错误字段并补解析测试

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

Run: `git commit -m "refactor: task11 - 为notion错误补齐结构化字段"`

### Task 12: 在同步结果中引入 warning，并打通图片上传降级场景

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

Run: `git commit -m "feat: task12 - 为notion同步结果增加warning结构"`

### Task 13: 在反馈状态模型中接入 warning

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

### Task 15: 新增独立的 Notion block mapping store

**Files:**
- Modify: `Extensions/WebClipper/src/platform/idb/schema.ts`
- Modify: `Extensions/WebClipper/src/conversations/data/storage-idb.ts`
- Modify: `Extensions/WebClipper/src/sync/backup/export.ts`
- Modify: `Extensions/WebClipper/src/sync/backup/import.ts`
- Modify: `Extensions/WebClipper/src/sync/backup/backup-utils.ts`

**Step 1: 实现功能**

新增独立 store，例如 `notion_block_mappings`，不要把 message/block 映射直接塞进现有 `sync_mappings`。

建议字段至少包括：
- `source`
- `conversationKey`
- `messageKey`
- `sequence`
- `contentFingerprint`
- `topLevelBlockIds`
- `updatedAt`

要求：
- IndexedDB 升级必须兼容旧数据。
- backup export / import / merge 必须同步支持该 store。
- 保持 `sync_mappings` 继续只承载 cursor 和 page 级信息。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run compile`

Expected: schema、读写、backup 相关代码一致，编译通过。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/platform/idb/schema.ts Extensions/WebClipper/src/conversations/data/storage-idb.ts Extensions/WebClipper/src/sync/backup/export.ts Extensions/WebClipper/src/sync/backup/import.ts Extensions/WebClipper/src/sync/backup/backup-utils.ts`

Run: `git commit -m "feat: task15 - 新增notion块级同步映射存储"`

### Task 16: 在 create/rebuild/append 后持久化 top-level block 映射

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

在 create / rebuild / append 成功后，把每条消息生成的 top-level block id 回写到本地 mapping。

要求：
- 只追踪 top-level blocks，不追踪子块，避免映射复杂度失控。
- 必须确认 Notion append 返回结果能与输入批次稳定对应。
- 如果 API 返回顺序不足以可靠映射，就把 append 颗粒度收窄到“单消息一批”，不要盲目写入错误映射。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: 本地映射能成功写入，且 messageKey 与 top-level block ids 的对应关系稳定。

**Step 3: 原子提交**

Run: `git add Extensions/WebClipper/src/sync/notion/notion-sync-service.ts Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

Run: `git commit -m "feat: task16 - 持久化消息到notion顶层块映射"`

### Task 17: 对受影响消息执行局部 patch，并保持正文顺序

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

当检测到已有消息内容变化时：
- archive 该消息对应的旧 top-level blocks
- 在可靠 anchor 后插入该消息的新 blocks
- 更新该消息的 block mapping

要求：
- patch 必须保持原有消息顺序，不能简单删掉旧块再 append 到 page 末尾。
- 优先使用前一条未变消息的最后一个 top-level block 作为 insert anchor。
- 没有 mapping、anchor 缺失、或 patch 失败时，允许保守回退 rebuild，但要记录 warning。

**Step 2: 验证**

Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`

Expected: 局部更新路径通过；消息顺序不乱；无 mapping 的老数据仍可同步。

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

- 旧用户本地 mapping 不包含新字段或新 store 时，必须自动降级，不允许因 schema 升级导致同步完全失效。
- 有些 conversation 没有 `notionPageId` 或目标 page 已被删除，性能优化不能改变已有恢复逻辑。
- 并发提升后要重点关注 `429`、`503` 和 job 状态更新是否错乱。
- P1 不扩大 UI 状态模型；并发阶段的 notice 仍只展示一个“最近活跃项”代表值。
- 局部 patch 只在 mapping 和 anchor 都完整时启用；老数据或脏数据必须允许回退 rebuild。

## 回归策略

- 每完成一个优先级分组，就至少执行一次：
  - `npm --prefix Extensions/WebClipper run compile`
  - `npm --prefix Extensions/WebClipper run test`
- 完成 P1 和 P4 后，再额外执行：
  - `npm --prefix Extensions/WebClipper run build`

## 不确定项

- `Task 16` 依赖 Notion append 响应与输入 top-level blocks 的对应关系；执行前必须先用真实响应样本确认。
- `Task 9` 是否需要单独新增 `updated_properties` mode，需要根据 UI 文案成本决定。
- `Task 17` 依赖 Notion children append 的 anchor 插入能力；如果 API 限制导致无法可靠插入，需要在执行时重新评估 patch 颗粒度。

## 下一步

- 直接进入执行：优先从 `P1 / Task 1` 开始，按任务逐个实现、验证、原子提交。
- 先 review：如果你想再压缩范围，我建议把 P1 先收缩为 `Task 2-5`，把 `Task 1` 保留为可选诊断项。
