# 协议驱动同步重构（Notion 分库 + Obsidian “版本”）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:**
- 以“协议驱动开发”的方式重构同步与导出路由：把 Web Article 与 AI Chats 的分流规则集中到一个可注册/可验证的协议层。
- Notion：`sourceType=article` 同步到独立 Database；`sourceType=chat` 维持现状。
- Obsidian：为文章与聊天做分流（至少分文件夹），并补齐你说的“Obsidian 版本”差异（以协议/配置形式支持不同 URI 生成策略）。

**Non-goals（非目标）:**
- 不做 Notion 侧历史页面迁移（旧版本已同步到 AI Chats DB 的文章页面会保留；新版本在文章库里新建/更新自己的映射）。
- 不改变文章抓取（Readability/fallback/HTML->Markdown）与聊天抓取（collectors）逻辑本身。
- 不在本阶段引入复杂 UI（只允许必要的最小设置项，比如 Obsidian URI mode 或 folder）。

**Approach（方案）:**
- 引入“Conversation Kind”协议（类似 `collector-contract.js`）：定义 `chat`/`article` 两种 kind，并集中管理：
  - Notion database 的 title/storage key/schema
  - Obsidian export 的 folder/URI strategy
- 所有“按类型分流”的逻辑改为：`kind = kindRegistry.pick(conversation)`，下游只依赖 `kind` 的配置，不再散落 `if (sourceType === "article") ...`。
- Notion 同步重构为“kind 驱动”：DB manager 变成通用 `ensureDatabase(dbSpec)`；orchestrator 在每个 conversation 上按 kind 获取 dbId 并同步。
- Obsidian 导出重构为“kind + uriStrategy 驱动”：同一份 doc 输出到不同 folder，URI 生成通过 strategy 协议适配（你提到的“版本”）。

**Acceptance（验收）:**
- Notion：
  - 同步 chat -> `SyncNos-AI Chats` DB
  - 同步 article -> `SyncNos-Web Articles` DB（标题可调整，但需固定且可测）
  - 混合同步（同时选 chat + article）能各自进入对应 DB
  - `notionDisconnect` 会清理两套 DB 缓存 key
- Obsidian：
  - chat 默认写入文件夹 `SyncNos-AIChats/`
  - article 默认写入文件夹 `SyncNos-WebArticles/`（命名可调整，但需固定且可测）
  - 若启用另一种 Obsidian URI “版本/策略”，仍能生成可用 url（至少测试覆盖 URL shape/参数编码）
- 验证命令：
  - Run: `npm --prefix Extensions/WebClipper run check`
  - Run: `npm --prefix Extensions/WebClipper run test`
  - Expected: 全部通过

---

## 不确定项（需要你确认，避免我猜）
- Obsidian “版本”具体指什么？
  - A: 文章/聊天分不同 folder（功能版本）
  - B: 不同 URI 规范（例如 core Obsidian URI vs Advanced URI 插件参数差异）
  - C: 不同 vault/路径组织（按 sourceType、按日期、按来源）
- Notion 文章库的标题是否固定为 `SyncNos-Web Articles`？（如果你有更喜欢的命名，告诉我一次性定死）

---

## P1（最高优先级）：协议层落地 + Notion 分库

### Task 1: 引入 Conversation Kind 协议与 Registry

**Files:**
- Create: `Extensions/WebClipper/src/shared/conversation-kind-contract.js`
- Create: `Extensions/WebClipper/src/shared/conversation-kinds.js`
- Create: `Extensions/WebClipper/tests/smoke/conversation-kinds.test.ts`

**Step 1: 实现功能**
- `conversation-kind-contract.js` 定义并校验 kind 协议（运行时断言）：
  - 必须字段：`id`（string）、`matches(conversation)`（function）、`notionDbSpec`（object）、`obsidianSpec`（object）
- `conversation-kinds.js` 提供 registry：
  - `register(kindDef)` / `pick(conversation)` / `list()`
  - 内建两个 kind：`chat`、`article`
  - `pick()` 的默认：匹配不到返回 `chat`
- 先把规则做得硬且可测：
  - `article`：`conversation.sourceType === "article"`
  - `chat`：兜底

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- --run Extensions/WebClipper/tests/smoke/conversation-kinds.test.ts`
- Expected: PASS

---

### Task 2: 重构 Notion DB Manager 为“dbSpec 驱动”

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-db-manager.js`
- Modify: `Extensions/WebClipper/tests/smoke/notion-db-manager.test.ts`

**Step 1: 实现功能**
- 将硬编码的 `DB_TITLE/DB_STORAGE_KEY/AI schema` 改为参数化的 `dbSpec`：
  - `ensureDatabase({ accessToken, parentPageId, dbSpec })`
  - `dbSpec` 包含：`title`、`storageKey`、`properties`（创建时）与 `ensureSchemaPatch`（复用时补字段的最小 PATCH）
- chat 的 dbSpec 保持现有行为（AI multi_select 必须存在）
- article 的 dbSpec 新增：
  - `title`: `SyncNos-Web Articles`
  - `storageKey`: `notion_db_id_syncnos_web_articles`
  - `properties`: `Name/Date/URL/Author/Published/Description`

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- --run Extensions/WebClipper/tests/smoke/notion-db-manager.test.ts`
- Expected: PASS（补充/调整测试以覆盖 article dbSpec）

---

### Task 3: Notion Sync Orchestrator 按 kind 路由 dbId（破坏性重构）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.js`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Create: `Extensions/WebClipper/tests/smoke/notion-sync-orchestrator-kind-routing.test.ts`

**Step 1: 实现功能**
- 在 orchestrator 内部引入 kind registry：
  - 对每个 conversation：`kind = pick(convo)` -> `dbSpec = kind.notionDbSpec`
  - 同一次 sync 内缓存 `dbIdByKindId`（避免重复 search/create）
- pageUsable 检查基于 conversation 对应的 `dbId`：
  - 如果旧 mapping 指向另一 DB 的 page，则判定不可用，走“新建页面 + 更新 mapping”
- missing-database recover：清理对应 `dbSpec.storageKey`（而不是只清 chat 那个 key）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- --run Extensions/WebClipper/tests/smoke/notion-sync-orchestrator-kind-routing.test.ts`
- Run: `npm --prefix Extensions/WebClipper run test -- --run Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Expected: PASS

---

### Task 4: Notion Sync Service 支持文章属性写入（由 kind/dbSpec 驱动）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- (可选) Create: `Extensions/WebClipper/tests/smoke/notion-sync-service-article-props.test.ts`

**Step 1: 实现功能**
- `createPageInDatabase` / `updatePageProperties` 支持可选字段：
  - `author/publishedAt/description`
- orchestrator 在调用 create/update 时，若 kind=article，将 conversation 上的字段透传进去。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: PASS

---

### Task 5: 断连清理与备份 allowlist 支持多 dbSpec.storageKey

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Modify: `Extensions/WebClipper/src/storage/backup-utils.js`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Modify: `Extensions/WebClipper/tests/smoke/backup-utils.test.ts`

**Step 1: 实现功能**
- `notionDisconnect` 清理：
  - `notion_db_id_syncnos_ai_chats`
  - `notion_db_id_syncnos_web_articles`
- `STORAGE_ALLOWLIST` 增加 `notion_db_id_syncnos_web_articles`

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- --run Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Run: `npm --prefix Extensions/WebClipper run test -- --run Extensions/WebClipper/tests/smoke/backup-utils.test.ts`
- Expected: PASS

---

## P2（高优先级）：Obsidian “版本”与文章/聊天分流

### Task 6: Obsidian 导出改为 kind 驱动 folder + URI strategy 协议

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup-obsidian.js`
- Modify: `Extensions/WebClipper/tests/smoke/popup-obsidian.test.ts`
- (可选) Create: `Extensions/WebClipper/src/sync/obsidian/obsidian-uri-strategies.js`

**Step 1: 实现功能**
- 将 `DEFAULT_OBSIDIAN_FOLDER` 改为由 kind 决定：
  - chat: `SyncNos-AIChats`
  - article: `SyncNos-WebArticles`
- 引入 URI strategy 协议（先实现一个默认策略，保留现有行为），并留出第二策略的扩展点（对应你说的“Obsidian 版本”）：
  - `buildNewUrl({ filePath, markdown, useClipboard }) -> string`
- 更新测试：文章会输出 `file=SyncNos-WebArticles/...`。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- --run Extensions/WebClipper/tests/smoke/popup-obsidian.test.ts`
- Expected: PASS

---

## P3（可选）：协议化收口与清理

### Task 7: 清理散落的 sourceType 判断（把分流逻辑全部收口到 kind）

**Files:**
- Modify（按实际扫到的点）：`Extensions/WebClipper/src/ui/popup/popup-core.js`、`Extensions/WebClipper/src/export/article-markdown.js` 等

**Step 1: 实现功能**
- 所有“文章/聊天差异”走 `kindRegistry.pick(conversation)`，避免继续新增分支判断。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: PASS

