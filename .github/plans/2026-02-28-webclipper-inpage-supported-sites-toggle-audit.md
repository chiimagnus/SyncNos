# WebClipper Inpage 显示范围开关审计报告

- Skill: `plan-task-auditor`
- Plan: `.github/plans/2026-02-28-webclipper-inpage-supported-sites-toggle-implementation-plan.md`
- Repo root: `/Users/chii_magnus/Github_OpenSource/SyncNos`
- Audit mode: Read-only first（先记录 findings，再修复）

## TODO Board（N=4）

- [x] Task 1 审计：popup 开关 UI/初始化/存储读写
- [x] Task 2 审计：content 侧过滤/默认值/监听/即时生效
- [x] Task 3 审计：测试覆盖完整性
- [x] Task 4 审计：验证日志完整性

## Task-to-File Map

- Task 1
  - `Extensions/WebClipper/src/ui/popup/popup.html`
  - `Extensions/WebClipper/src/ui/popup/popup-core.js`
  - `Extensions/WebClipper/src/ui/popup/popup-inpage-visibility.js`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
- Task 2
  - `Extensions/WebClipper/src/bootstrap/content-controller.js`
- Task 3
  - `Extensions/WebClipper/tests/smoke/content-controller-web-inpage-article-fetch.test.ts`
  - `Extensions/WebClipper/tests/smoke/content-controller-inpage-visibility-setting.test.ts`
  - `Extensions/WebClipper/tests/smoke/content-controller-inpage-combo.test.ts`
- Task 4
  - `npm --prefix Extensions/WebClipper run test`
  - `npm --prefix Extensions/WebClipper run check`

## Findings（Open First）

## Finding F-01

- Task: `Task 2: 在 content-controller 接入 inpage_supported_only 配置，过滤 web inpage 显示并支持实时更新`
- Severity: `High`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/bootstrap/content-controller.js:279`
- Summary: `chrome.storage.onChanged` 只更新内存变量 `inpageSupportedOnly`，未触发按钮重算；静态页面可能不会立刻隐藏/显示 inpage 按钮。
- Risk: 与计划验收“切换后当前页面立即生效”不一致，用户可能误以为开关失效。
- Expected fix: 在 storage 变更回调中立即刷新 inpage 按钮可见性（复用现有 collector 判定与按钮渲染流程），而不是仅等待后续 DOM 变更触发 observer。
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/content-controller-inpage-visibility-setting.test.ts tests/smoke/content-controller-web-inpage-article-fetch.test.ts`
- Resolution evidence: `onStorageChanged` 中新增 `refreshInpageButton()`，并抽出统一按钮刷新函数；测试新增“无需 tick 立即生效”断言。

## Fix Log

- F-01 修复：
  - 在 `content-controller` 中新增 `refreshInpageButton()`，复用 collector 判定与按钮渲染逻辑。
  - `onTick` 改为调用 `refreshInpageButton()`，避免渲染逻辑分叉。
  - `chrome.storage.onChanged` 回调更新配置后，立即调用 `refreshInpageButton()`。
  - 更新 `content-controller-inpage-visibility-setting.test.ts`，增加 `emitSettingChanged(true)` 后不跑 tick 也会立即隐藏按钮的断言。

## Validation Log

- `npm --prefix Extensions/WebClipper run test -- tests/smoke/content-controller-inpage-visibility-setting.test.ts tests/smoke/content-controller-web-inpage-article-fetch.test.ts` -> PASS（2 files, 4 tests）
- `npm --prefix Extensions/WebClipper run test` -> PASS（40 files, 157 tests）
- `npm --prefix Extensions/WebClipper run check` -> PASS（`[check] ok`）

## Final Status / Residual Risks

- 审计完成，所有 findings 已关闭。  
- 剩余风险：浏览器内“手工交互冒烟”（真实页面点击开关后即显隐）仍建议在 Chrome 扩展环境做一次人工确认。  
