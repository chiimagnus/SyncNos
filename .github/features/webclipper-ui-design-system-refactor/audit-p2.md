# Audit P2 - webclipper-ui-design-system-refactor

审计时间：2026-03-11

## Scope

- `plan-p2.md` 的 P2-T1 / P2-T2 / P2-T3 / P2-T4 / P2-T5 / P2-T6 / P2-T7
- 关注点：App/Popup/Settings 的 surface 四级层级一致性、表单控件对比度、hover/active/disabled/focus 状态、暗色模式下阴影/边框策略。

## Findings（按严重性排序）

### P0

- `.github/features/webclipper-ui-design-system-refactor/todo.toml`：发现阶段状态不一致（`P2-T7` 已写入 commit 但状态未置为 completed），会破坏 `todo.toml` 的“唯一真源”语义。
  - 状态：已修复（`P2-T7` 置为 completed，并开始 `P3-T1`）。

### P1

- `webclipper/src/ui/settings/SettingsScene.tsx`：宽屏 detail 画布使用 `bg-card`，导致 card（同为 `bg-card`）层级塌缩，不符合 surface 四级梯度表达。
  - 状态：已修复（宽屏 detail 画布改为 `bg-primary`，cards 保持 `bg-card`）。
- `webclipper/src/ui/settings/SettingsScene.tsx`：窄屏 active section 描述文字仍强制使用 `text-secondary`，覆盖了 `accent-foreground`，违反 on-color 规则。
  - 状态：已修复（active 时描述文字使用 `accent-foreground`）。
- `webclipper/src/ui/settings/ui.ts`：表单控件缺少 hover/disabled 的统一规则，checkbox 缺少 focus ring。
  - 状态：已修复（为 input/select/checkbox 补齐 hover + disabled + focus-visible）。
- `webclipper/src/ui/app/AppShell.tsx`：设置弹窗关闭按钮缺少 focus ring，键盘焦点不可见。
  - 状态：已修复（补齐 focus-visible outline）。
- `webclipper/src/ui/settings/sections/InsightPanel.tsx`：Tooltip 使用固定阴影，暗色模式下仍依赖阴影表达层级。
  - 状态：已修复（去除阴影，改为 border + bg-card）。

### P2

- `webclipper/src/ui/settings/sections/InsightSection.tsx`：错误态未使用语义色，系统状态一致性不足。
  - 状态：已修复（错误态 title 使用 `--error`，卡片边框使用 `--error`）。
- `webclipper/src/ui/settings/sections/InpageSection.tsx`：card 内部条目使用 `bg-card`（卡中卡），层级不清晰。
  - 状态：已修复（内部条目改为 `bg-sunken`）。

## Fixes Applied

- 修正 `todo.toml` 阶段状态一致性（P2 完结，P3 开始）。
- 修复 SettingsScene 层级塌缩与 on-color 覆盖问题。
- 补齐表单控件 hover/disabled/focus 规则与 checkbox focus ring。
- 补齐 AppShell 设置弹窗关闭按钮 focus ring。
- Insight Tooltip 改为 border + bg-card；Insight 错误态引入语义色；Inpage 列表项改为 inset surface。

## Verification

- `npm --prefix webclipper run compile`
- `npm --prefix webclipper run test`
- `npm --prefix webclipper run build`

## Optional Improvements

- 为 SVG/Tooltip 的色彩派生与“微光边框”抽 `--elevation-*` tokens（按需要）。
