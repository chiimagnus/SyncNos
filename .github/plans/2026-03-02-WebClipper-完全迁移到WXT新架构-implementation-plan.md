# WebClipper 完全迁移到 WXT 新架构（Phase 3: JS→TS）实施计划

> 最近更新：2026-03-02
> 执行方式：`executing-plans` 按批次推进；每个 Task 完成后做原子化 git 提交。

**Goal（目标）:** 完成 WebClipper 运行时代码的 JS→TS 全量迁移，移除 CommonJS `require` 链，确保 MV3 Service Worker 正常启动，并为后续 New Tab / App 扩展提供稳定架构基线。  
**Non-goals（非目标）:** 本阶段不新增业务功能、不改 UI 文案与交互规则、不调整权限范围。  
**Approach（方案）:** 先清理“启动阻塞”链路（background/content 的 `require`），再按域迁移（core → collectors → inpage → export → tests），最后做规则化收口（禁止新增 runtime JS）。  
**Acceptance（验收）:** `compile`/`test`/`build` 全通过；Chrome 加载 `.output/chrome-mv3` 不再出现 `require is not defined` / `Service worker registration failed`；`src+entrypoints` 业务主路径不再依赖 `.js` 主实现。

---

## 1) 当前基线（截至 2026-03-02）

### 已完成里程碑（Task1 ~ Task40）

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
- `Task17` 各站点 collector TS 化（首批）：`4b5d4b9d` ~ `a6a20c2e`
- `Task18` protocols 去全局（第一阶段）：`f8ccf833`
- `Task19` export 栈去全局（第一阶段）：`632ccd1d`
- `Task20` protocol 注入链清理：`06f023d7`
- `Task21` collectors runtime 去全局：`ef886034`
- `Task22` inpage runtime 去全局：`6786c15d`
- `Task23` export service 去全局：`b6a7962e`
- `Task24` zero-global 收口：`bc5194de`
- `Task25` runtime-context TS 化 + background 去 require：`21de81fb`
- `Task26` content 入口去 CJS/全局回退：`6223e803`
- `Task27` protocol JS 双轨清理：`6056b72c`
- `Task28` shared/storage 核心 TS 化：`c87ebda7`
- `Task29` bootstrap TS 收敛：`fa74e9d5`
- `Task30` collectors runtime-observer TS 化 + tests 对齐：`88b9b659`
- `Task31` collectors A 组 TS 化：`91271e72`
- `Task32` collectors B 组 TS 化：`9c4aa8a4`
- `Task33` web collector pipeline TS 化：`20191b28`
- `Task34` inpage button/tip TS 化：`ea6eee9c`
- `Task35` local + obsidian export TS 化：`39277017`
- `Task36` notion export TS 化：`0616edf0`
- `Task37` integrations/domain wrapper 去 `.js` 依赖：`933ef775`
- `Task38` 测试装载改为 TS/ESM：`3d60b9bb`
- `Task39` 删除 JS 过渡声明 + runtime JS guardrail：`62609966`
- `Task40` 文档回写 + Phase 3 验收收口：`22e848cf`

### 当前问题快照（Phase 3 输入）

1. Chrome 加载报错：`Service worker registration failed. Status code: 15`
2. `background.js` 报错：`Uncaught ReferenceError: require is not defined`
3. 根因定位：运行时链路中仍保留 CJS `require`（`entrypoints/background.ts`、`runtime-context.js`、若干 `*.js` 模块）

**当前状态（截至 2026-03-02）**
- 上述启动阻塞问题已清零；`require is not defined` / `Service worker registration failed` 复现链路已移除。
- `src + entrypoints` runtime JS 仅保留 allowlist：`src/vendor/readability.js`（第三方注入资产）。

### 代码规模快照（`src + entrypoints`，截至 2026-03-02）

- `*.ts`: `108`
- `*.js`: `1`
- JS 仅剩 allowlist：`src/vendor/readability.js`

---

## 2) 第三阶段范围与约束

### 范围（in-scope）

- `Extensions/WebClipper/src/**` 与 `Extensions/WebClipper/entrypoints/**` 的业务 JS 主实现迁移到 TS
- 移除 runtime 链路中的 `require(...)`
- 移除 `src/types/js-modules.d.ts`
- 清理 `no-var-requires` 豁免与 `.js` 扩展硬编码导入

### 约束（必须满足）

1. MV3 约束：Service Worker 不能使用动态 `import()` 与 Node 风格 `require`
2. 行为等价：不改变已有功能行为（采集/同步/备份/UI 交互语义）
3. IDB 兼容：不破坏现有 schema、store、index 与历史数据读取
4. 渐进式提交：每个 Task 原子提交，便于回滚

### 特殊说明（允许的 JS 例外）

- `src/collectors/web/readability.js` 属于第三方注入脚本资产（executeScript 文件），可暂时保留 JS 形态；
- 若保留，需迁移到明确的 vendor 位置并在规则中加入 allowlist，不得与业务逻辑 JS 混用。

---

## 3) 第三阶段任务清单（Task25+）

## P12（阻塞优先）：Service Worker require 链清零

### Task 25: `runtime-context` TS 化 + 背景入口去 `require`

**Files（主）**
- Create: `Extensions/WebClipper/src/runtime-context.ts`
- Modify: `Extensions/WebClipper/entrypoints/background.ts`
- Modify: `Extensions/WebClipper/src/bootstrap/background.ts`
- Modify: 所有 TS 中 `require('../../runtime-context.js')` 读取点（domains/integrations/ui）
- Delete: `Extensions/WebClipper/src/runtime-context.js`（或仅保留空壳 re-export，下一 Task 删除）

**Step 1: 实现**
- 把 runtime context 改为 ESM TS 导出（可含兼容 getter/setter，但不能依赖 CJS）
- 背景链路全部改静态 `import`

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run compile`
- `npm --prefix Extensions/WebClipper run build`
- `rg "require\\(" Extensions/WebClipper/.output/chrome-mv3/background.js -n`（期望无命中）

**Step 3: 原子提交**
- `git commit -m "refactor: task25 - migrate runtime context to ts and remove background require chain"`

### Task 26: Content 入口去 CJS/全局回退桥接

**Files（主）**
- Modify: `Extensions/WebClipper/entrypoints/content.ts`
- Modify: `Extensions/WebClipper/src/collectors/bootstrap.ts`
- Modify: `Extensions/WebClipper/src/collectors/collector-context.*`

**Step 1: 实现**
- 移除 `entrypoints/content.ts` 中 `require('../src/runtime-context.js')`
- 移除 `globalThis.WebClipper` fallback 桥接，改为显式依赖注入

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/content-controller-*.test.ts`
- `npm --prefix Extensions/WebClipper run build`

**Step 3: 原子提交**
- `git commit -m "refactor: task26 - remove cjs bridge and global fallback in content entry"`

---

## P13：Core & Protocols TS 收敛

### Task 27: Protocol JS 双轨清理（只保留 TS）

**Files（主）**
- Delete: `Extensions/WebClipper/src/protocols/conversation-kind-contract.js`
- Delete: `Extensions/WebClipper/src/protocols/conversation-kinds.js`
- Modify: 所有引用方改到 `.ts`（或无扩展 ESM 导入）

**Step 1: 实现**
- 统一协议导入源为 `src/protocols/*.ts` 与 `src/platform/messaging/message-contracts.ts`

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/conversation-kinds.test.ts`
- `npm --prefix Extensions/WebClipper run compile`

**Step 3: 原子提交**
- `git commit -m "refactor: task27 - remove protocol js duplicates and standardize ts imports"`

### Task 28: Shared/Storage JS 模块迁移 TS

**Files（主）**
- Modify/Create: `Extensions/WebClipper/src/shared/normalize.ts`
- Modify/Create: `Extensions/WebClipper/src/shared/runtime-client.ts`
- Modify/Create: `Extensions/WebClipper/src/storage/incremental-updater.ts`
- Modify/Create: `Extensions/WebClipper/src/storage/backup-utils.ts`
- Delete: 对应 `.js`

**Step 1: 实现**
- 将四个核心通用模块切换为 TS 主实现
- 修正调用方导入路径

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/schema.test.ts tests/smoke/backup-*.test.ts tests/smoke/backup-utils.test.ts`
- `npm --prefix Extensions/WebClipper run compile`

**Step 3: 原子提交**
- `git commit -m "refactor: task28 - migrate shared and storage core modules to ts"`

### Task 29: Bootstrap JS 清理（content/background-inpage）

**Files（主）**
- Modify/Create: `Extensions/WebClipper/src/bootstrap/background-inpage-web-visibility.ts`
- Delete: `Extensions/WebClipper/src/bootstrap/background-inpage-web-visibility.js`
- Delete: `Extensions/WebClipper/src/bootstrap/content.js`（保留 `content.ts`）
- Delete: `Extensions/WebClipper/src/bootstrap/content-controller.js`（保留 `content-controller.ts`）
- Modify: 相关导入方

**Step 1: 实现**
- 统一 bootstrap 仅保留 TS 版本
- 清理重复实现，避免双维护

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/content-controller-*.test.ts`
- `npm --prefix Extensions/WebClipper run compile`

**Step 3: 原子提交**
- `git commit -m "refactor: task29 - consolidate bootstrap modules to ts only"`

---

## P14：Collectors 全域 TS 化

### Task 30: Collectors 基础设施迁移 TS

**Files（主）**
- Modify/Create: `Extensions/WebClipper/src/collectors/collector-context.ts`
- Modify/Create: `Extensions/WebClipper/src/collectors/collector-contract.ts`
- Modify/Create: `Extensions/WebClipper/src/collectors/collector-utils.ts`
- Modify/Create: `Extensions/WebClipper/src/collectors/registry.ts`
- Modify/Create: `Extensions/WebClipper/src/collectors/runtime-observer.ts`
- Delete: 对应 `.js`

**Step 1: 实现**
- 迁移基础模块并稳定导出类型
- `collectors/bootstrap.ts` 改 TS 导入

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/collectors`
- `npm --prefix Extensions/WebClipper run compile`

**Step 3: 原子提交**
- `git commit -m "refactor: task30 - migrate collectors core infrastructure to ts"`

### Task 31: Collectors 站点实现 TS 化（A 组）

**Files（主）**
- `src/collectors/chatgpt/*`
- `src/collectors/claude/*`
- `src/collectors/gemini/*`
- `src/collectors/deepseek/*`
- `src/collectors/kimi/*`

**Step 1: 实现**
- 逐模块迁移为 TS，保持 capture/matches 语义不变

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/collectors/chatgpt-collector.test.ts tests/collectors/claude-collector.test.ts tests/collectors/gemini-collector.test.ts tests/collectors/deepseek-collector.test.ts tests/collectors/kimi-collector.test.ts`

**Step 3: 原子提交**
- `git commit -m "refactor: task31 - migrate collectors site batch a to ts"`

### Task 32: Collectors 站点实现 TS 化（B 组）

**Files（主）**
- `src/collectors/doubao/*`
- `src/collectors/yuanbao/*`
- `src/collectors/poe/*`
- `src/collectors/notionai/*`
- `src/collectors/zai/*`

**Step 1: 实现**
- 同步迁移 markdown/capture 模块并清理 `.js` 导入

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/collectors/doubao-collector.test.ts tests/collectors/yuanbao-collector.test.ts tests/collectors/poe-collector.test.ts tests/collectors/notionai-collector.test.ts tests/collectors/zai-collector.test.ts`

**Step 3: 原子提交**
- `git commit -m "refactor: task32 - migrate collectors site batch b to ts"`

### Task 33: Web Collector 与文章抓取链路 TS 化

**Files（主）**
- Modify/Create: `Extensions/WebClipper/src/collectors/web/web-collector.ts`
- Modify/Create: `Extensions/WebClipper/src/collectors/web/article-fetch-service.ts`
- (可选迁移/归位): `Extensions/WebClipper/src/collectors/web/readability.js` → `src/vendor/readability.js`

**Step 1: 实现**
- 业务代码迁移到 TS
- 对 `readability.js` 做 vendor 隔离与 allowlist 说明

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/article-fetch-service.test.ts`
- `npm --prefix Extensions/WebClipper run compile`

**Step 3: 原子提交**
- `git commit -m "refactor: task33 - migrate web collector pipeline to ts and isolate readability vendor asset"`

---

## P15：Inpage 与 Export 栈 TS 化

### Task 34: Inpage Button/Tip TS 化

**Files（主）**
- Modify/Create: `Extensions/WebClipper/src/ui/inpage/inpage-button.ts`
- Modify/Create: `Extensions/WebClipper/src/ui/inpage/inpage-tip.ts`
- Modify: `Extensions/WebClipper/src/ui/inpage/inpage-button-shadow.ts`
- Modify: `Extensions/WebClipper/src/ui/inpage/inpage-tip-shadow.ts`
- Delete: 对应 `.js`

**Step 1: 实现**
- 移除 inpage 层的 `require` 与 CJS 依赖
- shadow 模块改为 ESM TS 导入

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/inpage-*.test.ts tests/smoke/content-controller-inpage-combo.test.ts`
- `npm --prefix Extensions/WebClipper run build`

**Step 3: 原子提交**
- `git commit -m "refactor: task34 - migrate inpage button and tip modules to ts"`

### Task 35: Local + Obsidian Export 模块 TS 化

**Files（主）**
- `src/export/local/article-markdown.*`
- `src/export/local/zip-utils.*`
- `src/export/obsidian/*.js`（6个模块）

**Step 1: 实现**
- local/obsidian 导出与同步模块迁移 TS
- 保持现有 orchestrator API 契约不变

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/article-markdown.test.ts tests/smoke/zip-utils.test.ts tests/smoke/obsidian-*.test.ts`

**Step 3: 原子提交**
- `git commit -m "refactor: task35 - migrate local and obsidian export modules to ts"`

### Task 36: Notion Export 模块 TS 化

**Files（主）**
- `src/export/notion/*.js`（9个模块）

**Step 1: 实现**
- 按 `api -> blocks -> service -> orchestrator/jobStore` 顺序迁移，确保接口不变

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/notion-*.test.ts tests/smoke/background-router-notion-sync.test.ts`
- `npm --prefix Extensions/WebClipper run compile`

**Step 3: 原子提交**
- `git commit -m "refactor: task36 - migrate notion export pipeline modules to ts"`

### Task 37: Integrations/Domain Wrapper 去 `.js` 依赖

**Files（主）**
- Modify/Create: `Extensions/WebClipper/src/integrations/notionai-model-picker.ts`
- Modify: `Extensions/WebClipper/src/integrations/notion/sync/orchestrator.ts`
- Modify: `Extensions/WebClipper/src/integrations/obsidian/sync/orchestrator.ts`
- Modify: `Extensions/WebClipper/src/domains/**/*`

**Step 1: 实现**
- 清理最后一批 `require('../../*.js')` 与 `.js` 字面导入
- 全部改 ESM TS 引用

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent -- tests/smoke/background-router-*.test.ts tests/smoke/notion-sync-orchestrator-kind-routing.test.ts tests/smoke/obsidian-sync-orchestrator.test.ts`

**Step 3: 原子提交**
- `git commit -m "refactor: task37 - remove remaining js imports from integrations and domain wrappers"`

---

## P16：测试迁移与规则化收口

### Task 38: 测试加载方式迁移（从 `require(...*.js)` 到 TS/ESM）

**Files（主）**
- Modify: `Extensions/WebClipper/tests/**/*.test.ts`
- Create（如需要）: `Extensions/WebClipper/tests/helpers/collectors-bootstrap.ts`

**Step 1: 实现**
- 将测试中的 JS require 路径统一到 TS 模块（可用动态 `import()` in test runtime）
- 清理 `@ts-ignore` 与兼容桥接依赖

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run test --silent`

**Step 3: 原子提交**
- `git commit -m "test: task38 - migrate tests to ts module loading"`

### Task 39: 删除 JS 过渡声明 + 新增防回退检查

**Files（主）**
- Delete: `Extensions/WebClipper/src/types/js-modules.d.ts`
- Create: `Extensions/WebClipper/scripts/check-no-runtime-js.mjs`
- Modify: `Extensions/WebClipper/package.json`（新增脚本）

**Step 1: 实现**
- 删除 `declare module '*.js'`
- 新增检查脚本：`src+entrypoints` 禁止新增 runtime JS（仅允许 allowlist）

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run compile`
- `node Extensions/WebClipper/scripts/check-no-runtime-js.mjs`

**Step 3: 原子提交**
- `git commit -m "chore: task39 - remove js module declaration and enforce runtime js guardrail"`

### Task 40: Phase 3 总体验收 + 文档回写

**Files（主）**
- Modify: `.github/plans/2026-03-02-WebClipper-完全迁移到WXT新架构-implementation-plan.md`
- Modify: `Extensions/WebClipper/AGENTS.md`（仅更新入口索引与命令说明）

**Step 1: 实现**
- 回写每个 Task commit 与验收状态
- 标注剩余技术债（如果有）

**Step 2: 验证**
- `npm --prefix Extensions/WebClipper run compile`
- `npm --prefix Extensions/WebClipper run test --silent`
- `npm --prefix Extensions/WebClipper run build`
- Chrome 手动冒烟：加载 `.output/chrome-mv3`，确认无 SW 注册报错

**Step 3: 原子提交**
- `git commit -m "docs: task40 - finalize phase3 migration status and acceptance evidence"`

---

## 3.1) 最近验收记录（Task38 ~ Task40）

- `npm --prefix Extensions/WebClipper run test --silent`
  - 结果：`Test Files 46 passed (46)`，`Tests 177 passed (177)`。
- `npm --prefix Extensions/WebClipper run compile`
  - 结果：通过（`tsc --noEmit`）。
- `npm --prefix Extensions/WebClipper run build`
  - 结果：通过（`wxt build --mv3`，产物输出到 `.output/chrome-mv3`）。
- `rg "require\\(" Extensions/WebClipper/.output/chrome-mv3/background.js -n`
  - 结果：无命中（background 产物已无 `require(`）。
- `node Extensions/WebClipper/scripts/check-no-runtime-js.mjs`
  - 结果：`OK (1 runtime .js file(s), allowlist size: 1)`。

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
  7. 扩展加载无 `Service worker registration failed` / `require is not defined`

---

## 5) 原子提交规范

1. 每个 Task 单独一次 commit，不混入下一 Task
2. 提交信息格式：`type: taskNN - ...`
3. 若出现“构建修复型补丁”，必须单独提交并在计划中备注

---

## 6) 风险与应对

1. **风险：Collector DOM 结构脆弱，迁移后易回归**
   - 应对：按站点分批迁移（Task31/32），每批跑对应 collector tests
2. **风险：Notion/Obsidian 同步链路长，改动面大**
   - 应对：拆 Task35/36，分别验证，避免跨域混改
3. **风险：测试依赖 CommonJS 装载方式**
   - 应对：单独 Task38 处理，先迁业务后迁测试装载器
4. **风险：Service Worker 构建产物隐式回退到 require**
   - 应对：Task25 与 Task39 双重门禁（产物 grep + no-runtime-js guard）
