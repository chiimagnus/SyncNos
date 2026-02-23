# Audit Report: 2026-02-23 Inpage Click Combo Plan

- Skill: `plan-task-auditor`
- Repo root: `/Users/chii_magnus/Github_OpenSource/SyncNos`
- Target plan: `.github/plans/2026-02-23-inpage-click-combo-plan.md`

## TODO Board (N=6)

- [x] Task 1: 协议与 background openPopup 实现一致性审查
- [x] Task 2: inpage 连击聚合与优先级结算审查
- [x] Task 3: 3/5/7 动画与 reduced-motion 审查
- [x] Task 4: content-controller 接线与降级提示审查
- [x] Task 5: 测试覆盖与回归风险审查
- [x] Task 6: 文档与验证记录一致性审查

## Task-to-File Map

- Task 1:
  - `Extensions/WebClipper/src/shared/message-contracts.js`
  - `Extensions/WebClipper/src/bootstrap/background-router.js`
  - `Extensions/WebClipper/tests/smoke/background-router-open-popup.test.ts`
- Task 2:
  - `Extensions/WebClipper/src/ui/inpage/inpage-button.js`
  - `Extensions/WebClipper/tests/smoke/inpage-button-click-combo.test.ts`
- Task 3:
  - `Extensions/WebClipper/src/ui/styles/inpage.css`
  - `Extensions/WebClipper/src/ui/inpage/inpage-button.js`
  - `Extensions/WebClipper/tests/smoke/inpage-button-click-combo.test.ts`
- Task 4:
  - `Extensions/WebClipper/src/bootstrap/content-controller.js`
  - `Extensions/WebClipper/tests/smoke/content-controller-inpage-combo.test.ts`
- Task 5:
  - `Extensions/WebClipper/tests/smoke/background-router-open-popup.test.ts`
  - `Extensions/WebClipper/tests/smoke/inpage-button-click-combo.test.ts`
  - `Extensions/WebClipper/tests/smoke/content-controller-inpage-combo.test.ts`
- Task 6:
  - `Extensions/WebClipper/AGENTS.md`

## Findings (Open First)

## Finding F-01

- Task: `Task 1: 扩展消息协议与 background 打开 popup 能力`
- Severity: `Medium`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/bootstrap/background-router.js:54`
- Summary: `handleMessage` 在进入 `switch` 前强依赖 `backgroundStorage`，导致 `openExtensionPopup` 这类与存储无关的消息也被“storage module missing”拦截。
- Risk: 当 storage 模块初始化异常时，双击打开 popup 功能被连带不可用，回退行为与计划目标耦合过深。
- Expected fix: 将 storage 可用性校验下沉到需要 storage 的消息分支，仅对 CRUD 分支强校验。
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-open-popup.test.ts`
- Resolution evidence: `Extensions/WebClipper/src/bootstrap/background-router.js` 将 storage 校验下沉到 CRUD 分支；`Extensions/WebClipper/tests/smoke/background-router-open-popup.test.ts` 新增“无 backgroundStorage 仍可 openPopup”用例并通过。

## Finding F-02

- Task: `Task 5: 回归与新增测试`
- Severity: `Medium`
- Status: `Resolved`
- Location: `Extensions/WebClipper/tests/smoke/content-controller-inpage-combo.test.ts:101`
- Summary: 现有测试覆盖了 popup 打开失败时的降级提示，但未覆盖“popup 成功打开时不应提示错误气泡”的正向路径。
- Risk: 后续改动可能在成功场景误触发 fallback 提示，用户体验退化但测试无法拦截。
- Expected fix: 增加 success-path 用例，验证 `openExtensionPopup` 返回成功时不会出现“toolbar icon”错误提示。
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/content-controller-inpage-combo.test.ts`
- Resolution evidence: `Extensions/WebClipper/tests/smoke/content-controller-inpage-combo.test.ts` 新增 success-path 用例 `does not show fallback tip when popup open succeeds` 并通过。

## Fix Log

- F-01:
  - 下沉 `backgroundStorage` 校验到 CRUD 分支，解除 `openExtensionPopup` 对 storage 的不必要耦合。
  - 新增 popup 路由无 storage 场景测试。
- F-02:
  - 补充 content-controller 双击打开 popup 成功路径测试，约束不应出现 fallback 错误提示。

## Validation Log

- Targeted:
  - `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-open-popup.test.ts tests/smoke/content-controller-inpage-combo.test.ts` -> PASS
- Broad:
  - `npm --prefix Extensions/WebClipper run check` -> PASS
  - `npm --prefix Extensions/WebClipper run test` -> PASS (24 files, 100 tests)
  - `npm --prefix Extensions/WebClipper run build` -> PASS

## Final Status and Residual Risks

- 所有 Open finding 已修复并验证通过。
- Residual risk:
  - `chrome.action.openPopup()` 在部分浏览器/策略环境仍可能因用户激活限制失败；当前按计划已通过 inpage fallback 提示兜底。
