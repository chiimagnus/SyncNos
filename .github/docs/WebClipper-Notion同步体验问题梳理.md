# WebClipper Notion 同步体验问题梳理

## 文档目的

梳理当前 WebClipper 在 Notion 同步链路上仍未解决的问题、根因、影响范围与后续改造方向，作为后续分批修复的工作底稿。

当前梳理范围只覆盖 `Extensions/WebClipper/`，不涉及 SyncNos macOS App。

## 当前结论

当前 Notion 同步体验的主要剩余问题集中在三类：

- 大批量同步时整体策略偏保守，导致耗时明显变长。
- 一旦进入 rebuild 路径，会先清空整页再重建，用户感知很差。
- 错误与 warning 的上浮仍不完整，某些失败对用户不够可操作。

## 未完成问题清单

### 1. Notion API 错误处理覆盖仍然不足

状态：部分修复，仍未完成

现象：

- 某些同步失败仍然只会给出偏底层的错误描述，用户很难直接判断下一步该怎么做。
- 某些 warning 只在内部处理或记录，没有在 UI 形成结构化反馈。

代码现状：

- 原始错误封装在 [notion-api.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-api.ts#L22)。
- per-conversation 失败结果由 orchestrator 收集并回传到 UI：[notion-sync-orchestrator.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts#L546)
- UI 最终展示同步失败内容：[ConversationSyncFeedbackNotice.tsx](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx#L122)

仍然存在的问题：

- 不是所有 Notion 失败都已分类。
- warning 没有统一的数据结构和 UI 出口。
- 失败提示仍然缺少“用户下一步该怎么做”的清晰建议。

建议方向：

- 继续补齐常见错误类型的归一化。
- 为 warning 增加结构化上浮机制。
- 将错误提示从“日志式”改为“可操作式”。

### 2. 大量 item 同步到 Notion 时明显变慢

状态：未修复

现象：

- 当选择很多会话时，总耗时明显增加。
- 用户会感知为“同步 Notion 很慢”。

已确认的直接原因：

- 会话是串行处理的，没有 conversation 级有限并发：[notion-sync-orchestrator.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts#L305)
- 每个 item 结束后额外等待 `250ms`：[notion-sync-orchestrator.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts#L561)
- append 采用 `90` 个 block 一批，批次间固定等待 `250ms`：[notion-sync-service.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-service.ts#L8) [notion-sync-service.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-service.ts#L230)
- 一旦进入 rebuild，还要先 delete 全页 children，再全量 append。

判断：

- 当前慢的根因不只是 `CLEAR_DELETE_CONCURRENCY = 3`。
- 更大的问题是“串行 + 固定 sleep + rebuild 成本高”。

建议方向：

- 先做同步阶段耗时 profiling。
- 引入 conversation 级有限并发，建议从 `2-3` 开始。
- 重新评估 append 节流策略，避免固定 sleep 过于保守。
- 优先减少 rebuild 触发频率，而不是先盲目调大 delete 并发。

### 3. 页面内容一旦修改，会触发清空整个 Notion page 再重建

状态：设计限制，未修复

现象：

- 某些内容变更后，再同步会先把目标 page 的 blocks 清掉，再重新写入。
- 用户会感知为页面被“清空再重建”，体验很差。

当前实现：

- 若 cursor 丢失，直接进入 rebuild：[notion-sync-cursor.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-cursor.ts#L36)
- orchestrator 在 rebuild 分支里会先 `clearPageChildren()`，再重新 `appendChildren()`：[notion-sync-orchestrator.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts#L462)
- article 只要正文消息 `updatedAt > lastSyncedAt`，就会触发 `shouldRebuild`：[conversation-kinds.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/protocols/conversation-kinds.ts#L178)

为什么现在做不到“只改对应 block”：

- 当前本地 mapping 只存：
  - `notionPageId`
  - `lastSyncedMessageKey`
  - `lastSyncedSequence`
  - `lastSyncedAt`
  - `lastSyncedMessageUpdatedAt`
- 当前没有任何 block 级映射，也不知道“本地哪条消息对应 Notion 哪个 block id”。[storage-idb.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/conversations/data/storage-idb.ts#L336)

结论：

- 从产品体验看，“只修改对应 block”是正确方向。
- 但这不是小修，需要引入 message/block 级同步映射和新的 diff/update 策略。

建议方向：

- 第一步：先避免 article 轻微变化就整页 rebuild。
- 第二步：为每条消息或每个渲染段建立稳定 block mapping。
- 第三步：改造为 message-level 或 block-level patch，同步只替换受影响片段。

### 4. 清空 page children 的并发数只有 3

状态：待评估

现象：

- 当前 delete 并发数固定为 `3`。[notion-sync-service.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-service.ts#L10)

判断：

- `3` 的确偏保守。
- 但它只是 rebuild 路径上的次级瓶颈，不是整体慢的第一根因。
- 如果不同时调整节流和 429 退避策略，单纯拉高并发更容易打到 Notion rate limit。

建议方向：

- 作为第二阶段优化项。
- 可以考虑从 `3 -> 6` 做受控实验，同时监测 `429` 比例与整体耗时。
- 更理想的做法是把 delete/append 节流改造成“自适应”，而不是靠硬编码常量。

## 当前优先级建议

### P1

- 优化大批量同步的总体耗时，先做有限并发和节流审视。

### P2

- 降低 rebuild 触发频率，尤其是 article。
- 细化 Notion 错误分类与用户可操作提示。

### P3

- 设计并落地 block-level mapping。
- 将 Notion 同步从 append/rebuild 二选一，升级为真正的增量 patch。

## 推荐拆分实施顺序

1. 性能改造第一阶段：加 profiling、引入 conversation 级有限并发、重新审视固定 sleep。
2. rebuild 策略收敛：先把 article 的 rebuild 频率降下来。
3. 错误与 warning 继续结构化。
4. 同步模型升级：引入 block-level mapping，支持只修改对应 block。
