# WebClipper 去掉兼容层（runtimeContext / globalThis.WebClipper）实施计划

> 执行方式：建议使用 `executing-plans` 按 Task 粒度分批实现与验收（每个 Task 一个原子提交）。

**Goal（目标）:** 在 `Extensions/WebClipper` 内完全移除兼容层（`src/runtime-context.ts` + `src/export/bootstrap.ts` 及其所有运行时依赖），让 Background/Content/Popup 的依赖关系变为显式导入/显式注入，测试也不再依赖 `globalThis.WebClipper`。

**Non-goals（非目标）:**
- 不改业务行为/交互（除了 “更显式的依赖注入” 导致的结构变化）。
- 不新增权限、不修改 manifest 匹配范围（除非修复构建/运行必须）。
- 在未明确要求的情况下：不查看、不编辑任何国际化字段（i18n）。

**Approach（方案）:**
- 用“显式依赖容器（factories）+ 纯模块导出”替代 `runtimeContext` 的全局注入，且不再保留任何 dev 调试全局 hook。
- Content 侧：Collectors **全部工厂化**（`createXCollector(env)`），并由 `entrypoints/content.ts` 显式组装：
  - `const env = createCollectorEnv(...)`
  - `const registry = createCollectorsRegistry()`
  - `registerAllCollectors(registry, env)`
  - `createContentController({ collectorsRegistry: registry, ... })`
- Background 侧：用 `createBackgroundServices()` 统一构建 Notion/Obsidian/Backup/Local/WebArticle 等服务实例；各 `register*Handlers(router, deps)` 全部通过参数拿依赖，不从全局读取。
- 测试侧：重构为“分层单测 + 少量 smoke”：
  - Notion/Obsidian：编排（orchestrator）与纯函数转换逻辑单测为主；仅保留 1–2 个最关键 smoke 覆盖路由/组装。
  - Collectors：每站点测试直接创建 `env + collector`，不需要任何全局注入与 side-effect import。

**Acceptance（验收）:**
- `Extensions/WebClipper/src/runtime-context.ts`、`Extensions/WebClipper/src/export/bootstrap.ts` 被删除，且运行/测试不再依赖它们。
- `rg -n "runtimeContext\\b|globalThis\\.WebClipper|\\bWebClipper\\b" Extensions/WebClipper/{src,entrypoints,tests}`：在运行时代码与测试中无匹配（允许文档中出现 “WebClipper” 字样，但不能再出现代码注入/读取）。
- 通过：`npm --prefix Extensions/WebClipper run test`
- 通过：`npm --prefix Extensions/WebClipper run compile`
- 冒烟（手动）：`npm --prefix Extensions/WebClipper run dev` 后，inpage 按钮能在支持站点出现、能保存对话/网页文章、popup 能正常打开。

---

## P1（最高优先级）：建立“无全局 DI”的骨架（但先不一次性重写所有业务）

### Task 1: 建立“反兼容层”检查与基线

**Files:**
- Modify: `Extensions/WebClipper/package.json`（可选：增加 `check:no-compat` 脚本）
- (可选) Create: `Extensions/WebClipper/scripts/check-no-compat.mjs`

**Step 1: 实现**
- 增加一个可重复执行的检查入口（建议脚本化），用于阻止 `runtimeContext`/`globalThis.WebClipper` 回归。
- 推荐检查模式：
  - `rg -n "runtimeContext\\b|globalThis\\.WebClipper" src entrypoints tests`
  - 失败则退出非 0。

**Step 2: 验证**
- Run: `node Extensions/WebClipper/scripts/check-no-compat.mjs`（如果实现了脚本）
- Expected: 在当前阶段允许有命中，但脚本能正确输出命中列表并以非 0 退出（后续 Task 会逐步清零）。

**Step 3: 提交（建议）**
- Commit: `chore: task1 - add no-compat check scaffold`

---

### Task 2: Content 入口改为“显式 deps + collectors 工厂化”

**Files:**
- Modify: `Extensions/WebClipper/entrypoints/content.ts`
- Modify: `Extensions/WebClipper/src/bootstrap/content-controller.ts`（如需调整 deps 类型与调用方式）
- Create: `Extensions/WebClipper/src/collectors/collector-env.ts`
- Create: `Extensions/WebClipper/src/collectors/register-all.ts`
- Modify: `Extensions/WebClipper/src/collectors/registry.ts`（如需扩展类型：支持 `{ id, matches, inpageMatches, collector }`）

**Step 1: 实现**
- 在 `entrypoints/content.ts` 中移除：
  - `import runtimeContext from '../src/runtime-context.ts'`
  - 对 `runtimeContext.*` / `collectorContext.*` 的读取
- 新增 `createCollectorEnv()`（`src/collectors/collector-env.ts`）：
  - 输入：`{ window, document, location, normalize }`（最小集）
  - 输出：collector 工厂需要的 `env`
- 新增 `registerAllCollectors(registry, env)`（`src/collectors/register-all.ts`）：
  - 负责：对每个站点调用 `registry.register({ id, matches, inpageMatches?, collector: createXCollector(env) })`
- `entrypoints/content.ts` 里显式组装：
  - `const env = createCollectorEnv({ ... })`
  - `const registry = createCollectorsRegistry()`
  - `registerAllCollectors(registry, env)`
  - 传入 `createContentController({ collectorsRegistry: registry, ... })`

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: TS 编译通过。

**Step 3: 提交（建议）**
- Commit: `refactor: task2 - factoryize collectors wiring in content entry`

---

### Task 3: 逐站点把 collector 改为 `createXCollector(env)`（第一批：normalize 依赖）

**Files:**
- Modify: `Extensions/WebClipper/src/collectors/*/*-collector.ts`（选 2–3 个站点先打通，比如 chatgpt/claude/gemini）
- Modify: `Extensions/WebClipper/src/collectors/*/*-entry.ts`（预计删除，或改为纯 re-export）
- Modify: `Extensions/WebClipper/src/collectors/sites-bootstrap.ts`（预计删除）
- Modify: `Extensions/WebClipper/src/collectors/collector-context.ts`（预计删除）
- Modify: `Extensions/WebClipper/src/collectors/bootstrap.ts`（预计删除）

**Step 1: 实现**
- 将第一批站点 collector 从：
  - `import collectorContext ...; const NS = collectorContext as any; NS.normalize...`
  改为：
  - `export function createChatgptCollector(env) { ... }`
  - normalize/hashing 通过 `env.normalize` 传入（或 env 里直接有 `normalizeText/fnv1a32`）
- 同步删除已不再需要的：
  - `src/collectors/collector-context.ts`
  - `src/collectors/bootstrap.ts`
  - `src/collectors/sites-bootstrap.ts`（以及各 `*-entry.ts` side-effect import 链）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- collectors/chatgpt-collector.test.ts`
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 第一批站点测试 PASS；编译 PASS。

**Step 3: 提交（建议）**
- Commit: `refactor: task3 - factoryize first collectors batch`

---

### Task 4: Background 入口去全局 instanceId 与 backgroundReady 标记

**Files:**
- Modify: `Extensions/WebClipper/entrypoints/background.ts`
- Modify: `Extensions/WebClipper/src/sync/background-handlers.ts`
- Modify: `Extensions/WebClipper/src/settings/background-handlers.ts`

**Step 1: 实现**
- 在 `entrypoints/background.ts` 中移除 `runtimeContext.__backgroundInstanceId` / `__backgroundReady` 的读写。
- 新增一个 background 内部 module-singleton（不挂 `globalThis`）：
  - Create: `Extensions/WebClipper/src/bootstrap/background-instance.ts`
  - Expose: `getBackgroundInstanceId()`（首次调用生成并缓存）
- `registerSyncHandlers(router, { instanceId })` / `registerSettingsHandlers(router, { instanceId })`：
  - 通过参数传入 instanceId（或传入 `getBackgroundInstanceId` 函数）
  - 移除 handlers 内部对 `runtimeContext.__backgroundInstanceId` 的读取

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Run: `npm --prefix Extensions/WebClipper run test -- smoke/background-router-open-popup.test.ts`
- Expected: 编译通过、冒烟测试通过。

**Step 3: 提交（建议）**
- Commit: `refactor: task4 - remove background instance globals`

---

## P2：Background 侧服务容器化（移除 startBackgroundBootstrap 的“副作用导入链”）

### Task 5: 用显式 services 工厂替换 `src/bootstrap/background.ts` 的副作用导入

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background.ts`
- Create: `Extensions/WebClipper/src/bootstrap/background-services.ts`
- Modify: `Extensions/WebClipper/entrypoints/background.ts`

**Step 1: 实现**
- 引入 `createBackgroundServices()`：
  - 负责构建并返回：
    - Notion：token store、api/files api、db manager、sync service、job store、sync orchestrator
    - Obsidian：local rest client、note path、sync metadata、markdown writer、sync orchestrator
    - Web article fetch：`article-fetch-service`
    - Inpage visibility：`background-inpage-web-visibility`（如果它必须在 background 启动就 start）
    - 其它已迁移：backup/local 等（仅当被 background handlers 直接依赖）
- `startBackgroundBootstrap()` 改为：
  - 返回 `services`（或在内部启动需要启动的 service，如 inpage visibility）
  - 不再 `import '../export/bootstrap.ts'`、不再 `import '../sync/notion/*.ts'` 仅为“把 api 挂到 runtimeContext”

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过。

**Step 3: 提交（建议）**
- Commit: `refactor: task5 - create background services container`

---

### Task 6: 路由 handlers 全部改为显式依赖注入（第一批：sync/settings）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/background-handlers.ts`
- Modify: `Extensions/WebClipper/src/settings/background-handlers.ts`
- Modify: `Extensions/WebClipper/entrypoints/background.ts`
- (可能) Modify: `Extensions/WebClipper/src/platform/messaging/background-router.ts`（仅当需要扩展 router 类型）

**Step 1: 实现**
- 把 `registerSyncHandlers(router)` 改为 `registerSyncHandlers(router, deps)`：
  - deps 至少包含：`notionSyncOrchestrator`、`obsidianSyncOrchestrator`、`getInstanceId`
- 把 `registerSettingsHandlers(router)` 改为 `registerSettingsHandlers(router, deps)`：
  - deps 至少包含：`notionSyncJobStore`、`backgroundInpageWebVisibility` 等（以实际使用为准）
- `entrypoints/background.ts` 从 `createBackgroundServices()` 拿到 deps 并传入。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- smoke`
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: smoke tests 与 compile 通过。

**Step 3: 提交（建议）**
- Commit: `refactor: task6 - inject deps into sync/settings handlers`

---

## P3：彻底移除 `runtimeContext`（包含 Notion/Obsidian/Local/Backup 与测试注入）

### Task 7: 为 Notion/Obsidian 定义显式服务接口（先不改实现）

**Files:**
- Create: `Extensions/WebClipper/src/sync/notion/notion-services.ts`
- Create: `Extensions/WebClipper/src/sync/obsidian/obsidian-services.ts`
- Modify: `Extensions/WebClipper/src/bootstrap/background-services.ts`

**Step 1: 实现**
- 新增纯类型文件（只定义 interface/type，不引入运行时代码）：
  - `NotionServices`：tokenStore / storage / conversationKinds / notionApi / notionFilesApi / dbManager / syncService / jobStore
  - `ObsidianServices`：settingsStore / localRestClient / markdownWriter / metadata / notePath / syncOrchestrator（按实际使用最小化）
- `createBackgroundServices()` 暂时仍可返回旧对象，但类型要先对齐，避免后续“边改边猜”。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过。

**Step 3: 提交（建议）**
- Commit: `refactor: task7 - add notion/obsidian services types`

---

### Task 8: Notion 基础模块纯化（api/files/token 等不再写 runtimeContext）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-api.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-files-api.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/auth/token-store.ts`（只要它还被 runtimeContext 兼容层引用即可）

**Step 1: 实现**
- 删除这些文件里所有 `import runtimeContext` + `runtimeContext.xxx = ...` 的副作用（如果存在）。
- 保持对外 API 仍然是显式 export（供 `background-services.ts` 组装）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译通过。

**Step 3: 提交（建议）**
- Commit: `refactor: task8 - make notion api modules pure`

---

### Task 9: Notion 业务模块纯化（sync-service/db-manager/job-store/blocks/upgrader 不再依赖 NS 注入）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-db-manager.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-job-store.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-markdown-blocks.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-image-upload-upgrader.ts`
- Modify: `Extensions/WebClipper/src/sync/notion/notion-ai.ts`

**Step 1: 实现**
- 移除 `const NS = runtimeContext as any` 以及 `NS.xxx` 读取。
- 把跨模块依赖变为显式 import（或通过 `create*()` 注入）：
  - 例：`notion-sync-service` 需要 `notionApi/notionFilesApi` 时，通过参数传入或 import 其纯模块导出。
- 暂时不要求把 `// @ts-nocheck` 全部去掉；先保证依赖关系正确 + 行为一致。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- smoke/notion-sync-orchestrator-kind-routing.test.ts`
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: Notion smoke 通过；编译通过。

**Step 3: 提交（建议）**
- Commit: `refactor: task9 - remove NS injection from notion modules`

---

### Task 10: Notion orchestrator 改为工厂 + 显式 deps（替换 getDependencies）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Modify: `Extensions/WebClipper/src/bootstrap/background-services.ts`
- Modify: `Extensions/WebClipper/src/sync/background-handlers.ts`
- Modify: `Extensions/WebClipper/tests/smoke/notion-sync-orchestrator-kind-routing.test.ts`

**Step 1: 实现**
- 在 orchestrator 内新增：
  - `export function createNotionSyncOrchestrator(services: NotionServices)` 并返回 `{ syncConversations, getSyncJobStatus }`
- `background-services.ts` 按新工厂构建 orchestrator 实例。
- 测试从 “全局注入” 改为直接创建 `createNotionSyncOrchestrator(fakeServices)`。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- smoke/notion-sync-orchestrator-kind-routing.test.ts`
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: Notion smoke PASS；编译 PASS。

**Step 3: 提交（建议）**
- Commit: `refactor: task10 - notion orchestrator uses explicit deps`

---

### Task 11: Obsidian 模块去 `runtimeContext`（删除兼容委托层）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/obsidian/obsidian-sync-orchestrator.ts`
- Delete (预计): `Extensions/WebClipper/src/sync/obsidian/orchestrator.ts`
- Modify: `Extensions/WebClipper/src/bootstrap/background-services.ts`
- Modify: `Extensions/WebClipper/src/sync/background-handlers.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-obsidian-sync.test.ts`

**Step 1: 实现**
- 让 Obsidian sync 完全由 `background-services.ts` 注入 deps 构建。
- 删除 `orchestrator.ts`（如果它仅用于 runtimeContext fallback）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- smoke/background-router-obsidian-sync.test.ts`
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: Obsidian smoke PASS；编译 PASS。

**Step 3: 提交（建议）**
- Commit: `refactor: task11 - remove runtimeContext from obsidian sync`

---

### Task 12: Shared/UI/Local/Collectors 去 `runtimeContext`（删除所有 “挂 api 到 runtimeContext”）

**Files:**
- Modify: `Extensions/WebClipper/src/shared/normalize.ts`
- Modify: `Extensions/WebClipper/src/conversations/incremental-updater.ts`
- Modify: `Extensions/WebClipper/src/ui/inpage/inpage-button.ts`
- Modify: `Extensions/WebClipper/src/ui/inpage/inpage-tip.ts`
- Modify: `Extensions/WebClipper/src/collectors/collector-context.ts`（预计删除）
- Modify: `Extensions/WebClipper/src/collectors/bootstrap.ts`（预计删除或重写）
- Modify: `Extensions/WebClipper/src/collectors/*/*-collector.ts`（按站点逐个替换 `NS.normalize`/`collectorContext`）
- Modify: `Extensions/WebClipper/src/collectors/runtime-observer.ts`
- Modify: `Extensions/WebClipper/src/sync/local/article-markdown.ts`
- Modify: `Extensions/WebClipper/src/sync/local/zip-utils.ts`
- Modify: `Extensions/WebClipper/src/shared/runtime-client.ts`（如果仍在写 runtimeContext）

**Step 1: 实现**
- 删除所有 `runtimeContext.xxx = api`。
- collectors 改造按站点拆分提交（每站点 5–15 分钟一批），统一目标：
  - 不再存在 `collectorContext` / `NS` / side-effect import 注册
  - 每站点提供 `createXCollector(env)` 并在 `registerAllCollectors(registry, env)` 注册
  - 所有依赖（normalize、markdown utils、DOM helper）要么显式 import，要么来自 env

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- collectors`
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: collectors tests PASS；编译 PASS。

**Step 3: 提交（建议）**
- Commit: `refactor: task12 - remove runtimeContext from shared/ui/collectors`

---

## P4：收口与文档校准（避免未来回退）

### Task 13: 测试移除 `globalThis.WebClipper` 注入（统一改为 import + mock）

**Files:**
- Delete: `Extensions/WebClipper/tests/helpers/collectors-bootstrap.ts`（或改为纯 helper，不写 globalThis）
- Modify: `Extensions/WebClipper/tests/smoke/background-router-open-popup.test.ts`
- Modify: `Extensions/WebClipper/tests/smoke/notion-sync-orchestrator-kind-routing.test.ts`
- Modify: `Extensions/WebClipper/tests/smoke/background-router-obsidian-sync.test.ts`
- Modify: `Extensions/WebClipper/tests/collectors/*.test.ts`
- (可能) Create: `Extensions/WebClipper/tests/helpers/create-test-services.ts`

**Step 1: 实现**
- 把所有 `globalThis.WebClipper = { ... }` 改为：
  - 直接 import 目标模块/工厂
  - 对外部副作用用 `vi.stubGlobal('chrome', ...)` / `vi.mock(...)` 控制
- collectors tests 统一创建 registry 并注册 collectors，不再靠全局 `collectorContext`。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 全部 PASS。

**Step 3: 提交（建议）**
- Commit: `test: task13 - remove globalThis.WebClipper injection`

---

### Task 14: 删除兼容层文件并清理所有引用（最终收口）

**Files:**
- Delete: `Extensions/WebClipper/src/runtime-context.ts`
- Delete: `Extensions/WebClipper/src/export/bootstrap.ts`
- Modify: `Extensions/WebClipper/src/bootstrap/background.ts`
- Modify: `Extensions/WebClipper/entrypoints/background.ts`
- Modify: `Extensions/WebClipper/entrypoints/content.ts`
- Modify: `Extensions/WebClipper/src/bootstrap/background-services.ts`

**Step 1: 实现**
- 移除所有 `import runtimeContext ...`。
- 移除所有 “导入仅为副作用注入” 的链路（例如 `src/bootstrap/background.ts` 顶部那串 import）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Run: `npm --prefix Extensions/WebClipper run compile`
- Run: `rg -n \"runtimeContext\\b|globalThis\\.WebClipper\" Extensions/WebClipper/src Extensions/WebClipper/entrypoints Extensions/WebClipper/tests`
- Expected: 测试/编译 PASS；`rg` 无命中。

**Step 3: 提交（建议）**
- Commit: `refactor: task14 - delete runtimeContext compatibility layer`

---

### Task 15: 更新 WebClipper 文档索引与路径（避免指向旧文件）

**Files:**
- Modify: `Extensions/WebClipper/AGENTS.md`

**Step 1: 实现**
- 修正已迁移模块的路径（例如 web article fetch 的路径已迁到 `src/collectors/web/` 等）。
- 明确指出：已移除 `runtimeContext`/`globalThis.WebClipper`，新增依赖注入/工厂的入口文件路径。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Expected: 编译仍通过（文档改动不影响）。

**Step 3: 提交（建议）**
- Commit: `docs: task15 - update WebClipper AGENTS module index`

---

## 关键决策（破坏性重构版：collector 工厂化 + 测试重构）

1) **Collectors 改造深度**
- 计划选择：**必须全部改成工厂**（`createXCollector(env)`），并通过 `registerAllCollectors(registry, env)` 显式注册。
- 原因：一次性解决隐式单例/隐式依赖，配合测试重构能把回归风险压到最低。

2) **Notion/Obsidian 测试策略**
- 计划选择：以“分层单测”为主，把 orchestrator 变成可注入依赖的纯编排；仅保留少量 smoke（覆盖路由与最关键 happy path）。
- 原因：破坏性重构期间，细粒度单测更能稳定迭代；smoke 只保留足够的系统级保险。

3) **Dev 调试暴露**
- 计划选择：**完全删除/不提供**任何 dev 调试全局暴露（包括历史遗留的迁移产物）。
- 原因：这类入口与“去兼容层”目标冲突，且容易在未来变相复活全局注入。
