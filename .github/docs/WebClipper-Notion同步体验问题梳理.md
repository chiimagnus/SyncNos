# WebClipper Notion 同步体验问题梳理

## 文档目的

梳理当前 WebClipper 在 Notion 同步链路上的已确认问题、根因、影响范围、当前状态与后续改造方向，作为后续分批修复的工作底稿。

当前梳理范围只覆盖 `Extensions/WebClipper/`，不涉及 SyncNos macOS App。

## 当前结论

当前 Notion 同步体验的问题不是单点缺陷，而是几个设计叠加后的结果：

- 错误上浮偏原始，用户经常直接看到 Notion HTTP 失败字符串。
- 大批量同步时整体策略偏保守，导致耗时明显变长。
- 一旦进入 rebuild 路径，会先清空整页再重建，用户感知很差。
- UI 反馈 notice 放在 sticky footer 里，失败信息一多就会遮挡 list view。

其中一部分问题已经在 commit `27a37395` 中做了第一轮修复，但主体体验问题仍未解决。

## 问题清单

### 1. Notion API 错误处理覆盖不足

状态：部分修复

现象：

- 同步失败时，UI 过去经常直接显示 `notion api failed: METHOD PATH HTTP STATUS BODY`。
- 用户能看到原始 HTTP/body，但很难判断下一步该怎么做。

代码现状：

- 原始错误封装在 [notion-api.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-api.ts#L22)。
- per-conversation 失败结果由 orchestrator 收集并回传到 UI：[notion-sync-orchestrator.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts#L546)
- UI 直接渲染失败文本：[ConversationSyncFeedbackNotice.tsx](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx#L114)

已完成改动：

- 已将常见 `validation_error`、401、403、404、429、5xx 归一化为更可读的提示：[notion-sync-orchestrator.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts#L58)

仍然存在的问题：

- 不是所有 Notion 失败都已分类。
- 某些 warning 仍然只在内部处理或记录，没有在 UI 侧形成结构化反馈。

### 2. `rich_text.length > 100` 会导致同步直接失败

状态：已修复

现象：

- 某些 markdown 内容会在转换成 Notion block 后，单个 `paragraph.rich_text` 片段数超过 100。
- Notion 返回 `validation_error`，导致当前 item 同步失败。

根因：

- 旧逻辑只按字符数切块，没有按 `rich_text` 项数切块。

代码位置：

- 旧问题点在 [notion-markdown-blocks.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-markdown-blocks.ts#L148)

已完成改动：

- 现在每个 block 同时受字符数和 `rich_text` 数量约束，最多 100 项：[notion-markdown-blocks.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-markdown-blocks.ts#L3) [notion-markdown-blocks.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/sync/notion/notion-markdown-blocks.ts#L148)

### 3. 运行中反馈文案重复

状态：已修复

现象：

- notice 同时显示 `Notion / Syncing / 70/263` 和 `Notion syncing 70/263`。
- 这不是两份状态，而是同一份状态被渲染了两次。

根因：

- notice header 已经显示 provider + phase + progress。
- notice body 又直接渲染 `feedback.message`，而 message 本身就是 `Notion syncing xx/xx`。

代码位置：

- 反馈消息生成：[useConversationSyncFeedback.ts](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts#L74)
- 重复渲染位置：[ConversationSyncFeedbackNotice.tsx](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx#L80)

已完成改动：

- 运行中 notice 只保留一套同步状态，正文改为 `Current` / `Stage`：[ConversationSyncFeedbackNotice.tsx](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx#L55)

### 4. 大量 item 同步到 Notion 时明显变慢

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

### 5. 页面内容一旦修改，会触发清空整个 Notion page 再重建

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

### 6. 清空 page children 的并发数只有 3

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

### 7. 同步反馈 notice 会遮挡 list view 内容

状态：已确认，未修复

现象：

- 当 warning / failure 条目较多时，底部同步 notice 会不断变高。
- 由于 notice 放在列表底部 sticky footer 中，会直接盖住 list view 底部 item。
- 用户无法正常看到最后几条 item，这是一个明显的 UI 缺陷。

代码位置：

- scroll 容器：[ConversationListPane.tsx](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx#L344)
- sticky footer：[ConversationListPane.tsx](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx#L445)
- notice 挂载位置：[ConversationListPane.tsx](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/ui/conversations/ConversationListPane.tsx#L594)
- notice 内容没有高度上限：[ConversationSyncFeedbackNotice.tsx](/Users/chii_magnus/Github_OpenSource/SyncNos/Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx#L114)

根因：

- notice 和操作栏一起放在 sticky bottom 容器内。
- notice 没有 max-height，也没有独立滚动区域。
- list 本身也没有根据 sticky footer 的动态高度增加底部安全间距。

建议方向：

- 给 failure 列表设置最大高度和内部滚动。
- notice 默认只显示摘要，例如前 3 条失败 + `View all`。
- 让详细错误进入独立 modal / drawer / detail panel，而不是无限拉高 footer。
- 为 list 内容增加与 footer 高度联动的底部 padding，避免最后几项被盖住。

## 优先级建议

### P0

- 修复 sticky notice 遮挡 list view 的问题。
- 优化大批量同步的总体耗时，至少先做有限并发和节流审视。

### P1

- 降低 rebuild 触发频率，尤其是 article。
- 细化 Notion 错误分类与用户可操作提示。

### P2

- 设计并落地 block-level mapping。
- 将 Notion 同步从 append/rebuild 二选一，升级为真正的增量 patch。

## 推荐拆分实施顺序

1. UI 修复：解决 notice 遮挡 list view。
2. 性能改造第一阶段：加 profiling、引入 conversation 级有限并发、重新审视固定 sleep。
3. rebuild 策略收敛：先把 article 的 rebuild 频率降下来。
4. 同步模型升级：引入 block-level mapping，支持只修改对应 block。

## 当前已完成事项

- 修复 `rich_text.length > 100` 导致的 Notion validation failure。
- 归一化常见 Notion 同步错误文案。
- 去掉运行中同步 notice 的重复文案。

对应提交：

- `27a37395` `fix(webclipper): harden notion sync errors and feedback`
