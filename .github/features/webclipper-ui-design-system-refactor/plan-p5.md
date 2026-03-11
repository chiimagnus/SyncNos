# Plan P5 - webclipper-ui-design-system-refactor

**Goal:** 继续统一按钮相关样式：将 menu popover 的“面板容器样式”（rounded/border/bg/padding/min-width 等）收敛为 shared helper，避免在多处重复内联。

**Non-goals:**
- 不改动 i18n 文案。
- 不改变菜单的定位逻辑与行为（仅收敛 className）。

**Acceptance:**
- `DetailHeaderActionBar` 与 `ConversationListPane` 的 menu panel 不再内联重复 className。
- 通过 `npm --prefix webclipper run compile/test/build`。

---

## P5-T1 统一 menu popover 面板容器样式（shared helper）

**Files:**
- Modify: `webclipper/src/ui/shared/button-styles.ts`
- Modify: `webclipper/src/ui/conversations/DetailHeaderActionBar.tsx`
- Modify: `webclipper/src/ui/conversations/ConversationListPane.tsx`
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: shared helper**
- 在 `button-styles.ts` 新增 `menuPopoverPanelClassName(minWidth)`（或等价命名），将以下稳定部分收敛：
  - `z-30`、`rounded-[14px]`、`border`、`bg-card`、`p-1.5`、`shadow-none`
  - `min-w` 仅覆盖已出现的固定值（150/170），避免动态拼接导致 Tailwind 扫描漏掉类名。

**Step 2: 替换调用点**
- `DetailHeaderActionBar`、`ConversationListPane` 的 `role="menu"` panel 容器使用 helper。

**Step 3: 验证（快速）**
- Run: `npm --prefix webclipper run compile`

**Step 4: 原子提交**
- Run: `git add webclipper/src/ui/shared/button-styles.ts webclipper/src/ui/conversations/DetailHeaderActionBar.tsx webclipper/src/ui/conversations/ConversationListPane.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml .github/features/webclipper-ui-design-system-refactor/plan-p5.md`
- Run: `git commit -m "style: task25 - 统一 menu popover panel 样式"`

---

## P5-T2 Phase 验证（compile/test/build）

**Files:**
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: Phase 验证**
- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
- Run: `npm --prefix webclipper run build`

**Step 2: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "chore: task26 - P5 验证通过（compile/test/build）"`

---

## Phase Audit

- Audit file: `audit-p5.md`
- Flow:
  1. 记录发现
  2. 修复
  3. 复跑验证命令

