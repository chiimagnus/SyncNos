# Plan P2 - webclipper-notion-sync

**Goal:** 降低 rebuild 触发频率，优先解决 article 轻微变化就整页重建的问题，并明确仅属性更新但不重建正文的路径。

**Non-goals:** 本 phase 不引入 block-level mapping；不做局部 patch；不改 warning UI。

**Approach:** 先打通 notion cursor 的现有字段，避免无谓扩表；再把 article rebuild 判定从粗粒度时间戳升级到正文级精确判定；最后明确“只更新 properties、不重建正文”的路径并补测试。

**Acceptance:**
- article 内容未变化时，不再默认 rebuild。
- 仅属性变化时不调用 `clearPageChildren()`。
- rebuild 相关回归测试通过。

---

## P2-T1 先打通现有 cursor 字段，再决定是否新增摘要字段

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

Run: `git commit -m "refactor: task1 - 打通notion重建判定所需游标字段"`

---

## P2-T2 将 article rebuild 条件改为正文级精确判定

**Files:**
- Modify: `Extensions/WebClipper/src/protocols/conversation-kinds.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`

**Step 1: 实现功能**

将 article 的 `shouldRebuild` 从“任意 `message.updatedAt > lastSyncedAt`”调整为更精确的规则。

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

Run: `git commit -m "fix: task2 - 收敛article同步重建触发条件"`

---

## P2-T3 明确仅属性更新路径并补测试

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

Run: `git commit -m "fix: task3 - 支持notion页面属性更新而不重建正文"`

---

## Phase Audit

- Run: `npm --prefix Extensions/WebClipper run compile`
- Run: `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync notion-sync-service-markdown notion-sync-service-rate-limit`
- Audit file: `audit-p2.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入 `audit-p2.md` 的审计闭环，再推进到 P3
- Flow:
  1. 先由主代理或只读 `subagent` 记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
