# Audit P1 - webclipper-ui-design-system-refactor

审计时间：2026-03-11

## Scope

- `plan-p1.md` 的 P1-T1 / P1-T2 / P1-T3 / P1-T4 / P1-T5 / P1-T6 / P1-T7
- 关注点：tokens 完整性与命名一致性、`prefers-color-scheme` 暗色模式、focus ring 规范、迁移期 alias 边界、inpage 样式兼容性。

## Findings（按严重性排序）

### P0

- 无。

### P1

- `webclipper/src/ui/styles/tokens.css`：迁移期仍保留旧 legacy 色值定义（`--text/#d95926` 等）会造成“同名变量两套定义”的困惑；应只保留“新 tokens + legacy alias（引用新 tokens/派生）”作为单一真源。
  - 状态：已修复（移除旧 legacy 色值定义，仅保留 alias）。
- `webclipper/src/ui/styles/inpage-tip.css`：`.webclipper-inpage-bubble__surface` 使用 `all: initial;`，自定义属性可能被 reset，需确保 bubble 关键变量在 surface 自身也有定义，避免 `var(--bubble-*)` 失效。
  - 状态：已修复（在 surface 内补齐 `--bubble-*` 变量定义）。

### P2

- 多处使用 `color-mix(...)` 做派生（legacy alias、背景微渐变、inpage bubble tint）。若未来需要兼容较老内核，可为关键派生补 `@supports` 降级 fallback（本轮不强制）。

## Fixes Applied

- `webclipper/src/ui/styles/tokens.css`：移除旧 legacy 色值，仅保留新 tokens + legacy alias（引用新 tokens/派生）。
- `webclipper/src/ui/styles/inpage-tip.css`：在 `.webclipper-inpage-bubble__surface` 内补齐 `--bubble-*` 变量定义，避免 `all: initial` 场景下变量丢失。

## Verification

- `npm --prefix webclipper run compile`

## Optional Improvements

- 为 `color-mix(...)` 派生增加 `@supports` fallback（按需要）。
