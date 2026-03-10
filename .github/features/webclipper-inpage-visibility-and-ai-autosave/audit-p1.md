# Audit P1 - webclipper-inpage-visibility-and-ai-autosave

审计时间：2026-03-11

## Scope

- `plan-p1.md` 的 P1-T1 / P1-T2 / P1-T3
- 关注点：`inpage_display_mode` 三态与旧键兼容、`ai_chat_auto_save_enabled` gate 与 chat-only 限制、刷新生效约束、设置页可用性、i18n 覆盖、测试/构建链路。

## Findings（按严重性排序）

### P0

- 无。

### P1

- 无。

### P2

- `AUTO_SAVE_COLLECTOR_IDS` 是显式白名单（`webclipper/src/bootstrap/content-controller.ts`），后续新增 collector 时需要记得同步更新，否则会出现“自动保存开关开启但新站点不自动保存”的预期差异。
- 当前设置变更仍是“刷新后生效”的模型（`webclipper/src/bootstrap/content.ts` 仅启动时读取 storage），文案与 `webclipper/AGENTS.md` 已说明，但用户仍可能期待即时生效。

## Fixes Applied

- 无需额外修复。

## Verification

- `npm --prefix webclipper run compile`
- `npm --prefix webclipper run test`
- `npm --prefix webclipper run build`

## Optional Improvements

- 若后续要做“即时生效”，可在 content script 内监听 `chrome.storage.onChanged`，对 `inpage_display_mode` 做 start/stop controller，对 `ai_chat_auto_save_enabled` 做运行时 gate 切换（保持不依赖动态 content script 注册）。
