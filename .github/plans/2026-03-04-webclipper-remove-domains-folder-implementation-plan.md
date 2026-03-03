# WebClipper 去掉 `src/domains/`（按业务重排）实施计划

> 执行方式：建议使用`executing-plans` 按批次实现与验收。

**Goal（目标）:** 在不改业务行为的前提下，移除 `Extensions/WebClipper/src/domains/` 这一层目录，把其内容移动到 `src/` 顶层按业务命名的目录中（例如 `src/conversations/`、`src/backup/`），并更新全仓引用路径，使 `npm --prefix Extensions/WebClipper run compile` 与 `npm --prefix Extensions/WebClipper run test` 通过。

**Non-goals（非目标）:**
- 不做功能改动（采集、写库、导出、Notion/Obsidian 同步、备份导入导出行为不变）
- 不改权限、manifest、WXT 构建逻辑
- 不改任何国际化相关字段/资源
- 不做命名规则变更（文件命名、消息 type、schema version 等保持不变）
- 不在本次把 `src/export/`、`src/integrations/`、`src/collectors/` 全部合并重排（这属于后续可选 P2/P3）

**Approach（方案）:**
- 仅做“目录移动 + import 路径更新”的机械重构，尽量保持文件名与导出 API 不变。
- 以业务域为单位迁移：`conversations` -> `backup` -> `settings` -> `sync`，每个域完成后立即跑 `tsc` 编译验证，降低一次性改动面。
- 迁移结束后用 `rg` 确认仓库内不再出现 `domains/` 路径引用。

**Acceptance（验收）:**
- 代码层：
  - Run: `npm --prefix Extensions/WebClipper run compile`
  - Expected: 0 error
  - Run: `npm --prefix Extensions/WebClipper run test`
  - Expected: 全绿（Vitest PASS）
- 构建层（回归）：
  - Run: `npm --prefix Extensions/WebClipper run build`
  - Run: `npm --prefix Extensions/WebClipper run build:firefox`
  - Expected: 产物生成成功（`.output/chrome-mv3/` 与 `.output/firefox-mv3/`）
- 人工冒烟（最小）：
  - 在任一支持站点打开页面，确认 inpage icon 可出现、单击保存出现 tip（Saved/错误提示），popup 可正常打开并列出会话。

---

## P1（最高优先级）：移除 `src/domains/`（不改行为）

### Task 1: 建立目标目录骨架（仅创建目录）

**Files:**
- Create (dirs):
  - `Extensions/WebClipper/src/conversations/`
  - `Extensions/WebClipper/src/backup/`
  - `Extensions/WebClipper/src/settings/`
  - `Extensions/WebClipper/src/sync/`

**Step 1: 实现**
- 创建上述目录（空目录即可）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译仍通过（此步骤不应引入任何 TS 变更）

### Task 2: 迁移 `conversations` 域文件（移动 + 修正域内 import）

**Files:**
- Move:
  - `Extensions/WebClipper/src/domains/conversations/models.ts` -> `Extensions/WebClipper/src/conversations/models.ts`
  - `Extensions/WebClipper/src/domains/conversations/storage-idb.ts` -> `Extensions/WebClipper/src/conversations/storage-idb.ts`
  - `Extensions/WebClipper/src/domains/conversations/storage.ts` -> `Extensions/WebClipper/src/conversations/storage.ts`
  - `Extensions/WebClipper/src/domains/conversations/write.ts` -> `Extensions/WebClipper/src/conversations/write.ts`
  - `Extensions/WebClipper/src/domains/conversations/markdown.ts` -> `Extensions/WebClipper/src/conversations/markdown.ts`
  - `Extensions/WebClipper/src/domains/conversations/file-naming.ts` -> `Extensions/WebClipper/src/conversations/file-naming.ts`
  - `Extensions/WebClipper/src/domains/conversations/background-storage.ts` -> `Extensions/WebClipper/src/conversations/background-storage.ts`
  - `Extensions/WebClipper/src/domains/conversations/background-handlers.ts` -> `Extensions/WebClipper/src/conversations/background-handlers.ts`
  - `Extensions/WebClipper/src/domains/conversations/repo.ts` -> `Extensions/WebClipper/src/conversations/repo.ts`

**Step 1: 实现**
- 执行文件移动（保持文件名与导出不变）
- 逐个修正 moved 文件内部的相对 import（典型变化：`../../platform/...` -> `../platform/...`，`../../runtime-context.ts` -> `../runtime-context.ts`）
- 确保 moved 文件彼此之间的 `./xxx` 引用仍成立（如 `./models`、`./storage-idb`）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: `conversations` 域自身无编译错误

### Task 3: 更新引用 `conversations` 域的 import 路径（跨域调用点）

**Files:**
- Modify:
  - `Extensions/WebClipper/entrypoints/background.ts`
  - `Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx`
  - `Extensions/WebClipper/src/export/bootstrap.ts`
  - `Extensions/WebClipper/src/export/notion/notion-sync-orchestrator.ts`
  - `Extensions/WebClipper/src/export/obsidian/obsidian-note-path.ts`
  - `Extensions/WebClipper/src/export/obsidian/obsidian-sync-orchestrator.ts`
  - `Extensions/WebClipper/src/integrations/web-article/article-fetch.ts`
  - `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`
  - `Extensions/WebClipper/tests/smoke/article-fetch-service.test.ts`
  - `Extensions/WebClipper/tests/smoke/background-router-testkit.ts`
  - `Extensions/WebClipper/tests/smoke/obsidian-sync-orchestrator.test.ts`
  - `Extensions/WebClipper/tests/storage/conversations-idb.test.ts`

**Step 1: 实现**
- 把 `../src/domains/conversations/...` / `../../src/domains/conversations/...` / `../../../domains/conversations/...` 等路径替换为新的 `.../src/conversations/...` 或 `.../conversations/...`
- 重点检查：
  - `entrypoints/background.ts` 的 handler 注册路径
  - `article-fetch.ts` 对 `storage` 的引用路径
  - `export/*` 对 `background-storage` / `file-naming` 的引用路径
  - `tests/smoke/obsidian-sync-orchestrator.test.ts` 里动态 `loadModule()` 路径字符串

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过

### Task 4: 迁移 `backup` 域文件（移动 + 修正域内 import）

**Files:**
- Move:
  - `Extensions/WebClipper/src/domains/backup/backup-utils.ts` -> `Extensions/WebClipper/src/backup/backup-utils.ts`
  - `Extensions/WebClipper/src/domains/backup/zip-utils.ts` -> `Extensions/WebClipper/src/backup/zip-utils.ts`
  - `Extensions/WebClipper/src/domains/backup/idb.ts` -> `Extensions/WebClipper/src/backup/idb.ts`
  - `Extensions/WebClipper/src/domains/backup/export.ts` -> `Extensions/WebClipper/src/backup/export.ts`
  - `Extensions/WebClipper/src/domains/backup/import.ts` -> `Extensions/WebClipper/src/backup/import.ts`

**Step 1: 实现**
- 执行文件移动（保持文件名与导出不变）
- 修正 moved 文件内部的相对 import（典型变化：`../../platform/...` -> `../platform/...`）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过

### Task 5: 更新引用 `backup` 域的 import 路径（含 UI 与测试）

**Files:**
- Modify:
  - `Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx`
  - `Extensions/WebClipper/entrypoints/popup/tabs/SettingsTab.tsx`
  - `Extensions/WebClipper/src/export/local/zip-utils.ts`
  - `Extensions/WebClipper/src/storage/backup-utils.ts`
  - `Extensions/WebClipper/src/ui/app/routes/Backup.tsx`
  - `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`
  - `Extensions/WebClipper/tests/domains/backup-zip-utils.test.ts`
  - `Extensions/WebClipper/tests/domains/backup-utils.test.ts`
  - `Extensions/WebClipper/tests/domains/backup-service.test.ts`

**Step 1: 实现**
- 替换 import 路径到 `Extensions/WebClipper/src/backup/*`
- 测试文件路径不强制改名，但 import 必须能找到新模块

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过

### Task 6: 迁移 `settings` 域文件（移动 + 修正域内 import）

**Files:**
- Move:
  - `Extensions/WebClipper/src/domains/settings/sensitive.ts` -> `Extensions/WebClipper/src/settings/sensitive.ts`
  - `Extensions/WebClipper/src/domains/settings/background-handlers.ts` -> `Extensions/WebClipper/src/settings/background-handlers.ts`

**Step 1: 实现**
- 执行文件移动
- 修正相对 import（尤其是对 `platform/messaging/*`、`integrations/notion/*`、`integrations/obsidian/*` 的路径层级变化）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过

### Task 7: 更新引用 `settings` 域的 import 路径（popup/app/background）

**Files:**
- Modify:
  - `Extensions/WebClipper/entrypoints/background.ts`
  - `Extensions/WebClipper/entrypoints/popup/tabs/SettingsTab.tsx`
  - `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`

**Step 1: 实现**
- 替换 `domains/settings/...` 为 `settings/...`

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过

### Task 8: 迁移 `sync` 域文件（移动 + 修正域内 import）

**Files:**
- Move:
  - `Extensions/WebClipper/src/domains/sync/models.ts` -> `Extensions/WebClipper/src/sync/models.ts`
  - `Extensions/WebClipper/src/domains/sync/repo.ts` -> `Extensions/WebClipper/src/sync/repo.ts`
  - `Extensions/WebClipper/src/domains/sync/background-handlers.ts` -> `Extensions/WebClipper/src/sync/background-handlers.ts`

**Step 1: 实现**
- 执行文件移动
- 修正相对 import（尤其是对 `integrations/notion/sync/orchestrator.ts`、`integrations/obsidian/sync/orchestrator.ts` 的路径变化）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过

### Task 9: 更新引用 `sync` 域的 import 路径（popup/app/background + tests）

**Files:**
- Modify:
  - `Extensions/WebClipper/entrypoints/background.ts`
  - `Extensions/WebClipper/entrypoints/popup/tabs/ChatsTab.tsx`
  - `Extensions/WebClipper/entrypoints/popup/tabs/SettingsTab.tsx`
  - `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`
  - `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`
  - `Extensions/WebClipper/src/ui/app/routes/SyncJobs.tsx`
  - `Extensions/WebClipper/tests/smoke/background-router-testkit.ts`

**Step 1: 实现**
- 替换 `domains/sync/...` 为 `sync/...`

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过

### Task 10: 删除 `src/domains/` 并清理残余引用

**Files:**
- Delete (dir):
  - `Extensions/WebClipper/src/domains/`
- Modify:
  - 任意仍引用 `domains/` 的文件（用 `rg -n \"domains/\" Extensions/WebClipper` 定位）

**Step 1: 实现**
- 删除 `src/domains/` 目录
- 全仓搜索 `domains/`，确保无残余 import/path 字符串

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 0 error

### Task 11: 运行测试与构建回归（统一验收）

**Step 1: 测试**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: PASS

**Step 2: 构建**
- Run: `npm --prefix Extensions/WebClipper run build`
- Run: `npm --prefix Extensions/WebClipper run build:firefox`
- Expected: 构建成功

**Step 3:（可选）产物检查**
- Run: `npm --prefix Extensions/WebClipper run check`
- Expected: dist 产物校验通过

---

## P2（可选）：进一步“按业务收敛” `export/` 与 `integrations/`

> 仅在 P1 完成且稳定后再做，避免一次性把路径全改爆。

### Task 12: Notion 相关代码收敛到 `src/notion/`

**Goal:**
- 将 `src/export/notion/*` 与 `src/integrations/notion/*` 合并到 `src/notion/*`（内部按 `oauth/ token-store/ sync/ api/` 分层）

**Verification:**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Run: `npm --prefix Extensions/WebClipper run test`

### Task 13: Obsidian 相关代码收敛到 `src/obsidian/`

**Goal:**
- 将 `src/export/obsidian/*` 与 `src/integrations/obsidian/*` 合并到 `src/obsidian/*`

**Verification:**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Run: `npm --prefix Extensions/WebClipper run test`

### Task 14: Web Article 收敛到 `src/web-article/`

**Goal:**
- 将 `src/integrations/web-article/*` 收敛到 `src/web-article/*`，并让 content-controller 的 `ARTICLE_MESSAGE_TYPES` 调用链保持不变

**Verification:**
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/content-controller-web-inpage-article-fetch.test.ts`

---

## 不确定项（执行前确认）

- 目录命名是否接受：`src/conversations/`、`src/backup/`、`src/settings/`、`src/sync/`（如果你更想要 `src/chat/`、`src/notion/` 这种更业务化命名，需要在 Task 1 前一次性定案）
- 是否要同步重命名测试目录（例如 `tests/domains/*` -> `tests/backup/*`），还是保持测试文件路径不动仅改 import（推荐先不动测试目录，降低 churn）

