# WebClipper 完全迁移到 WXT 新架构（去 Legacy）实施计划

> 最近更新：2026-03-02
> 执行方式：`executing-plans` 按批次推进；每个 Task 完成后做原子化 git 提交。

## 1) 当前状态（已执行结果）

### Goal（目标）
WebClipper 完全运行在 WXT + TS/React 架构下，移除 legacy 入口与全局注入桥接，便于后续扩展新标签页/网页应用（`chrome-extension://...`）。

### 已完成里程碑（Task1 ~ Task24）

- `Task1` 文档基线：`c1a26d70`
- `Task2` TS IDB schema：`b6195750`
- `Task3` domains 切 TS openDb：`653d2298`
- `Task4` 迁移逻辑迁入 TS schema：`1a6ab168`
- `Task5` 删除旧 schema 注入：`ef1fee32`
- `Task6` TS events hub：`ea25d397`
- `Task7` 删除 legacy events hub：`9034cd1c`
- `Task8` Notion token handler TS 化：`fa30217d`
- `Task9` Obsidian settings store TS 化：`a4cfceb2`
- `Task10` Notion sync wrapper：`66ffa32f`
- `Task11` Obsidian sync wrapper：`502b0dd3`
- `Task12` runtime client TS 化：`517b9837`
- `Task12b` content bootstrap 去全局：`ed7daf5d`
- `Task13` 删除 legacy content entry：`a377c653`
- `Task14` 删除 legacy background entry：`fa8307b8`
- `Task15` 删除 legacy background router：`49f0a518`
- `Task16` collectors core TS 化：`fc40198f`
- `Task17` 各站点 collector TS 化：`4b5d4b9d` ~ `a6a20c2e`
- `Task18` protocols 去全局（第一阶段）：`f8ccf833`
- `Task19` export 栈去全局（第一阶段）：`632ccd1d`
- `Task20` protocol 注入链清理：`06f023d7`
- `Task21` collectors runtime 去全局：`ef886034`
- `Task22` inpage runtime 去全局：`6786c15d`
- `Task23` export service 去全局：`b6a7962e`
- `Task24` zero-global 收口：`bc5194de`
- 执行中补丁（导入路径/构建修复）：`1bb98d73`

### 验收状态快照

- 验收 A：`src/legacy/*` 清零 + 入口不再引用 legacy
  - 状态：**已完成**（`Extensions/WebClipper/src/legacy/` 目录为空）
- 验收 B：不再依赖 `globalThis.WebClipper.*`
  - 状态：**已完成**（`rg "globalThis\.WebClipper|WebClipper\." Extensions/WebClipper/src -n | wc -l` = `0`）
- 验收 C：`compile` / `test` / `build`
  - 状态：**已完成**（最近一次全量均通过）

---

## 2) 下一阶段目标（第三阶段）

> 第二阶段（Task20~Task24）已完成。下一阶段主目标：**统一迁移 `src` 业务模块到 TypeScript（逐步清零 `.js`）**。

### Definition of Done（第三阶段）

1. `Extensions/WebClipper/src` 业务运行路径中的 `.js` 模块完成 TS 对齐（兼容 shim 可短期保留，但不得承载主实现）
2. 清理 `declare module '*.js'` 与 runtime CJS 兼容桥接（仅在必要测试路径保留）
3. 通过：
   - `npm --prefix Extensions/WebClipper run compile`
   - `npm --prefix Extensions/WebClipper run test --silent`
   - `npm --prefix Extensions/WebClipper run build`

---

## 3) 第二阶段任务清单（Task20+）

> 状态：以下 Task20~Task24 已全部完成（见上方里程碑与提交记录），保留为执行留痕。

## P8：Protocols 最终去全局

### Task 20: 删除协议全局注入链（bootstrap + JS IIFE）

**Files（主）**
- Modify: `Extensions/WebClipper/src/protocols/bootstrap.ts`
- Delete: `Extensions/WebClipper/src/protocols/message-contracts.js`
- Delete: `Extensions/WebClipper/src/protocols/conversation-kind-contract.js`
- Delete: `Extensions/WebClipper/src/protocols/conversation-kinds.js`
- Modify: 所有依赖这些 JS IIFE 的调用方，改为显式 TS import

**Step 1: 实现**
- 停止在 `bootstrap.ts` 往 `globalThis.WebClipper` 写协议对象
- 所有协议常量统一来自：`src/platform/messaging/message-contracts.ts` 与 `src/protocols/*.ts`

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/conversation-kinds.test.ts`
- `npm --prefix Extensions/WebClipper run compile`

**Step 3: 原子提交**
- `git commit -m "refactor: task20 - remove protocol global injections"`

---

## P9：Collectors/Inpage 去全局

### Task 21: Collectors 运行时去全局（registry/entry 直连）

**Files（主）**
- Modify: `Extensions/WebClipper/src/collectors/*-entry.ts`
- Modify: `Extensions/WebClipper/src/collectors/*/*.js`（逐步迁 TS 或改显式导出）
- Modify: `Extensions/WebClipper/entrypoints/content.ts`
- Modify: `Extensions/WebClipper/src/bootstrap/content-controller.ts`

**Step 1: 实现**
- 不再通过 `NS.collectors` / `NS.collectorsRegistry` 共享 collector
- content 入口显式构建并注入 collectors registry

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/collectors`
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/content-controller-*.test.ts`

**Step 3: 原子提交**
- `git commit -m "refactor: task21 - deglobalize collectors runtime"`

### Task 22: Inpage 依赖去全局（button/tip/observer/updater）

**Files（主）**
- Modify: `Extensions/WebClipper/src/ui/inpage/inpage-button.js`
- Modify: `Extensions/WebClipper/src/ui/inpage/inpage-tip.js`
- Modify: `Extensions/WebClipper/src/collectors/runtime-observer.js`
- Modify: `Extensions/WebClipper/src/storage/incremental-updater.js`
- Modify: `Extensions/WebClipper/src/bootstrap/content-controller.ts`

**Step 1: 实现**
- 以上模块改为显式导出，不再写 `NS.*`
- 由 content controller 通过构造参数注入依赖

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/inpage-*.test.ts tests/smoke/content-controller-*.test.ts`

**Step 3: 原子提交**
- `git commit -m "refactor: task22 - deglobalize inpage runtime modules"`

---

## P10：Export（Notion/Obsidian）最终去全局

### Task 23: Notion/Obsidian orchestrator & service 去全局

**Files（主）**
- Modify: `Extensions/WebClipper/src/export/notion/*.js`
- Modify: `Extensions/WebClipper/src/export/obsidian/*.js`
- Modify: `Extensions/WebClipper/src/integrations/notion/sync/orchestrator.ts`
- Modify: `Extensions/WebClipper/src/integrations/obsidian/sync/orchestrator.ts`
- Delete（完成后）: `Extensions/WebClipper/src/export/bootstrap.ts`

**Step 1: 实现**
- `notion/obsidian` 全部改为显式 `deps` 注入，不再读取 `NS.*`
- 背景入口停止加载 export 全局桥接

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/background-router-notion-sync.test.ts tests/smoke/background-router-obsidian-sync.test.ts tests/smoke/notion-sync-*.test.ts tests/smoke/obsidian-*.test.ts`
- `npm --prefix Extensions/WebClipper run build`

**Step 3: 原子提交**
- `git commit -m "refactor: task23 - deglobalize export services"`

---

## P11：收口

### Task 24: 清零 `globalThis.WebClipper` 引用并完成最终验收

**Files（主）**
- Modify: `Extensions/WebClipper/entrypoints/background.ts`
- Modify: `Extensions/WebClipper/entrypoints/content.ts`
- Modify: 所有残留 `NS` 读取模块

**Step 1: 实现**
- 完全移除 runtime 全局 API 依赖
- 若必须保留极小兼容层，需仅用于 migration test，不参与运行时逻辑

**Step 2: 验证**
- `rg "globalThis\.WebClipper|WebClipper\." Extensions/WebClipper/src -n | wc -l`（期望 `0`）
- `npm --prefix Extensions/WebClipper run compile`
- `npm --prefix Extensions/WebClipper run test --silent`
- `npm --prefix Extensions/WebClipper run build`

**Step 3: 原子提交**
- `git commit -m "chore: task24 - finalize zero-global runtime"`

---

## 4) 回归策略（每个 P 分组结束时）

- `npm --prefix Extensions/WebClipper run compile`
- `npm --prefix Extensions/WebClipper run test --silent`
- `npm --prefix Extensions/WebClipper run build`
- 手动冒烟（Chrome）：
  1. popup/app 打开正常
  2. inpage 保存可入库
  3. conversations 自动刷新
  4. backup 导入/导出正常
  5. Obsidian Test + Sync 正常
  6. Notion Connect + Sync 正常

---

## 5) 原子提交规范

- 每个 Task 单独一次 commit，不混入下一 Task
- 提交信息格式：`type: taskNN - ...`
- 若出现“构建修复型补丁”，必须单独提交并在计划中备注

---

## 6) 风险与约束

1. 不改变产品功能行为（本计划只做等价重构）
2. 保持 MV3 约束（禁止 Service Worker 动态 `import()`）
3. IDB 兼容性不破坏（DB 名称、版本、store/index 兼容）
4. 若某 Task 触发跨域回归（Notion/Obsidian/collectors），必须先补针对性测试再继续
