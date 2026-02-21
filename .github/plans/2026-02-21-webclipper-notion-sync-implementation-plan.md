# WebClipper Notion 同步修复（追加式增量 + Page 恢复 + UI 反馈）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:**  
修复 WebClipper（`Extensions/WebClipper/`）“聊天记录同步到 Notion 数据库”的 3 个问题：
1) 用户在 Notion 数据库中删除某个会话 Page 后，再次点 Sync 能自动重建并重新同步。  
2) 增量同步改为 **追加式**：只追加新消息，不再“先清空再全量写”。  
3) Sync 按钮提供明确的 **进行中/成功/失败** UI 反馈，并避免重复点击导致并发同步。

**Non-goals（非目标）:**  
- 不做“镜像式”同步（不保证 Notion Page 内容与本地完全一致；不回写本地对历史消息的编辑/删除）。  
- 不实现后台长任务的实时进度流（本期只做 popup 内的 in-progress 状态与最终结果）。  
- 不改动 macOS App 端（`SyncNos/`）同步逻辑。

**Approach（方案）:**  
- 引入 **同步游标（cursor）**：对每个会话保存 `lastSyncedMessageKey`（可选再加 `lastSyncedSequence` 兜底），用于计算“本次需要追加的新消息范围”。  
- 同步前校验 `notionPageId` 是否可用：`404/410`、`archived/in_trash`、或不属于目标 database 都视为失效 → 自动创建新 Page 并进行一次“全量追加”（作为重建）。  
- 当游标缺失/找不到对应 messageKey（升级/导入/本地数据变动）但 Page 仍存在时，按确认策略：**强制清空并重建 Page**（一次性恢复），再写入新的游标。  
- UI：Sync 期间按钮进入 loading/disabled；结束后展示汇总（OK/Failed），并在失败时给出可诊断错误。

**Acceptance（验收）:**  
- 删除 Notion 数据库中某条会话 Page（移入 Trash 或彻底删除）后，WebClipper 选择该会话点击 Sync：能自动创建新 Page 并写入内容；本地 mapping 更新为新 pageId。  
- 对已同步会话，新增消息后再次 Sync：Notion 只追加新增消息块；不清空历史内容。  
- Sync 期间 UI 明确显示“正在同步”，按钮不可重复触发；同步失败能看到错误信息；同步成功有正反馈。  
- `npm --prefix Extensions/WebClipper run test` 通过；`npm --prefix Extensions/WebClipper run check` 通过。

---

## P1（最高优先级）：追加式增量同步（cursor）+ Page 自动恢复

### Task 1: 定义 sync_mappings 的 cursor 字段规范

**Files:**
- Modify: `Extensions/WebClipper/src/storage/backup-utils.js`
- Modify: `Extensions/WebClipper/src/storage/schema.js`

**Step 1: 实现功能**
- 在 `sync_mappings` 记录中增加字段（不需要新 index）：
  - `lastSyncedMessageKey?: string`
  - `lastSyncedSequence?: number`（可选兜底）
  - `lastSyncedAt?: number`
- IndexedDB `DB_VERSION` 从 `2` 升到 `3`，确保旧库升级不丢数据（只增字段，无需迁移也能兼容）。
- 更新 `backup-utils.mergeSyncMappingRecord()`：cursor 字段遵循“本地优先、缺失才填充”的合并策略，避免导入备份把 cursor 倒退。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 现有测试通过（允许新增测试在后续任务补齐）。

---

### Task 2: backgroundStorage 增加读取/写入 sync_mappings(cursor) 的 API

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background-storage.js`

**Step 1: 实现功能**
- 新增方法（命名可调整，但需清晰表达职责）：
  - `getSyncMappingByConversation(conversationId)`：根据 conversations 表拿到 `(source, conversationKey)`，再从 `sync_mappings` 读出 mapping（含 notionPageId + cursor）。
  - `setSyncCursor(conversationId, { lastSyncedMessageKey, lastSyncedSequence, lastSyncedAt })`：upsert 到 `sync_mappings`。
  - `clearSyncCursor(conversationId)`：将 cursor 字段置空（用于触发重建逻辑）。
- 注意：`setConversationNotionPageId()` 需要继续同时更新 conversations.notionPageId 与 sync_mappings.notionPageId（保持现有 UI/逻辑兼容）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 全部通过。

---

### Task 3: notion-sync-service 提供 Page 可用性判断与“强制清空”能力

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`

**Step 1: 实现功能**
- 增加工具函数（示例）：
  - `isPageArchivedOrTrashed(page): boolean`：兼容 `archived` / `in_trash` 两种字段存在性。
  - `isPageUsableForDatabase(page, databaseId): boolean`：同时检查 parent database + archived/in_trash。
- 修复 `clearPageChildren()`：
  - `listChildren()` 需要处理分页（直到 `has_more=false`），确保“强制清空并重建”时真的能清空整页（不仅仅前 100 个 children）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 通过。

---

### Task 4: background-router 重写 notionSyncConversations 为“追加式增量”流程

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`

**Step 1: 实现功能**
对单个 conversation 的同步流程改为：
1. 读取 conversation、messages（按 sequence 排序）。
2. 读取 sync mapping（notionPageId + cursor）。
3. `ensureDatabase()` 得到目标 `dbId`。
4. 校验 `pageId`：
   - `GET /v1/pages/:id` 失败为 `404/410` → 视为不存在；
   - 或 `isPageArchivedOrTrashed(page)=true` → 视为不存在；
   - 或 `pageBelongsToDatabase(page, dbId)=false` → 视为不存在；
   - 任一满足：创建新 page → 追加“全量 blocks” → 写回 `notionPageId` + cursor。
5. page 可用时：
   - 根据 cursor 计算“新消息范围”：
     - 优先用 `lastSyncedMessageKey` 定位索引；
     - 找不到时按确认策略：**强制清空并重建**（`clearPageChildren` + append 全量），并重置 cursor；
   - 只对新消息调用 `messagesToBlocks(newMessages)` 并 `appendChildren()`。
6. 同步成功后更新 cursor（last message key/sequence/at），失败不更新 cursor。

错误处理要求：
- results 里对每个 conversation 记录结构化错误（保留 `HTTP status` 片段），便于 UI 展示。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 通过。

---

## P2：Sync 按钮 UI 反馈（进行中/成功/失败）

### Task 5: popup Sync 按钮进入 loading 并禁用重复触发

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/src/ui/styles/popup.css`（如需）

**Step 1: 实现功能**
- 在点击 Sync 后立刻：
  - `btnSyncNotion.disabled = true`
  - 按钮文案切换为 `Syncing...`（或加 spinner class）
  - try/finally 保证结束后恢复按钮状态与文案
- 同步失败时：
  - 不仅 `alert("Sync failed")`，还要展示后端返回的 `error.message`（保持“可诊断”）
- 同步成功时：
  - 保留 `flashOk()`，并将汇总结果展示更清晰（例如：OK/Failed + 前 N 条失败原因）

**Step 2: 验证（人工）**
- Chrome 加载已解压扩展 → popup 选择若干会话 → 点击 Sync：
  - Expected: 同步中按钮不可连点；结束后恢复；成功/失败提示正确。

---

### Task 6:（可选增强）在列表行展示最近一次同步结果（短期可诊断）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup-list.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-core.js`（如需扩展 state）
- Modify: `Extensions/WebClipper/src/bootstrap/background-storage.js`（如需持久化到 conversations）
- Modify: `Extensions/WebClipper/src/storage/schema.js`（如需新增 conversations 字段，谨慎）

**Step 1: 实现功能（两种二选一，建议先做轻量版）**
- 轻量版（不持久化）：popup 内存里维护 `lastSyncResultByConversationId`，同步完成后在当前 session 给 row 加一个小标记（OK/FAIL）。
- 持久化版：在 conversations 记录写入 `lastNotionSyncAt/lastNotionSyncStatus/lastNotionSyncError`，让刷新后也能看到（需要升级 schema，成本更高）。

**Step 2: 验证（人工）**
- Expected: 同步后列表能快速看出哪些成功/失败。

---

## P3：测试补齐 + 回归验证

### Task 7: 为“Page 失效自动重建 / cursor 增量追加 / cursor 缺失触发重建”补单测

**Files:**
- Modify: `Extensions/WebClipper/tests/smoke/notion-sync-service.test.ts`
- Create or Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`（如需新增）

**Step 1: 实现测试**
- `notion-sync-service`：
  - 测试 `isPageArchivedOrTrashed()` 对 `archived/in_trash` 的兼容。
  - 测试 `clearPageChildren()` 会分页清空（mock notionFetch 的 children 列表分页）。
- `background-router`（建议用最小 mock）：
  - page GET 返回 404 → createPage + append 全量 + 写回 mapping。
  - page 可用 + cursor 命中 → 只 append 新消息。
  - cursor 不命中但 page 存在 → clear + append 全量（重建）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: PASS

---

### Task 8: 最小回归（真实 Notion 环境 + 浏览器手动验证）

**Step 1: 回归清单**
- 新用户首次同步：创建数据库/创建 page/写入内容成功。
- 已同步会话：新增消息 → 再 Sync → 只追加新消息。
- Notion 删除 page：再 Sync → 自动创建新 page 并全量写入。
- cursor 缺失（模拟：清空 `sync_mappings` 中该会话 cursor 字段）但 page 存在：Sync → 清空并重建。

**Step 2: 验证命令**
- Run: `npm --prefix Extensions/WebClipper run check`
- Run: `npm --prefix Extensions/WebClipper run build`
- Expected: check/build 通过；扩展在浏览器中行为符合预期。

---

## 不确定项（需要执行中随手确认）
- Notion page 删除后的 API 返回字段：不同 workspace/版本可能返回 `archived` 或 `in_trash`；实现需同时兼容并以实际返回为准。  
- 大会话（children 很多）“清空并重建”可能触发 rate-limit：如遇频繁 429，需要在清空与追加阶段做更强 pacing（延迟/批大小调整）。

