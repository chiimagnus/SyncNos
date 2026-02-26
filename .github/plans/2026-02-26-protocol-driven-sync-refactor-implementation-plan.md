# 协议驱动同步重构（Notion 分库 + Obsidian 分 Folder）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:**
- 以“Conversation Kind 协议 + Registry”的方式重构同步与导出路由：把 Web Article 与 AI Chats 的差异点集中到一个可注册/可验证的协议层。
- Notion：`sourceType=article` 同步到独立 Database（默认 `SyncNos-Web Articles`）；`sourceType=chat` 维持现状（`SyncNos-AI Chats`）。
- Obsidian：按 kind 分 folder（chat: `SyncNos-AIChats/`，article: `SyncNos-WebArticles/`）。

**Non-goals（非目标）:**
- 不做 Notion 侧历史页面迁移（旧版本已同步到 AI Chats DB 的文章页面会保留；新版本在文章库里新建/更新自己的映射）。
- 不改变文章抓取（Readability/fallback/HTML->Markdown）与聊天抓取（collectors）逻辑本身。
- 不引入 Obsidian URI “版本策略”、不引入队列/复杂设置 UI；folder 命名按默认即可。

**Approach（方案）:**
- 引入“Conversation Kind”协议（类似 `collector-contract.js`）：定义 `chat`/`article` 两种 kind，并集中管理差异点：
  - Notion：database 的 title/storage key/schema + page properties 组装策略 +（必要时）同步策略
  - Obsidian：export folder
- 所有“按类型分流”的逻辑改为：`kind = kindRegistry.pick(conversation)`，下游依赖 `kind` 的配置，不再散落 `if (sourceType === "article") ...`。
- Notion 同步重构为“kind 驱动”：
  - DB manager 变成通用 `ensureDatabase({ accessToken, parentPageId, dbSpec })`，并按 `dbSpec.storageKey` 分别缓存 dbId
  - orchestrator 对每个 conversation 按 kind 获取 dbId 并同步，同一次 sync 内对同 kind 复用 dbId
- MV3 load order 明确化（避免 runtime/global 不一致）：
  - background SW：`src/bootstrap/background.js` 的 `importScripts(...)` 必须在 `notion-sync-orchestrator.js` 之前加载 kind registry
  - popup：`src/ui/popup/popup.html` 必须在 `popup-core.js`/`popup-obsidian.js` 之前加载 kind registry

**Acceptance（验收）:**
- Notion：
  - 同步 chat -> `SyncNos-AI Chats` DB（storage key: `notion_db_id_syncnos_ai_chats`）
  - 同步 article -> `SyncNos-Web Articles` DB（storage key: `notion_db_id_syncnos_web_articles`）
  - 混合同步（同时选 chat + article）能各自进入对应 DB
  - 旧版本文章若已同步到 chat DB，新版本会在 article DB 新建页面并更新本地映射（旧页面保留）
  - article 重新 fetch 后（同一 conversationKey，但 messageKey 仍为 `article_body`），再次 sync 必须触发 rebuild/覆盖 Notion 页面内容（不能停在 `no_changes`）
  - `notionDisconnect` 会清理两套 DB 缓存 key + 现有 parent page/oauth/job key
- Obsidian：
  - chat 默认写入文件夹 `SyncNos-AIChats/`
  - article 默认写入文件夹 `SyncNos-WebArticles/`（命名可调整，但需固定且可测）
  - 混合选择时每条分别落到自己的 folder
- 验证命令：
  - Run: `npm --prefix Extensions/WebClipper run check`
  - Run: `npm --prefix Extensions/WebClipper run test`
  - Expected: 全部通过

> 说明：本计划中所有 vitest 指令的测试路径均相对 `Extensions/WebClipper/`（因为使用了 `npm --prefix Extensions/WebClipper ...`）。

---

## P1（最高优先级）：协议层落地 + Notion 分库

### Task 1: 引入 Conversation Kind 协议与 Registry（含运行时加载顺序）

**Files:**
- Create: `Extensions/WebClipper/src/shared/conversation-kind-contract.js`
- Create: `Extensions/WebClipper/src/shared/conversation-kinds.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`
- Create: `Extensions/WebClipper/tests/smoke/conversation-kinds.test.ts`

**Step 1: 实现功能**
- `conversation-kind-contract.js` 定义并校验 kind 协议（运行时断言）：
  - 必须字段：`id`（string）、`matches(conversation)`（function）
  - 必须字段：`notion.dbSpec`（object）、`notion.pageSpec`（object）、`obsidian.folder`（string）
  - `notion.pageSpec` 建议最少包含：
    - `buildCreateProperties(conversation)`（function）
    - `buildUpdateProperties(conversation)`（function）
    - `shouldRebuild({ conversation, messages, mapping })`（可选 function，用于 article 等需要强制 rebuild 的场景）
- `conversation-kinds.js` 提供 registry：
  - `register(kindDef)` / `pick(conversation)` / `list()`
  - 内建两个 kind：`chat`、`article`
  - `pick()` 的默认：匹配不到返回 `chat`
- 先把规则做得硬且可测：
  - `article`：`conversation.sourceType === "article"`
  - `chat`：兜底
- kind 内建默认配置（命名按默认即可）：
  - chat Notion：title `SyncNos-AI Chats`，storageKey `notion_db_id_syncnos_ai_chats`
  - article Notion：title `SyncNos-Web Articles`，storageKey `notion_db_id_syncnos_web_articles`
  - chat Obsidian folder：`SyncNos-AIChats`
  - article Obsidian folder：`SyncNos-WebArticles`

**Step 2: wire 运行时加载顺序**
- background：在 `src/bootstrap/background.js` 的 `importScripts(...)` 中把
  - `../shared/conversation-kind-contract.js`
  - `../shared/conversation-kinds.js`
  放在 `notion-sync-orchestrator.js` 之前
- popup：在 `src/ui/popup/popup.html` 增加
  - `<script src="../../shared/conversation-kind-contract.js"></script>`
  - `<script src="../../shared/conversation-kinds.js"></script>`
  并放在 `popup-core.js`/`popup-obsidian.js` 之前

**Step 3: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/conversation-kinds.test.ts`
- Expected: PASS

---

### Task 2: 重构 Notion DB Manager 为“dbSpec 驱动”

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-db-manager.js`
- Modify: `Extensions/WebClipper/tests/smoke/notion-db-manager.test.ts`

**Step 1: 实现功能**
- 将硬编码的 `DB_TITLE/DB_STORAGE_KEY/AI schema` 改为参数化的 `dbSpec`：
  - `ensureDatabase({ accessToken, parentPageId, dbSpec })`
  - `dbSpec` 包含：`title`、`storageKey`、`properties`（创建 schema）与 `ensureSchemaPatch`（复用时补字段的最小 PATCH）
- 缓存读写按 `dbSpec.storageKey`（多 DB 必须独立缓存）：
  - `getCachedDatabaseId(storageKey)` / `setCachedDatabaseId(storageKey, dbId)` / `clearCachedDatabaseId(storageKey)`
- chat 的 dbSpec 保持现有行为（AI multi_select 必须存在；缺失时 best-effort PATCH 补齐）
- article 的 dbSpec（避免 Notion API 因未知 property 报错）：
  - `title`: `SyncNos-Web Articles`
  - `storageKey`: `notion_db_id_syncnos_web_articles`
  - `properties` 类型建议固定为：
    - `Name` title, `Date` date, `URL` url
    - `Author` rich_text, `Published` rich_text, `Description` rich_text

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/notion-db-manager.test.ts`
- Expected: PASS（补充/调整测试以覆盖 article dbSpec）

---

### Task 3: Notion Sync Service 支持 kind/pageSpec 驱动的页面属性（chat 有 AI，article 无 AI）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- Modify: `Extensions/WebClipper/tests/smoke/notion-sync-service.test.ts`

**Step 1: 实现功能**
- `createPageInDatabase` / `updatePageProperties` 支持由调用方传入完整 `properties`（或接收 `pageSpec + conversation` 并内部构造）：
  - chat：`Name/URL/Date/AI`
  - article：`Name/URL/Date/Author/Published/Description`（不写 `AI`，避免 schema 不存在时报错）
- `Date`（create 时）建议使用 `conversation.lastCapturedAt`（若存在）否则回退 `Date.now()`，保证文章/聊天都能追溯采集时间

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/notion-sync-service.test.ts`
- Expected: PASS

---

### Task 4: Notion Sync Orchestrator 按 kind 路由 dbId + kind 驱动同步策略（破坏性重构）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.js`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Create: `Extensions/WebClipper/tests/smoke/notion-sync-orchestrator-kind-routing.test.ts`

**Step 1: 实现功能**
- 在 orchestrator 内部引入 kind registry：
  - 对每个 conversation：`kind = pick(convo)` -> `dbSpec = kind.notion.dbSpec` / `pageSpec = kind.notion.pageSpec`
  - 同一次 sync 内缓存 `dbIdByKindId`（避免重复 search/create）
- pageUsable 检查基于该 conversation 对应的 `dbId`：
  - 如果旧 mapping 指向另一 DB 的 page，则判定不可用，走“新建页面 + 更新 mapping”
- 页面属性写入完全由 kind/pageSpec 决定：
  - create/update 走 `pageSpec.buildCreateProperties()` / `pageSpec.buildUpdateProperties()`（article 不写 `AI`）
- missing-database recover：清理对应 `dbSpec.storageKey`（而不是只清 chat 那个 key）
- 修复 article 更新不触发同步的问题（不在 orchestrator 硬编码 `if(kind.id===...)`，而是协议驱动）：
  - `pageSpec.shouldRebuild({ conversation, messages, mapping }) === true` 时，必须触发 rebuild（clear + append 全量），即便 cursor 的 messageKey 匹配
  - article 的默认策略：当任一 message 的 `updatedAt > mapping.lastSyncedAt` 时返回 true
  - chat 的默认策略：保持现有 cursor 追加逻辑（仅 cursor 缺失时 rebuild）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/notion-sync-orchestrator-kind-routing.test.ts`
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-notion-sync.test.ts`
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
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-notion-sync.test.ts`
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/backup-utils.test.ts`
- Expected: PASS

---

## P2（高优先级）：Obsidian 文章/聊天分流

### Task 6: Obsidian 导出改为 kind 驱动 folder（需要同时改 popup.js 调用点）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup-obsidian.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify: `Extensions/WebClipper/tests/smoke/popup-obsidian.test.ts`

**Step 1: 实现功能**
- `popup-obsidian.createObsidianPayloads()` 返回 payload 增加 `folder`（从 kind registry 取 `obsidian.folder`；fallback `SyncNos-AIChats`）
- `popup-obsidian.buildObsidianNewUrl()` 支持可选 `folder` 参数（默认 `SyncNos-AIChats`）
- `popup.js` 在生成 URL 时透传 `payload.folder`，保证混合选择时每条进自己的 folder
- 更新测试：文章会输出 `file=SyncNos-WebArticles/...`，聊天保持 `SyncNos-AIChats/...`

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-obsidian.test.ts`
- Expected: PASS

---

## P3（必须）：协议化收口与清理

### Task 7: 清理散落的 sourceType 判断（把分流逻辑全部收口到 kind）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup-core.js`
- Modify（按实际扫到）：`Extensions/WebClipper/src/export/article-markdown.js`、`Extensions/WebClipper/src/ui/popup/popup-export.js` 等

**Step 1: 实现功能**
- 所有“文章/聊天差异”必须先 `kindRegistry.pick(conversation)` 再决定策略，避免继续扩散 `if (sourceType === "article") ...`。
- 将“允许直接使用 sourceType 的位置”限制为：
  - `src/shared/conversation-kinds.js`（matches）
  - `src/bootstrap/article-fetch-service.js`（写入 sourceType）
  - `src/storage/*`（数据模型与合并）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Run: `rg -n "sourceType\\s*===\\s*\\\"article\\\"" Extensions/WebClipper/src -S`（人工确认只剩协议层/抓取层）
- Expected: PASS
