# Inpage 跟随气泡提示 计划审计报告

- Skill: `plan-task-auditor`
- Repo Root: `/Users/chii_magnus/Github_OpenSource/SyncNos`
- Target Plan: `.github/plans/2026-02-23-inpage-speech-bubble-implementation-plan.md`
- Audit Mode: Read-only first（本节不改代码）

## TODO board（N=6）

- [x] Task 1 审计：`content-controller` typed tip 调用
- [x] Task 2 审计：`inpage-tip` 单例/锚定/跟随/计时
- [x] Task 3 审计：`inpage.css` 视觉语义与动效
- [x] Task 4 审计：`inpage-tip` smoke 测试覆盖
- [x] Task 5 审计：四边停靠与降级回归证据
- [x] Task 6 审计：`AGENTS.md` 文档一致性

## Task-to-file map

- Task 1 -> `Extensions/WebClipper/src/bootstrap/content-controller.js`
- Task 2 -> `Extensions/WebClipper/src/ui/inpage/inpage-tip.js`
- Task 3 -> `Extensions/WebClipper/src/ui/styles/inpage.css`
- Task 4 -> `Extensions/WebClipper/tests/smoke/inpage-tip-speech-bubble.test.ts`
- Task 5 -> `Extensions/WebClipper/src/ui/inpage/inpage-tip.js`, `Extensions/WebClipper/src/ui/styles/inpage.css`
- Task 6 -> `Extensions/WebClipper/AGENTS.md`

## Findings（Open first）

## Finding F-01

- Task: `Task 2: 重构 inpage-tip 为“锚定 icon 的单例气泡”`
- Severity: `Medium`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/ui/inpage/inpage-tip.js:224`
- Summary: `showSaveTip` 在 `replayEnterAnimation` 之后立即调用 `resetTimers`，会清理刚设置的 `animTimer`。
- Risk: 动画结束清理逻辑可能被跳过，`.is-enter` 类保留时间异常，影响后续动画状态一致性。
- Expected fix: 在显示流程中先清理旧计时器，再执行动画重播；避免清理到当前动画计时器。
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/inpage-tip-speech-bubble.test.ts`
- Resolution evidence: `d97001d2` 将 `resetTimers()` 前移到 `replayEnterAnimation()` 之前，避免误清理当前动画计时器。

## Finding F-02

- Task: `Task 5: 手工回归四边停靠与动效体验`
- Severity: `Medium`
- Status: `Resolved`
- Location: `Extensions/WebClipper/tests/smoke/inpage-tip-speech-bubble.test.ts:60`
- Summary: 当前测试仅覆盖“右侧 icon -> 向左弹出”单路径，缺少四边停靠方向映射的自动化守护。
- Risk: 后续定位逻辑调整时，左/上/下边缘可能回归但不会被 CI 捕获。
- Expected fix: 增补最小参数化测试，覆盖 left/right/top/bottom 四个边缘的 inward placement。
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/inpage-tip-speech-bubble.test.ts`
- Resolution evidence: `5b9544fd` 新增 4-edge 参数化测试和 `is-enter` 清理测试，当前文件总计 8 个测试用例。

## Fix log

- `d97001d2`：修复 `showSaveTip` 计时器顺序，确保动画计时器不被立即清理。
- `5b9544fd`：补齐四边 inward placement 与动画类清理的自动化覆盖。

## Validation log

- PASS: `npm --prefix Extensions/WebClipper run test -- tests/smoke/inpage-tip-speech-bubble.test.ts`
- PASS: `npm --prefix Extensions/WebClipper run check`
- PASS: `npm --prefix Extensions/WebClipper run test`
- PASS: `npm --prefix Extensions/WebClipper run build`

## Final status and residual risks

- 审计发现共 2 项，已全部 `Resolved`。
- 残余风险：Task 5 的“真实浏览器手工交互”已由自动化替代覆盖关键路径；如果需要发布前体验验收，建议再做一次真实页面拖拽观察。
