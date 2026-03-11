# Plan P9 - webclipper-ui-design-system-refactor

**Goal:** 将所有“删除”按钮统一为同一种 destructive-surface 交互（默认凸起、hover/active 下沉到 sunken）。

**Non-goals:**
- 不改动 i18n 文案。
- 不改动删除逻辑（仅改样式引用）。

**Acceptance:**
- Conversations 列表：工具栏删除按钮与确认弹窗删除按钮样式一致（danger surface）。
- Settings：删除平台按钮样式一致（danger surface）。
- 通过 `npm --prefix webclipper run compile/test/build`。

---

## P9-T1 统一所有删除按钮为凹陷反馈（danger surface）

**Files:**
- Modify: `webclipper/src/ui/conversations/ConversationListPane.tsx`
- Modify: `webclipper/src/ui/settings/ui.ts`
- Modify: `webclipper/src/ui/settings/sections/ChatWithAiSection.tsx`
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`
- Add: `.github/features/webclipper-ui-design-system-refactor/plan-p9.md`

**Step 1: Conversations**
- `ConversationListPane` 删除确认弹窗的删除按钮也使用 `buttonDangerTintClassName()`（与工具栏一致）。

**Step 2: Settings**
- 在 `webclipper/src/ui/settings/ui.ts` 新增 `dangerButtonClassName`（= `buttonDangerTintClassName()`）。
- `ChatWithAiSection` 删除平台按钮改用 `dangerButtonClassName`。

**Step 3: 验证（快速）**
- Run: `npm --prefix webclipper run compile`

**Step 4: 原子提交**
- Run: `git add webclipper/src/ui/conversations/ConversationListPane.tsx webclipper/src/ui/settings/ui.ts webclipper/src/ui/settings/sections/ChatWithAiSection.tsx .github/features/webclipper-ui-design-system-refactor/todo.toml .github/features/webclipper-ui-design-system-refactor/plan-p9.md`
- Run: `git commit -m \"style: task33 - 统一所有删除按钮凹陷反馈\"`

---

## P9-T2 Phase 验证（compile/test/build）

**Files:**
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: Phase 验证**
- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
- Run: `npm --prefix webclipper run build`

**Step 2: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m \"chore: task34 - P9 验证通过（compile/test/build）\"`

---

## Phase Audit

- Audit file: `audit-p9.md`

