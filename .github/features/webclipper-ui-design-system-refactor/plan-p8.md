# Plan P8 - webclipper-ui-design-system-refactor

**Goal:** 将“删除”这类 destructive 按钮也做成类似导出按钮的 surface 反馈（默认凸起、hover/active 下沉到 sunken），但不牺牲 destructive 的语义。

**Non-goals:**
- 不改动 i18n 文案。
- 不改动删除逻辑（仅改样式）。

**Acceptance:**
- 列表工具栏的删除按钮具有明确的“凸起/凹陷”反馈。
- 删除确认弹窗的主 destructive 按钮保持红色填充，避免语义减弱。
- 通过 `npm --prefix webclipper run compile/test/build`。

---

## P8-T1 删除按钮：增加凸起/凹陷反馈（danger surface）

**Files:**
- Modify: `webclipper/src/ui/shared/button-styles.ts`
- Modify: `webclipper/src/ui/conversations/ConversationListPane.tsx`
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`
- Add: `.github/features/webclipper-ui-design-system-refactor/plan-p8.md`

**Step 1: 新增 destructive 的 surface variant**
- 在 `button-styles.ts` 新增 `buttonDangerTintClassName()`（或等价命名）：
  - base：`bg-card` + 带 error 的边框/文字
  - hover/active：`bg-sunken`（模拟按下凹陷）
  - focus ring 与 disabled 规则保持一致（0.38）

**Step 2: 替换按钮**
- `ConversationListPane`：工具栏的删除按钮使用 `buttonDangerTintClassName()`；确认弹窗继续使用 `buttonDangerClassName()`。

**Step 3: 验证（快速）**
- Run: `npm --prefix webclipper run compile`

**Step 4: 原子提交**
- Run: `git add webclipper/src/ui/shared/button-styles.ts webclipper/src/ui/conversations/ConversationListPane.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml .github/features/webclipper-ui-design-system-refactor/plan-p8.md`
- Run: `git commit -m \"style: task31 - 删除按钮增加凹陷反馈\"`

---

## P8-T2 Phase 验证（compile/test/build）

**Files:**
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: Phase 验证**
- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
- Run: `npm --prefix webclipper run build`

**Step 2: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m \"chore: task32 - P8 验证通过（compile/test/build）\"`

---

## Phase Audit

- Audit file: `audit-p8.md`

