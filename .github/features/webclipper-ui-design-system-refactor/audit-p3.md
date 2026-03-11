# Audit P3 - webclipper-ui-design-system-refactor

审计时间：2026-03-11

## Scope

- `plan-p3.md` 的 P3-T1 / P3-T2 / P3-T3 / P3-T4 / P3-T5 / P3-T6 / P3-T7
- 关注点：Conversations 全链路 tokens 迁移、语义状态色统一、硬编码颜色清理、legacy tokens 移除、grep 守门可执行性与误报控制。

## Findings（按严重性排序）

### P0

- `ConversationSyncFeedbackNotice` 的 tone class 在实现里使用了模板字符串拼 class（非字面量），有 Tailwind 扫描不到导致生产构建样式丢失的风险。

### P1

- P3 的两条 grep 守门（legacy var / hex）需确保不会被 tokens.css/inpage fallback 的 `#...` 误报；并且能真实覆盖 UI 代码硬编码色值问题。
- focus ring 规范（`outline-2 + offset-2 + --focus-ring`）在 Conversations 相关交互态里基本一致（含 Markdown link 的 `a:focus-visible`）。

### P2

- 宽屏 detail 画布存在 “card 叠 card” 的层级塌缩风险：`ConversationsScene` 的 `<main>` 与 `ConversationDetailPane` 同时使用 `bg-card`。

## Fixes Applied

- 将 `ConversationSyncFeedbackNotice` tone class 改为 **完全字面量** map（避免 Tailwind 扫描丢 class）。
- 宽屏把 `ConversationsScene` 的 `<main>` 背景改回 `bg-primary`，保留 `ConversationDetailPane` 作为 `bg-card`（Surface 层级更清晰）。
- 将 `tokens.css` 与 inpage CSS 的 `#...` 写法收敛为 `rgb()/rgba()`，保证 P3-T7 的 hex 守门不误报（规则仍建议后续升级覆盖 `rgb()/rgba()` 形态）。

## Verification

- `npm --prefix webclipper run compile`
- `npm --prefix webclipper run test`
- `npm --prefix webclipper run build`
- `rg` 守门（legacy var / hex）均为 0

## Optional Improvements

- 若希望 `ConversationSyncFeedbackNotice` 的状态辨识度更强，可将 phaseLabel / 计数等局部提升为语义色（仍使用 tokens 派生，避免大面积语义色正文）。
