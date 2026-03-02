# WebClipper 完全迁移到 WXT 新架构（去 Legacy）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收；每个 Task 完成后做原子化 git 提交。

**Goal（目标）:** WebClipper 完全运行在 WXT 脚手架 + TS/React 架构下，移除 `Extensions/WebClipper/src/legacy/*` 与“靠 IIFE 写 `globalThis.WebClipper` 的启动/桥接层”，Background/Content/Popup/App 都走统一的模块化入口与消息协议，便于后续扩展新标签页/网页应用（`chrome-extension://...`）。

**Non-goals（非目标）:**
- 不在本计划中改变现有产品能力与交互（仅做等价迁移与结构重排）。
- 不在本计划中做权限/host_permissions 收敛（迁移稳定后再做）。
- 不重写 Notion/Obsidian 同步算法（以“保持行为一致”为优先）。

**Approach（方案）:**
1) 先把“全局单例/side-effects 启动”替换为“显式模块 + 依赖注入/参数传递”；2) 以业务域为单位渐进迁移（Storage → Events → Settings/Auth → Sync → Content/Inpage → Collectors）；3) 每个域迁移后立刻删掉对应 legacy 静态 import，并用 `vitest/tsc/wxt build` 冒烟回归。

**Constraints & Conventions（约束与约定）:**
- 路径约定：除非特别说明，本文所有路径均以仓库根目录为基准；与扩展相关的路径一律写全 `Extensions/WebClipper/...`，避免“扩展根目录相对路径”歧义。
- MV3 约束：Background Service Worker 禁止使用动态 `import()`；所有迁移过程都应保持“静态 import 可被 bundler 打包”的模式。
- 数据安全：涉及 IndexedDB Schema/Version 的改动，必须做到 **DB_NAME/DB_VERSION/Store/Index 名称完全兼容**，且在 CI/本地测试通过后再推进删除 legacy。
- 原子提交：每个 Task 完成后提交一次（commit message 统一使用 `type: taskN - ...`），不要混入下一 Task 的变更。

**Acceptance（验收）:**
- `Extensions/WebClipper/` 下不再存在 `Extensions/WebClipper/src/legacy/*`，且 `Extensions/WebClipper/entrypoints/background.ts`/`Extensions/WebClipper/entrypoints/content.ts` 不再引用它。
- 不再依赖 `globalThis.WebClipper.*` 作为运行时 API（允许一个临时的 `Extensions/WebClipper/src/platform/compat/*` 作为过渡，但最终也要清零）。
- 通过：`npm --prefix Extensions/WebClipper run compile`、`npm --prefix Extensions/WebClipper run test`、`npm --prefix Extensions/WebClipper run build`。
- 手动冒烟：Chrome 加载 `Extensions/WebClipper/.output/chrome-mv3/` 后，采集入库/列表展示/导出/备份导入/Obsidian Test+Sync/Notion OAuth Connect+Sync 均可用。

---

## P0（基准文档先行）：迁移前的文档对齐

### Task 1: 固化“当前文档基准”与入口索引

**Files:**
- Modify: `Extensions/WebClipper/AGENTS.md`
- (Optional) Modify: `Extensions/WebClipper/src/legacy/README.md`

**Step 1: 实现**
- 确认文档中提到的入口均为 WXT：
  - Background: `Extensions/WebClipper/entrypoints/background.ts`
  - Content: `Extensions/WebClipper/entrypoints/content.ts`
  - Popup: `Extensions/WebClipper/entrypoints/popup/*`
  - App: `Extensions/WebClipper/entrypoints/app/*`
- 记录“legacy 仍残留的域”清单（Storage/Events/Sync/Collectors/Inpage）。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run check`
Expected: `[check] ok`

**Step 3: 原子提交**
Run: `git commit -m "docs: task1 - baseline docs for full WXT migration"`

---

## P1（最高优先级）：存储层去全局（IDB schema / storage adapters）

> 目标：所有业务域统一使用 TS 版 `openDb()`，不再依赖 `Extensions/WebClipper/src/storage/schema.js` 通过 IIFE 注入 `WebClipper.storageSchema`。

### Task 2: 新增 TS 版 IndexedDB Schema 模块（仅提供 openDb + 常量）

**Files:**
- Create: `Extensions/WebClipper/src/platform/idb/schema.ts`
- Modify: `Extensions/WebClipper/src/domains/backup/idb.ts`

**Step 1: 实现**
- 在 `Extensions/WebClipper/src/platform/idb/schema.ts` 提供：
  - `DB_NAME` / `DB_VERSION`
  - `openDb(): Promise<IDBDatabase>`
  - （先不迁移复杂迁移逻辑，但必须包含“创建必要 stores/indices 的最小 onupgradeneeded”，否则会在真实使用/测试中直接缺表）
- `DB_NAME`/`DB_VERSION` 必须先从 `Extensions/WebClipper/src/storage/schema.js` 对齐拷贝（迁移期禁止随意 bump version）。
- 将 `Extensions/WebClipper/src/domains/backup/idb.ts` 的 `getOpenDb()` 替换为直接 import 新 schema 的 `openDb`。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run compile`
Expected: PASS

**Step 3: 原子提交**
Run: `git commit -m "feat: task2 - add TS idb schema openDb"`

### Task 3: Conversations/Backup 全量切到 TS openDb（移除 storageSchema 依赖）

**Files:**
- Modify: `Extensions/WebClipper/src/domains/conversations/storage-idb.ts`
- Modify: `Extensions/WebClipper/src/domains/backup/idb.ts`

**Step 1: 实现**
- `Extensions/WebClipper/src/domains/conversations/storage-idb.ts` 使用 `Extensions/WebClipper/src/platform/idb/schema.ts` 的 `openDb()`，删掉 `globalThis.WebClipper.storageSchema` 读取。
- `Extensions/WebClipper/src/domains/backup/idb.ts` 同步保持一致（不再绑 schema this）。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: PASS（至少覆盖 `tests/storage/*` 与 `tests/domains/backup-*`）

**Step 3: 原子提交**
Run: `git commit -m "refactor: task3 - use TS openDb in domains"`

### Task 4: Port 迁移逻辑：把 `Extensions/WebClipper/src/storage/schema.js` 的 upgrade/migration 逐段迁到 TS

**Files:**
- Modify: `Extensions/WebClipper/src/platform/idb/schema.ts`
- Modify: `Extensions/WebClipper/tests/storage/schema-migration.test.ts`

**Step 1: 实现**
- 把 `Extensions/WebClipper/src/storage/schema.js` 中的 DB upgrade（包含 NotionAI thread 迁移等）迁到 `Extensions/WebClipper/src/platform/idb/schema.ts`：
  - 拆成若干纯函数（每段迁移可单测）
  - 保持 DB_VERSION/索引/Store 名不变（避免破坏用户已有数据）
- 更新 `schema-migration.test.ts` 以新模块为入口验证迁移行为。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: PASS

**Step 3: 原子提交**
Run: `git commit -m "refactor: task4 - port idb migrations to TS schema"`

### Task 5: 移除旧 schema 注入文件

**Files:**
- Delete: `Extensions/WebClipper/src/storage/schema.js`
- Modify: `Extensions/WebClipper/src/legacy/background-entry.ts`
- Modify: `Extensions/WebClipper/src/legacy/content-entry.ts`
- Modify: `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`（当前有 `import '../../../storage/schema.js'`）
- Modify: `Extensions/WebClipper/src/ui/app/routes/Backup.tsx`（当前有 `import '../../../storage/schema.js'`）

**Step 1: 实现**
- Background/App 里显式 import `Extensions/WebClipper/src/platform/idb/schema.ts`（或某个 `init` 模块）以确保 schema 可用。
- 删除 `Extensions/WebClipper/src/storage/schema.js`，并从 legacy entry 的静态 import 列表中移除它。
- 用 `rg "storage/schema\\.js" Extensions/WebClipper/src` 确认没有漏掉的 import（避免 App 某路由在运行时才炸）。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run build`
Expected: build 成功；打开 App/Popup 时备份导入/导出不报错。

**Step 3: 原子提交**
Run: `git commit -m "chore: task5 - remove legacy storage schema IIFE"`

---

## P2：事件系统去全局（Popup/App 实时刷新链路）

> 目标：替换 `Extensions/WebClipper/src/bootstrap/background-events-hub.js` 这类“挂在 WebClipper 上”的广播机制，让 TS background router 自己管理 Port 与事件分发。

### Task 6: 新增 TS EventsHub（Port 注册 + broadcast）

**Files:**
- Create: `Extensions/WebClipper/src/platform/events/hub.ts`
- Modify: `Extensions/WebClipper/src/platform/messaging/background-router.ts`

**Step 1: 实现**
- `hub.ts` 提供：
  - `registerPort(port)`（过滤 port name）
  - `broadcast(type, payload)`（遍历 ports，自动清理断开的 port）
- `Extensions/WebClipper/src/platform/messaging/background-router.ts` 不再读取 `WebClipper.backgroundEventsHub`，改为内部持有 hub 实例。
- 统一使用 `Extensions/WebClipper/src/platform/messaging/message-contracts.ts` 中的 `UI_PORT_NAMES.POPUP_EVENTS`/`UI_EVENT_TYPES.CONVERSATIONS_CHANGED`，不要再从 `NS.messageContracts` 读常量。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: `Extensions/WebClipper/tests/smoke/background-router-conversations-events.test.ts` 通过（必要时同步更新测试）。

**Step 3: 原子提交**
Run: `git commit -m "feat: task6 - add TS events hub and wire router"`

### Task 7: 迁移并删除 legacy background-events-hub

**Files:**
- Delete: `Extensions/WebClipper/src/bootstrap/background-events-hub.js`
- Modify: `Extensions/WebClipper/src/legacy/background-entry.ts`
- Modify: `Extensions/WebClipper/src/domains/conversations/background-handlers.ts`
- Modify: `Extensions/WebClipper/src/integrations/web-article/background-handlers.ts`

**Step 1: 实现**
- 删除旧 JS hub 文件及 legacy import。
- `background-handlers.ts` 里触发事件时，改为调用 TS hub（建议：由 `background-router.ts` 暴露 `getEventsHub()`/`router.events`，避免再引入全局单例）。
- 同步把所有 `NS.messageContracts?.UI_EVENT_TYPES?...` 的读取替换为 TS 常量（避免“删掉 message-contracts 全局后”出现隐性回归）。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run build`
Expected: Popup/App 里列表在“抓取/删除/同步消息”后能自动刷新（手动冒烟）。

**Step 3: 原子提交**
Run: `git commit -m "chore: task7 - remove legacy events hub"`

---

## P3：Settings/Auth 去全局（Notion token / Obsidian settings / inpage 开关）

### Task 8: Notion Auth Status 全切 TS token-store

**Files:**
- Modify: `Extensions/WebClipper/src/domains/settings/background-handlers.ts`
- (Optional) Modify: `Extensions/WebClipper/src/integrations/notion/token-store.ts`

**Step 1: 实现**
- `GET_AUTH_STATUS`/`DISCONNECT` 直接使用 `Extensions/WebClipper/src/integrations/notion/token-store.ts`（不要再读 `WebClipper.notionTokenStore`）。
- 注意：`Extensions/WebClipper/src/export/notion/notion-sync-orchestrator.js` 仍依赖 `NS.notionTokenStore`；因此本 Task **不删除** `Extensions/WebClipper/src/export/notion/token-store.js`，删除动作延后到“Notion export 栈去全局”阶段。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: `Extensions/WebClipper/tests/integrations/notion-oauth.test.ts` 通过；Popup/App 显示 connected/disconnected 正常。

**Step 3: 原子提交**
Run: `git commit -m "refactor: task8 - use TS notion token store in settings handlers"`

### Task 9: Obsidian Settings store TS 化（替换 WebClipper.obsidianSettingsStore）

**Files:**
- Create: `Extensions/WebClipper/src/integrations/obsidian/settings-store.ts`
- Modify: `Extensions/WebClipper/src/domains/settings/background-handlers.ts`
- (Deferred) Delete: `Extensions/WebClipper/src/export/obsidian/obsidian-settings-store.js`

**Step 1: 实现**
- 把 `Extensions/WebClipper/src/export/obsidian/obsidian-settings-store.js` 的存储逻辑迁到 TS（使用 `Extensions/WebClipper/src/platform/storage/local.ts`）。
- background handler 直接调用 TS store。
- 注意：`Extensions/WebClipper/src/export/obsidian/obsidian-sync-orchestrator.js` 仍依赖 `NS.obsidianSettingsStore`；因此本 Task 暂不删除 legacy store 文件，删除动作延后到“Obsidian export 栈去全局”阶段。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: `Extensions/WebClipper/tests/smoke/obsidian-*.test.ts` 相关测试通过；Popup Settings 中保存/读取正常。

**Step 3: 原子提交**
Run: `git commit -m "feat: task9 - migrate obsidian settings store to TS"`

---

## P4：Sync 去全局（Notion/Obsidian orchestrator 迁移到 integrations/domains）

> 目标：`Extensions/WebClipper/src/domains/sync/background-handlers.ts` 不再通过 `WebClipper.notionSyncOrchestrator/obsidianSyncOrchestrator` 调用。

### Task 10: Notion Sync Orchestrator TS wrapper（先 wrapper，后逐步内迁）

**Files:**
- Create: `Extensions/WebClipper/src/integrations/notion/sync/orchestrator.ts`
- Modify: `Extensions/WebClipper/src/domains/sync/background-handlers.ts`

**Step 1: 实现**
- 第一阶段允许 orchestrator.ts 仍调用旧 JS 实现，但通过“显式 import + 显式函数调用”完成（不要再靠全局 NS 单例）。
- background handler 改为调用 TS wrapper。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`、`Extensions/WebClipper/tests/smoke/notion-sync-*.test.ts` 通过。

**Step 3: 原子提交**
Run: `git commit -m "refactor: task10 - route notion sync via TS orchestrator wrapper"`

### Task 11: Obsidian Sync Orchestrator TS wrapper

**Files:**
- Create: `Extensions/WebClipper/src/integrations/obsidian/sync/orchestrator.ts`
- Modify: `Extensions/WebClipper/src/domains/sync/background-handlers.ts`

**Step 1: 实现**
- 同 Task 10：先 wrapper 迁移入口与依赖方式，再逐步内迁实现。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: `Extensions/WebClipper/tests/smoke/background-router-obsidian-sync.test.ts`、`Extensions/WebClipper/tests/smoke/obsidian-sync-orchestrator.test.ts` 通过。

**Step 3: 原子提交**
Run: `git commit -m "refactor: task11 - route obsidian sync via TS orchestrator wrapper"`

---

## P5：Content/Inpage 去 legacy（统一用 TS 消息协议与运行时 client）

### Task 12: TS 版 runtime client（替换 `Extensions/WebClipper/src/shared/runtime-client.js`）

**Files:**
- Create: `Extensions/WebClipper/src/platform/runtime/client.ts`
- Modify: `Extensions/WebClipper/entrypoints/content.ts`
- Modify: `Extensions/WebClipper/src/bootstrap/content-controller.js`（或迁到 TS）

**Step 1: 实现**
- 在 TS client 中封装 `sendMessage/connectPort`（兼容 chrome/browser）。
- Content 侧逐段切换到 TS client（优先切“采集入库”关键链路）。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run build`
Expected: 支持站点页面中 inpage 按钮可用；点击后入库并在 Popup/App 可见。

**Step 3: 原子提交**
Run: `git commit -m "feat: task12 - add TS runtime client for content"`

### Task 12b: Content bootstrap 去 IIFE/去全局（content.js / content-controller.js / inpage）

> 目标：让 Content 侧启动逻辑不再依赖 `globalThis.WebClipper` 注入与 `NS.messageContracts`；为 `Task 13` 删除 legacy content entry 做准备。

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/content.js`（迁移到 TS 或改为纯模块导出）
- Modify: `Extensions/WebClipper/src/bootstrap/content-controller.js`（迁移到 TS 或改为纯模块导出）
- (Optional) Modify: `Extensions/WebClipper/src/ui/inpage/*`（逐步去掉对全局 NS 的写入/读取）
- (Optional) Update tests: `Extensions/WebClipper/tests/smoke/content-controller-*.test.ts`

**Step 1: 实现**
- 让 `Extensions/WebClipper/entrypoints/content.ts` 显式 import 并初始化 content controller（而不是靠 IIFE 自执行副作用）。
- 仅保留“必要的跨模块共享”在显式模块 export 上；避免继续往 `globalThis.WebClipper` 塞字段。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: content-controller / inpage 相关 smoke tests 不回归。

**Step 3: 原子提交**
Run: `git commit -m "refactor: task12b - deglobalize content bootstrap"`

### Task 13: 移除 `Extensions/WebClipper/src/legacy/content-entry.ts` 并改为显式 import

**Files:**
- Delete: `Extensions/WebClipper/src/legacy/content-entry.ts`
- Modify: `Extensions/WebClipper/entrypoints/content.ts`

**Step 1: 实现**
- 前置条件（否则无法真正删除 legacy entry）：
  - 已完成 `Task 16`/`Task 17+`（Collectors 栈不再依赖 IIFE 全局注册）
  - 已完成 `Task 12b`（Content bootstrap 去 IIFE/去全局）
- 把 content 侧需要的模块逐个搬到 `Extensions/WebClipper/entrypoints/content.ts` 的显式 import 列表（或引入 TS init 模块），直到不再需要 `startLegacyContent()`。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run build`
Expected: content-scripts 注入正常；不再生成 legacy 入口相关 chunk。

**Step 3: 原子提交**
Run: `git commit -m "chore: task13 - remove legacy content entry"`

---

## P6：Background 去 legacy（移除 startLegacyBackground + legacy fallback router）

> 注意：`Task 15`（移除 legacy message router）通常可以 **先于** `Task 14` 执行，以便尽早减少 fallback 行为；`Task 14` 的删除动作依赖更大范围的 export/collector/protocols 去全局。

### Task 14: Background init 全 TS 化（替换 `startLegacyBackground()`）

**Files:**
- Delete: `Extensions/WebClipper/src/legacy/background-entry.ts`
- Modify: `Extensions/WebClipper/entrypoints/background.ts`

**Step 1: 实现**
- 前置条件（否则删除 legacy entry 会连带删掉大量仍被依赖的 legacy import）：
  - Notion/Obsidian export 栈已完成“去全局依赖”（不再要求 `NS.notionTokenStore/backgroundStorage/conversationKinds/...`）
  - Content/Collectors/Protocols 的全局注入点已清零（否则 background 仍需要静态 import legacy 来保证运行时符号存在）
- 把 background 所需“纯 side-effects 初始化”迁到 TS init（schema/events/inpage visibility/notion oauth listener 等）。
- `Extensions/WebClipper/entrypoints/background.ts` 不再 import legacy background entry。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run build`
Expected: 插件加载无报错；`__WXT_PING__` 正常；Notion OAuth listener 正常工作。

**Step 3: 原子提交**
Run: `git commit -m "chore: task14 - remove legacy background entry"`

### Task 15: 去掉 background message fallback（彻底移除 `Extensions/WebClipper/src/bootstrap/background-router.js`）

**Files:**
- Delete: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Modify: `Extensions/WebClipper/entrypoints/background.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-*.test.ts`（迁移到新 TS router 测试）

**Step 1: 实现**
- 把 `openExtensionPopup`、article fetch 等剩余 handler 全迁到 TS router（`Extensions/WebClipper/src/platform/messaging/background-router.ts` + 各 domain handlers）。
- 删除旧 JS background-router 与所有 require 依赖。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: background router 相关 smoke tests 全通过（改成 TS 测试入口）。

**Step 3: 原子提交**
Run: `git commit -m "refactor: task15 - remove legacy background router"`

---

## P7：Collectors/Export/Protocols 模块逐域 TS 化（最后清零 globalThis.WebClipper）

> 这一段工作量最大，建议按站点/模块逐个迁移；每迁移一个文件就删掉一次 `globalThis.WebClipper = ...` IIFE 注入点，并保证对应测试仍通过。

### Task 16: Collector registry/utils TS 化（先迁共用，再迁各站点）

**Files:**
- Create: `Extensions/WebClipper/src/collectors/collector-contract.ts`
- Create: `Extensions/WebClipper/src/collectors/registry.ts`
- Create: `Extensions/WebClipper/src/collectors/collector-utils.ts`
- Update tests: `Extensions/WebClipper/tests/collectors/*.test.ts`

**Step 1: 实现**
- 保持对外接口不变（matches/capture 等），但改为模块导出而非全局注册。
- 更新测试从 `require(js)` 迁到 `import(ts)`。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: collectors 相关测试通过。

**Step 3: 原子提交**
Run: `git commit -m "refactor: task16 - migrate collectors core to TS"`

### Task 17+: 按站点逐个迁移 collector（ChatGPT/Claude/Gemini/…）

**Files:**
- Modify: `Extensions/WebClipper/src/collectors/<site>/*`
- Update tests: `Extensions/WebClipper/tests/collectors/<site>-collector.test.ts`

**Step 1: 实现**
- 每次只迁一个站点目录到 TS，并保持产出数据结构一致。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent -- <filter>`
Expected: 该站点 collector 测试通过 + 全量回归通过。

**Step 3: 原子提交**
Run: `git commit -m "refactor: task17 - migrate <site> collector to TS"`

### Task 18: Protocols 去全局（message-contracts / conversation-kinds / kinds-contract）

> 目的：把 `Extensions/WebClipper/src/protocols/*.js` 从“IIFE 注入全局”改为“TS/模块导出”，并让 legacy/export/collectors 逐步改为显式 import（最终才能删掉 `globalThis.WebClipper` 依赖）。

**Files:**
- Create: `Extensions/WebClipper/src/protocols/message-contracts.ts`
- Create: `Extensions/WebClipper/src/protocols/conversation-kind-contract.ts`
- Create: `Extensions/WebClipper/src/protocols/conversation-kinds.ts`
- Modify: `Extensions/WebClipper/src/export/notion/*`（逐个移除对 `NS.messageContracts`/`NS.conversationKinds` 的依赖）
- Modify: `Extensions/WebClipper/src/export/obsidian/*`（同上）
- Delete (after cutover): `Extensions/WebClipper/src/protocols/message-contracts.js`
- Delete (after cutover): `Extensions/WebClipper/src/protocols/conversation-kind-contract.js`
- Delete (after cutover): `Extensions/WebClipper/src/protocols/conversation-kinds.js`

**Step 1: 实现**
- 优先保证 TS 常量/类型与现有 JS 版本完全一致（不要改 message type 字符串）。
- 建议：`Extensions/WebClipper/src/protocols/message-contracts.ts` 直接 re-export `Extensions/WebClipper/src/platform/messaging/message-contracts.ts`，避免维护两份常量源。
- 先让 TS 侧所有读取常量的地方只依赖 `Extensions/WebClipper/src/platform/messaging/message-contracts.ts`（不从 `NS.messageContracts` 取）。
- 再逐个把 export/collector/bootstraps 从“读全局协议对象”改为“import 协议模块”（一次迁一个文件，降低回归面）。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: 与协议常量相关的 smoke/collector tests 不回归。

**Step 3: 原子提交**
Run: `git commit -m "refactor: task18 - deglobalize protocols"`

### Task 19: Export 栈去全局（Notion/Obsidian/ArticleFetch/BackgroundStorage 依赖）

> 目的：把 Notion/Obsidian/ArticleFetch 等 export 模块从“依赖 `NS.backgroundStorage/NS.notionTokenStore/...`”改为“显式依赖注入/模块 import”，为 `Task 14`/`Task 13` 删除 legacy entry 做准备。

**Files:**
- Modify: `Extensions/WebClipper/src/export/notion/notion-sync-orchestrator.js`（或迁 TS）
- Modify: `Extensions/WebClipper/src/export/obsidian/obsidian-sync-orchestrator.js`（或迁 TS）
- Modify: `Extensions/WebClipper/src/collectors/web/article-fetch-service.js`（或迁 TS）
- Delete (after cutover): `Extensions/WebClipper/src/bootstrap/background-storage.js`
- Delete (after cutover): `Extensions/WebClipper/src/export/notion/token-store.js`
- Delete (after cutover): `Extensions/WebClipper/src/export/obsidian/obsidian-settings-store.js`

**Step 1: 实现**
- 先把依赖改为“函数参数/构造参数注入”（比如把 `backgroundStorage`/`tokenStore`/`settingsStore` 作为参数传入）。
- 迁移期允许保留“兼容层”从旧全局读取（例如 `deps ?? fromGlobal()`），但必须在本 Task 结束时删掉兼容层。

**Step 2: 验证**
Run: `npm --prefix Extensions/WebClipper run test --silent`
Expected: Notion/Obsidian/ArticleFetch 相关 smoke tests 不回归；手动冒烟可同步。

**Step 3: 原子提交**
Run: `git commit -m "refactor: task19 - deglobalize export stack"`

---

## 回归策略（每完成一个 P 分组）

- Run: `npm --prefix Extensions/WebClipper run compile`
- Run: `npm --prefix Extensions/WebClipper run test --silent`
- Run: `npm --prefix Extensions/WebClipper run build`
- 手动冒烟（Chrome）：加载 `Extensions/WebClipper/.output/chrome-mv3/`，验证 1) popup/app 能打开 2) inpage 入库 3) conversations 列表刷新 4) 备份导入/导出 5) Obsidian Test/Sync 6) Notion Connect/Sync。

---

## 不确定项（执行前需要确认/约束）

1) 是否要求迁移完成后完全不保留任何 `.js`（包括纯工具类与 markdown 文档旁的 demo）？本计划默认“核心运行时代码全 TS 化”，但允许少量静态资源保持 JS。
2) Firefox 发布策略：最终是否仍需维持 `legacy:build:firefox`（当前脚本名保留但实现已基于 WXT 输出）？
3) Notion Sync/Obsidian Sync 是否允许在迁移期更改模块路径（影响外部文档引用）？计划默认会同步更新 `Extensions/WebClipper/AGENTS.md`。
4) `Extensions/WebClipper/src/bootstrap/*`（content/background 侧 IIFE 启动器）最终是否要求全部迁 TS 并删除？本计划按“最终全部删除”来写（否则无法达成 `globalThis.WebClipper` 清零验收）。
