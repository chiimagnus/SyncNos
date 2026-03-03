# WebClipper 去兼容层计划审核报告（Plan Audit）

Target plan:
- `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md`

Repo root:
- `/Users/chii_magnus/Github_OpenSource/SyncNos`

审查方式：
- 使用 `plan-task-auditor`：本报告先记录问题（findings-first），随后才会更新 plan 文档（不实现代码）。

---

## TODO board（17 tasks）

- [ ] Task 1: 建立“反兼容层”检查与基线
- [ ] Task 2: Content 入口改为“显式 deps + collectors 工厂化”
- [ ] Task 3: 逐站点把 collector 改为 `createXCollector(env)`（第一批）
- [ ] Task 3B: 切换 content 入口并删除 side-effect 链
- [ ] Task 4: Background 入口去全局 instanceId 与 backgroundReady 标记
- [ ] Task 5: 用显式 services 工厂替换 `src/bootstrap/background.ts` 的副作用导入
- [ ] Task 6: 路由 handlers 全部改为显式依赖注入（第一批：sync/settings）
- [ ] Task 7: 为 Notion/Obsidian 定义显式服务接口（先不改实现）
- [ ] Task 8: Notion 基础模块纯化
- [ ] Task 9: Notion 业务模块纯化
- [ ] Task 10: Notion orchestrator 改为工厂 + 显式 deps
- [ ] Task 10A: 落地“分层单测”（unit tests）
- [ ] Task 11: Obsidian 模块去 `runtimeContext`（删除兼容委托层）
- [ ] Task 12: Shared/UI/Local/Collectors 去 `runtimeContext`
- [ ] Task 13: 测试移除 `globalThis.WebClipper` 注入
- [ ] Task 14: 删除兼容层文件并清理所有引用（最终收口）
- [ ] Task 15: 更新 WebClipper 文档索引与路径

---

## Task-to-file map（摘要）

- Task 1: `Extensions/WebClipper/package.json`（+ 可选脚本文件位置与目录）
- Task 2–3: `Extensions/WebClipper/entrypoints/content.ts`, `Extensions/WebClipper/src/collectors/**`
- Task 4–6: `Extensions/WebClipper/entrypoints/background.ts`, `Extensions/WebClipper/src/{sync,settings}/background-handlers.ts`
- Task 5–11: `Extensions/WebClipper/src/bootstrap/background*.ts`, `Extensions/WebClipper/src/sync/{notion,obsidian}/**`
- Task 12–14: `Extensions/WebClipper/src/runtime-context.ts`, `Extensions/WebClipper/src/export/bootstrap.ts` + 所有引用点
- Task 13: `Extensions/WebClipper/tests/**`
- Task 15: `Extensions/WebClipper/AGENTS.md`

---

## Findings（Open first）

## Finding F-01
- Task: `Acceptance`
- Severity: `High`
- Status: `Resolved`
- Location: `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md:26`
- Summary: `rg` 验收条件包含 `\\bWebClipper\\b`，会命中大量正常字符串（例如 UI 文案/日志），导致永远无法通过。
- Risk: 验收标准不可达 -> 执行中后期必返工/争论“到底算不算完成”。
- Expected fix: 将验收 grep 范围收敛到“兼容层痕迹”本身（`runtimeContext` / `globalThis.WebClipper`），不要把 `WebClipper` 这个词当成禁用项。
- Validation: `rg -n \"runtimeContext\\b|globalThis\\.WebClipper\" Extensions/WebClipper/{src,entrypoints,tests}`
- Resolution evidence: plan 已将验收命令收敛到 `runtimeContext/globalThis.WebClipper`。

## Finding F-02
- Task: `Task 1: 建立“反兼容层”检查与基线`
- Severity: `Medium`
- Status: `Resolved`
- Location: `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md:39`
- Summary: 计划建议创建 `Extensions/WebClipper/scripts/check-no-compat.mjs`，但当前仓库不存在 `Extensions/WebClipper/scripts/` 目录（需要补 `mkdir -p` 或改用现有脚本路径）。
- Risk: 执行者照 plan 做会卡住（目录不存在），或脚本放错位置造成后续维护成本。
- Expected fix: 明确“创建目录”的步骤，或改为只在 `package.json` 里加 `check:no-compat` 直接运行 `rg ... Extensions/WebClipper/{src,entrypoints,tests}`。
- Validation: `ls Extensions/WebClipper/scripts`（若采用脚本方案）+ `npm --prefix Extensions/WebClipper run check:no-compat`
- Resolution evidence: plan 已补充 `mkdir -p` 前置，并把 `rg` 路径改为 repo root 可直接执行。

## Finding F-03
- Task: `Task 2: Content 入口改为“显式 deps + collectors 工厂化”`
- Severity: `High`
- Status: `Resolved`
- Location: `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md:56`
- Summary: Task 2 让 `entrypoints/content.ts` 立刻切到 `registerAllCollectors(registry, env)` + `createXCollector(env)`，但当前 collectors 还未工厂化；Task 3 只迁移“第一批站点”，会导致中间状态无法跑（缺失大量站点 collector）。
- Risk: 早期切换会造成扩展在大多数站点失效，且很难在迁移中保持可用性与测试稳定。
- Expected fix: 调整顺序/引入过渡策略：
  - 先建立 `CollectorEnv` 与 `createXCollector(env)` 迁移模式（并让旧 wiring 仍可跑），
  - 等所有站点 collectors 完成工厂化后，再一次性切换 `entrypoints/content.ts` 到 `registerAllCollectors`。
- Validation: `npm --prefix Extensions/WebClipper run test -- collectors` + 手动冒烟（多站点匹配）
- Resolution evidence: plan 已将 Task 2 改为“不立即切换入口”，并新增 Task 3B 作为切换与收口步骤。

## Finding F-04
- Task: `Task 3: 逐站点把 collector 改为 createXCollector(env)`
- Severity: `High`
- Status: `Resolved`
- Location: `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md:104`
- Summary: Task 3 在只迁移少量站点时就计划删除 `src/collectors/{collector-context.ts,bootstrap.ts,sites-bootstrap.ts,*-entry.ts}`，会直接破坏未迁移站点的注册/运行。
- Risk: 大范围功能回归；并且“删了又得加回来”导致计划执行混乱。
- Expected fix: 把“删除旧 side-effect 链”拆成单独收尾 Task，并明确前置条件：**所有 collectors 已工厂化且 entrypoint 已切换成功**。
- Validation: `npm --prefix Extensions/WebClipper run test -- collectors` + `npm --prefix Extensions/WebClipper run dev` 多站点手测
- Resolution evidence: plan 已新增 Task 3B（含硬门槛）专门负责切换入口与删除 side-effect 链。

## Finding F-05
- Task: `Task 3: 逐站点把 collector 改为 createXCollector(env)`
- Severity: `Medium`
- Status: `Resolved`
- Location: `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md:89`
- Summary: Task 3 标注“第一批：normalize 依赖”，但真实 collector 依赖不止 normalize（例如 ChatGPT 还依赖 `NS.chatgptMarkdown`；各站点还有 `NS.collectorUtils` 等），计划描述不足以指导执行者完整迁移。
- Risk: 执行者迁移到一半发现“还有一堆 NS.*”，造成返工与漏改。
- Expected fix: 在 plan 中明确 CollectorEnv 的责任边界（哪些能力必须从 env 提供、哪些必须显式 import），并列出迁移 checklist（NS.normalize / NS.*Markdown / NS.collectorUtils / NS.collectorsRegistry.register 等）。
- Validation: `rg -n \"\\bNS\\.\" Extensions/WebClipper/src/collectors` 在对应站点迁移后逐步清零
- Resolution evidence: plan 已在 Task 3 增补站点迁移 checklist（normalize/markdown/collectorUtils/注册）。

## Finding F-06
- Task: `Task 6: 路由 handlers 全部改为显式依赖注入（第一批：sync/settings）`
- Severity: `High`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/settings/background-handlers.ts:5,42`
- Summary: 当前 settings handlers 依赖 `testObsidianConnection`（来自 `src/sync/obsidian/orchestrator.ts`）与 `runtimeContext.notionSyncJobStore/backgroundInpageWebVisibility`；但 plan 的 deps 列表未覆盖 `testObsidianConnection` 与 “Notion disconnect keys 需要 job-store 常量”。
- Risk: 按 plan 执行时容易漏注入/漏迁移，导致设置页功能回归（测试连接、断开 Notion、应用 inpage 可见性设置）。
- Expected fix: 在 Task 6 / Task 11 明确：
  - `registerSettingsHandlers(router, deps)` 需要的完整 deps（含 `testObsidianConnection` 或等价能力、jobStore key、backgroundInpageWebVisibility）
  - `testObsidianConnection` 的归属：移入 `obsidian-sync-orchestrator` 或独立 `obsidian-connection.ts`（由 services 提供）
- Validation: `npm --prefix Extensions/WebClipper run test -- smoke/background-router-open-popup.test.ts` + 增补 settings handler 单测（若已有）
- Resolution evidence: plan 已补齐 Task 6 deps，并在 Task 11 明确 `testObsidianConnection` 的迁移落点选项。

## Finding F-07
- Task: `Task 8: Notion 基础模块纯化`
- Severity: `Low`
- Status: `Resolved`
- Location: `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md:241`
- Summary: “token-store.ts（只要它还被 runtimeContext 兼容层引用即可）”的措辞与破坏性重构目标不一致（最终会删除兼容层，不应以此为前提）。
- Risk: 计划读者误解“要保留兼容层一段时间/长期”，或在迁移中保留不必要的回退逻辑。
- Expected fix: 改写为：token-store 作为业务模块纯导出；去掉所有 runtimeContext 相关说明。
- Validation: 无（文档一致性修正）
- Resolution evidence: plan 已去除该括号说明。

## Finding F-08
- Task: `测试策略（Approach）`
- Severity: `Medium`
- Status: `Resolved`
- Location: `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md:20`
- Summary: plan 目标是“分层单测 + 少量 smoke”，但 tasks 实际仍以 smoke/compile 为主，缺少明确的“拆分纯函数 + 新增单测文件”的任务与验收命令。
- Risk: 破坏性重构期间缺少细粒度回归网，迁移成本飙升、定位困难。
- Expected fix: 增加 1–2 个专门 Task：
  - 将 Notion orchestrator 中纯函数（cursor/差异计算/blocks 组装前置）抽到独立模块
  - 新增 `tests/unit/notion-*.test.ts` 等单测并要求 `--filter` 验证
- Validation: `npm --prefix Extensions/WebClipper run test -- <unit test file>`
- Resolution evidence: plan 已新增 Task 10A（纯函数抽取 + unit tests + 验证命令）。

---

## Fix log

- 已更新 plan 文档（不实现代码）：修正验收标准、修正 collectors 迁移顺序并新增收口 Task、补齐 settings deps 与连接测试迁移、补齐分层单测 Task。

## Validation log

- Read-only checks:
  - `ls Extensions/WebClipper/scripts` => 目录不存在（用于支撑 F-02）
  - `rg -n "collectorsRegistry.register(" Extensions/WebClipper/src/collectors | head` => collectors 目前通过 `NS.collectorsRegistry.register` 注册（用于支撑 F-03/F-04/F-05）

## Final status

- Findings: 8 Open
- Next action: 更新 `.github/plans/2026-03-04-webclipper-remove-compat-layer-wxt-implementation-plan.md`，修正验收标准、修正 Task 顺序与前置条件、补齐 settings deps 与测试重构任务。
