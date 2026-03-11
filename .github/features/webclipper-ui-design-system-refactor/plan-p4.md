# Plan P4 - webclipper-ui-design-system-refactor

**Goal:** 先盘点 WebClipper 现有所有“按钮风格来源”，再把最常见的内联按钮样式收敛到 shared helpers，减少漂移与重复。

**Non-goals:**
- 不改动按钮文案与 i18n 字段（只做样式收敛与复用）。
- 不改变按钮的业务逻辑/行为（点击、disabled 条件等保持不变）。

**Approach:** 以 `webclipper/src/ui/shared/button-styles.ts` / `nav-styles.ts` 为真源，先输出清单，再把菜单项/圆形 icon 按钮/mini icon 按钮等重复内联样式抽成 helper 并替换调用点。

**Acceptance:**
- “常规按钮 / 菜单项按钮 / 圆形 icon 按钮 / mini icon 按钮”均有明确的 shared helper。
- `DetailHeaderActionBar` 与 `ConversationListPane` 的 menu item 不再重复内联同一串 className。
- `ConversationSyncFeedbackNotice` 与 `AppShell` 的 close/dismiss icon button 不再重复内联同一串 className。
- 代码通过 `npm --prefix webclipper run compile`（phase 末尾再做 test/build）。

---

## P4-T1 按钮样式盘点（清单与漂移点）

**Files:**
- Add: `.github/features/webclipper-ui-design-system-refactor/buttons-inventory.md`
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: 盘点**
- 记录 shared helpers（单一真源）：
  - `webclipper/src/ui/shared/button-styles.ts`
  - `webclipper/src/ui/shared/nav-styles.ts`
  - `webclipper/src/ui/settings/ui.ts`
- 记录组件内仍存在的“重复内联按钮样式”位置（至少包含：menu items / close & dismiss / mini icon）。

**Step 2: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/buttons-inventory.md .github/features/webclipper-ui-design-system-refactor/todo.toml .github/features/webclipper-ui-design-system-refactor/plan-p4.md`
- Run: `git commit -m "docs: task22 - 盘点 WebClipper 按钮样式来源"`

---

## P4-T2 按钮样式统一收敛（shared helpers）

**Files:**
- Modify: `webclipper/src/ui/shared/button-styles.ts`
- Modify: `webclipper/src/ui/conversations/DetailHeaderActionBar.tsx`
- Modify: `webclipper/src/ui/conversations/ConversationListPane.tsx`
- Modify: `webclipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`
- Modify: `webclipper/src/ui/app/AppShell.tsx`
- Modify: `webclipper/src/ui/settings/SettingsScene.tsx`
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: shared helpers**
- 在 `button-styles.ts` 中新增：
  - menu item（popover/menu 的 full-width menuitem button）
  - icon circle button（ghost / card 两种常见 close/dismiss）
  - mini icon button（ConversationListPane 行内小按钮）

**Step 2: 替换调用点**
- `DetailHeaderActionBar`：菜单项改用 menu item helper。
- `ConversationListPane`：export/sync 菜单项改用 menu item helper；mini icon 改用 mini icon helper。
- `ConversationSyncFeedbackNotice`：dismiss/close 圆形按钮改用 icon circle helper。
- `AppShell`：settings sheet 关闭按钮改用 icon circle helper。
- `SettingsScene`：窄屏 detail header 的返回按钮改用 `buttonTintClassName()`（去内联）。

**Step 3: 验证**
- Run: `npm --prefix webclipper run compile`

**Step 4: 原子提交**
- Run: `git add webclipper/src/ui/shared/button-styles.ts webclipper/src/ui/conversations/DetailHeaderActionBar.tsx webclipper/src/ui/conversations/ConversationListPane.tsx webclipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx webclipper/src/ui/app/AppShell.tsx webclipper/src/ui/settings/SettingsScene.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "style: task23 - 收敛按钮样式到 shared helpers"`

---

## P4-T3 Phase 验证（compile/test/build）

**Files:**
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: Phase 验证**
- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
- Run: `npm --prefix webclipper run build`

**Step 2: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "chore: task24 - P4 验证通过（compile/test/build）"`

---

## Phase Audit

- Audit file: `audit-p4.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令

