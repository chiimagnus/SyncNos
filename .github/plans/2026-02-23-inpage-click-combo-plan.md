# 2026-02-23 Inpage Click Combo Interaction Plan

## Goal

在不破坏现有单击保存能力的前提下，为 inpage icon 增加可玩交互：
- 单击：立即保存（最高优先级）
- 双击：仅在“恰好 2 击”时打开扩展 popup
- 3/5/7 连击：触发分层彩蛋（台词 + icon 动画）
- 400ms 连击窗口统一结算
- 若 `chrome.action.openPopup` 不可用，双击降级提示“点击工具栏图标打开面板”
- 遵循 `prefers-reduced-motion`（减少动态时不播放彩蛋动画）

## Non-goals

- 不新增设置页
- 不改国际化体系
- 不改 popup 主业务逻辑

## Tasks

### Task 1 (P1): 扩展消息协议与 background 打开 popup 能力
- Files:
  - `Extensions/WebClipper/src/shared/message-contracts.js`
  - `Extensions/WebClipper/src/bootstrap/background-router.js`
- Changes:
  - 新增 UI 消息类型：`openExtensionPopup`
  - background 新增 handler，调用 `chrome.action.openPopup()`
  - 对不支持 API/调用失败返回结构化错误，供 content 降级提示
- Validation:
  - `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-open-popup.test.ts`

### Task 2 (P1): inpage button 连击聚合与优先级结算
- Files:
  - `Extensions/WebClipper/src/ui/inpage/inpage-button.js`
- Changes:
  - 连击窗口 400ms
  - 第 1 击立即触发保存回调
  - 窗口结束后结算：2 击 -> 双击回调；3/5/7 -> 最高级彩蛋回调；其余无额外动作
  - 拖拽路径与点击路径隔离，避免误触
- Validation:
  - `npm --prefix Extensions/WebClipper run test -- tests/smoke/inpage-button-click-combo.test.ts`

### Task 3 (P1): inpage icon 彩蛋动画系统（3/5/7）
- Files:
  - `Extensions/WebClipper/src/ui/styles/inpage.css`
  - `Extensions/WebClipper/src/ui/inpage/inpage-button.js`
- Changes:
  - 新增 icon 动画 class（3=shake, 5=spin, 7=rainbow flash）
  - 动画可重播，自动清理 class
  - `prefers-reduced-motion` 下禁用彩蛋动画
- Validation:
  - `npm --prefix Extensions/WebClipper run test -- tests/smoke/inpage-button-click-combo.test.ts`

### Task 4 (P1): content-controller 接线（双击开 popup + 降级提示 + 连击台词）
- Files:
  - `Extensions/WebClipper/src/bootstrap/content-controller.js`
- Changes:
  - 将 inpage button 回调拆为：单击保存、双击动作、彩蛋动作
  - 双击动作向 background 发消息打开 popup
  - openPopup 失败时展示降级气泡提示
  - 3/5/7 连击展示分层趣味台词
- Validation:
  - `npm --prefix Extensions/WebClipper run test -- tests/smoke/content-controller-inpage-combo.test.ts`

### Task 5 (P2): 回归与新增测试
- Files:
  - `Extensions/WebClipper/tests/smoke/background-router-open-popup.test.ts` (new)
  - `Extensions/WebClipper/tests/smoke/inpage-button-click-combo.test.ts` (new)
  - `Extensions/WebClipper/tests/smoke/content-controller-inpage-combo.test.ts` (new)
- Changes:
  - 覆盖双击成功/失败降级
  - 覆盖 2/3/5/7 结算优先级
  - 覆盖单击立即保存 + 双击延迟结算
- Validation:
  - `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-open-popup.test.ts tests/smoke/inpage-button-click-combo.test.ts tests/smoke/content-controller-inpage-combo.test.ts`

### Task 6 (P2): 文档同步与全量校验
- Files:
  - `Extensions/WebClipper/AGENTS.md`
- Changes:
  - 记录 inpage 单击/双击/连击交互约束与降级策略
- Validation:
  - `npm --prefix Extensions/WebClipper run check`
  - `npm --prefix Extensions/WebClipper run test`
  - `npm --prefix Extensions/WebClipper run build`
