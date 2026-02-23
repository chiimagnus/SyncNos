# Inpage 跟随气泡提示 实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 将 inpage 提示改为“跟随右下角 WebClipper icon 的说话气泡”，用于失败与加载提示，并具备从 logo 附近冒出的动效。

**Non-goals（非目标）:** 不改成功态 `✓` 闪烁逻辑；不改采集与存储主流程；不引入新的权限或国际化改动。

**Approach（方案）:** 在 `inpage-tip` 内实现独立单例气泡组件，`content-controller` 只负责传递 `text + kind`。气泡每次显示时锚定 `#webclipper-inpage-btn`，并在可见期内持续重算位置以实现“跟随 icon”；样式与动画统一放在 `inpage.css`，按 `kind` 切换语义色，连续触发采用覆盖并重播动画。

**Acceptance（验收）:**
1. 失败与加载提示都显示为跟随 icon 的气泡（非固定右下角文本块）。
2. icon 拖到四边任意位置时，气泡都向页面内侧弹出且不越界。
3. 气泡出现有“从 logo 冒出”的强表现动效；`prefers-reduced-motion` 下自动降级。
4. 连续触发提示时新消息覆盖旧消息并重置 1.8s 计时。
5. `npm --prefix Extensions/WebClipper run check` 与相关测试通过。

---

## P1（最高优先级）：实现跟随气泡核心交互

### Task 1: 接入提示类型（loading / error）并保持调用收敛

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/content-controller.js`

**Step 1: 实现功能**
- 在 `content-controller` 中增加统一 helper（如 `showInpageTip(text, kind)`）。
- 将现有三处调用改为显式类型：
  - `Loading full history...` -> `kind: "loading"`
  - `No visible conversation found` -> `kind: "error"`
  - `Save failed` -> `kind: "error"`
- 保持向后兼容：若 `inpageTip` 不可用，主流程不受影响。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run check`
- Expected: 语法检查通过，且无新增消息路由副作用。

**Step 3:（可选）原子提交**
- Run: `git add Extensions/WebClipper/src/bootstrap/content-controller.js`
- Run: `git commit -m "feat: task1 - add typed inpage tip calls for loading and error"`

### Task 2: 重构 inpage-tip 为“锚定 icon 的单例气泡”

**Files:**
- Modify: `Extensions/WebClipper/src/ui/inpage/inpage-tip.js`

**Step 1: 实现功能**
- 保留导出名 `showSaveTip`，扩展入参为 `showSaveTip(text, options)`（兼容仅传字符串）。
- 新建/复用单例 DOM（建议 id：`webclipper-inpage-bubble`），包含文案容器与箭头元素。
- 根据 `#webclipper-inpage-btn` 的 `getBoundingClientRect()` 计算锚点，生成 `placement`（left/right/top/bottom，目标是朝页面内侧）。
- 可见期（1.8s）内执行轻量重定位（`requestAnimationFrame` 或等效机制），保证拖拽 icon 时气泡跟随。
- 实现覆盖策略：再次调用时更新文案、状态、位置并重播动画；旧计时器清理。
- 状态语义：写入 `data-kind="loading|error|default"` 供 CSS 取色。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run check`
- Expected: 语法检查通过；页面运行时不会因气泡渲染异常阻断保存流程。

**Step 3:（可选）原子提交**
- Run: `git add Extensions/WebClipper/src/ui/inpage/inpage-tip.js`
- Run: `git commit -m "feat: task2 - implement icon-anchored inpage speech bubble singleton"`

### Task 3: 增加气泡样式、状态色与“冒出”动画

**Files:**
- Modify: `Extensions/WebClipper/src/ui/styles/inpage.css`

**Step 1: 实现功能**
- 增加气泡基础样式类（如 `.webclipper-inpage-bubble`）与箭头样式。
- 按 `data-kind` 提供语义色：
  - `error`：偏红背景/边框
  - `loading`：偏橙背景/边框
  - `default`：中性深色（兼容兜底）
- 增加强表现动效（scale + translate + 轻微 overshoot），并根据 `data-placement` 设置 `transform-origin`，营造“从 logo 冒出”。
- 在 `@media (prefers-reduced-motion: reduce)` 下关闭位移动画，保留可读性。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run check`
- Expected: 样式可加载、无语法错误；动画在默认模式可见，在 reduce-motion 下明显降级。

**Step 3:（可选）原子提交**
- Run: `git add Extensions/WebClipper/src/ui/styles/inpage.css`
- Run: `git commit -m "feat: task3 - add speech-bubble visual system and pop animation"`

### Task 4: 为气泡定位与覆盖策略补充自动化测试

**Files:**
- Create: `Extensions/WebClipper/tests/smoke/inpage-tip-speech-bubble.test.ts`
- Modify（如需导出可测 helper）: `Extensions/WebClipper/src/ui/inpage/inpage-tip.js`

**Step 1: 实现功能**
- 新增 smoke 测试覆盖以下最小场景：
  - 有 icon 时会生成气泡并写入 `data-kind`。
  - 连续两次 `showSaveTip` 会覆盖文案，不创建重复节点。
  - 计时器到期后自动移除节点（`vi.useFakeTimers()`）。
  - icon 位于右侧时，placement 选择向内侧（左向）策略。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/inpage-tip-speech-bubble.test.ts`
- Expected: 新增测试通过。
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 全量测试无回归失败。

**Step 3:（可选）原子提交**
- Run: `git add Extensions/WebClipper/tests/smoke/inpage-tip-speech-bubble.test.ts Extensions/WebClipper/src/ui/inpage/inpage-tip.js`
- Run: `git commit -m "test: task4 - add smoke tests for inpage speech bubble behavior"`

## P2：回归与文档同步

### Task 5: 手工回归四边停靠与动效体验

**Files:**
- Modify（仅在发现问题时）: `Extensions/WebClipper/src/ui/inpage/inpage-tip.js`
- Modify（仅在发现问题时）: `Extensions/WebClipper/src/ui/styles/inpage.css`

**Step 1: 验证场景**
- 在任一受支持站点打开会话页面，触发 inpage button。
- 将 icon 分别拖拽到左/右/上/下边缘，触发 `Loading full history...` 与失败提示，观察气泡朝向和越界情况。
- 在 1.8s 内连续触发两次提示，确认“覆盖 + 动画重播”。
- 在系统“减少动态效果”开启时，确认动效降级。

**Step 2: 命令验证**
- Run: `npm --prefix Extensions/WebClipper run check`
- Expected: 修改后依旧通过。

**Step 3:（可选）原子提交**
- Run: `git add Extensions/WebClipper/src/ui/inpage/inpage-tip.js Extensions/WebClipper/src/ui/styles/inpage.css`
- Run: `git commit -m "fix: task5 - polish inpage speech bubble edge placement and motion"`

### Task 6: 更新扩展开发文档中的 inpage 提示行为

**Files:**
- Modify: `Extensions/WebClipper/AGENTS.md`

**Step 1: 实现功能**
- 在 WebClipper 约束或模块说明中补一条：inpage 错误/加载反馈使用“锚定 icon 的气泡提示”，并说明覆盖与时长策略（1.8s）。

**Step 2: 验证**
- Run: `rg -n \"气泡|inpage\" Extensions/WebClipper/AGENTS.md`
- Expected: 能定位新增约束描述，且与实现一致。

**Step 3:（可选）原子提交**
- Run: `git add Extensions/WebClipper/AGENTS.md`
- Run: `git commit -m "docs: task6 - document inpage speech bubble behavior"`

---

## 分组回归策略

- 完成 P1 后：
  - Run: `npm --prefix Extensions/WebClipper run check`
  - Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/inpage-tip-speech-bubble.test.ts`
- 完成 P2 后：
  - Run: `npm --prefix Extensions/WebClipper run test`
  - Run: `npm --prefix Extensions/WebClipper run build`

## 边界条件清单

- icon 暂未渲染或被清理时，气泡不应抛错或阻断流程。
- 超长文案时气泡需有最大宽度与换行策略，避免超出视口。
- 页面缩放与窗口 resize 后，气泡位置需保持有效。
- 快速连续触发时，必须保持单实例节点，不出现堆叠。

## 不确定项（执行前可 5 分钟确认）

- 是否需要在失败提示上增加“点击重试”交互（当前计划默认不做）。
- `loading` 与 `error` 的最终配色值是否直接沿用现有主题 token（当前计划默认在 `inpage.css` 内定义局部值）。
