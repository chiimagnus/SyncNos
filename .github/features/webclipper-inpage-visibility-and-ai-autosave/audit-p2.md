# Audit P2 - webclipper-inpage-visibility-and-ai-autosave

审计时间：2026-03-11

## Scope

- `plan-p2.md` 的 P2-T1 / P2-T2
- 关注点：设置页布局与信息架构、context menu 权限与注册/刷新逻辑、storage 写入正确性、i18n 覆盖、验证链路。

## Findings（按严重性排序）

### P0

- 无。

### P1

- 无。

### P2

- `contextMenus.removeAll/create/update` 目前采用“尽力而为 + 忽略 lastError”的策略；如果未来需要更强可观测性，可补统一的 lastError 处理与日志（`webclipper/src/platform/context-menus/clipper-context-menu.ts`）。
- 右键菜单目前仅在页面右键出现（`contexts: ['page']`）；若希望“右键扩展图标也能出现”，需要补 `contexts: ['action']`（`webclipper/src/platform/context-menus/clipper-context-menu.ts`）。

## Fixes Applied

- 修正 `todo.toml` 中重复的 `P2-T1/P2-T2` task 记录，保证 `todo.toml` 是唯一且一致的状态真源。

## Verification

- `npm --prefix webclipper run compile`
- `npm --prefix webclipper run test`
- `npm --prefix webclipper run build`

## Optional Improvements

- 抽一层更严格的 menus/contextMenus API 适配与 lastError 处理，避免静默失败时难排查。
- 如需“设置即时生效”，可在 content 侧监听 `storage.onChanged` 并在运行时 start/stop controller 或切换 auto-save gate。
