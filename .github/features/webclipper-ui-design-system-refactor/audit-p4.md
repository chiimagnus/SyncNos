# Audit P4 - webclipper-ui-design-system-refactor

范围：`plan-p4.md`（按钮样式盘点 + shared helpers 收敛）。

## 验证记录

- `npm --prefix webclipper run compile` ✅
- `npm --prefix webclipper run test` ✅
- `npm --prefix webclipper run build` ✅

## 变更概览（按目标）

- 按钮样式清单：`.github/features/webclipper-ui-design-system-refactor/buttons-inventory.md`
- 新增 shared helpers：`webclipper/src/ui/shared/button-styles.ts`
  - `buttonMenuItemClassName`
  - `buttonIconCircleCardClassName`
  - `buttonIconCircleGhostClassName`
  - `buttonMiniIconClassName`
- 替换调用点：
  - `webclipper/src/ui/conversations/DetailHeaderActionBar.tsx`
  - `webclipper/src/ui/conversations/ConversationListPane.tsx`
  - `webclipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`
  - `webclipper/src/ui/app/AppShell.tsx`
  - `webclipper/src/ui/settings/SettingsScene.tsx`

## Findings

- [x] `webclipper/src/ui/settings/sections/ChatWithAiSection.tsx`：checkbox 内联样式缺少 focus ring / disabled 规范（复用 `webclipper/src/ui/settings/ui.ts` 的 `checkboxClassName`）。
- [x] `webclipper/src/ui/shared/button-styles.ts`：`buttonMiniIconClassName(active, disabled)` 以参数驱动“视觉禁用”，易与 `<button disabled>` 语义漂移（改为 `disabled:` 变体驱动，调用点不再传参）。
- [ ] `webclipper/src/ui/shared/nav-styles.ts`：`navMiniIconButtonClassName()` 当前无调用点（可选：删除或在合适场景复用）。
- [ ] menu popover panel 容器 className 在多处重复（可选：抽 helper；但差异可能是有意的）。
- [x] `webclipper/src/ui/conversations/ConversationListPane.tsx`：`<div role="button" tabIndex={0}>` 未补齐 Enter/Space 键盘触发（补齐键盘触发以匹配 role 语义）。

## Fix Log

- Fix: ChatWithAi platforms checkbox 改用 `checkboxClassName` → `compile/test/build` ✅
- Fix: `buttonMiniIconClassName` 改为 `disabled:` 变体驱动 → `compile/test/build` ✅
- Fix: Conversation list row 补齐 Enter/Space 触发 → `compile/test/build` ✅
