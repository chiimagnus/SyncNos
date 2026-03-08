# Audit P2 - webclipper-detail-open-destinations

## Scope

- 审计 Obsidian destination capability 是否被正确收敛在 adapter / protocol 层
- 审计 detail header 单按钮 / 下拉菜单状态机是否稳定
- 审计 popup/app 在双目标场景下的行为一致性、App 启动兜底与文档同步

## Entry Criteria

- `todo.toml` 中 `P2-T1` 到 `P2-T4` 全部完成
- `plan-p2.md` 中的 compile、test、build 命令已经至少执行一轮

## Checklist

- Obsidian 打开目标是否通过单一 resolver 输出，而不是在 UI 中直接探测配置
- Obsidian 文件打开是否始终通过 Local REST API 完成，而不是退回带 file 参数的官方 URI
- 当 Local REST API 因 App 未启动不可达时，是否通过官方 `obsidian://open` 正确拉起 App，并在启动后重试 REST API
- 仅 Notion、仅 Obsidian、双目标三种状态是否都有测试覆盖
- 菜单触发器是否只出现在 detail navigation title 的右上角
- 没有目标时是否完全隐藏入口，而不是显示空菜单或 disabled 占位
- popup 与 app 是否对同一会话给出同样的目标集合和渲染模式
- 文档是否明确当前 feature 只覆盖 Notion / Obsidian destination action，不包含 AI handoff
- 本 phase 是否仍未触碰国际化字段

## Findings

- High（已修复）：`DetailHeaderActionBar.tsx` 最初在 `actions.length === 0` 时提前 `return null`，但有动作时才调用 hooks，存在从 `0 -> 1/2 actions` 重渲染时触发 hook 顺序错误的风险。修复方式：把 hooks 提前到稳定位置，再在 hooks 之后处理空动作分支，并补充菜单组件测试覆盖。
- Medium（已修复）：`detail-header-obsidian-target.ts` 的 app-launch + retry 最初只在拉起 App 后重解析一次真实 note path；如果 Obsidian 冷启动较慢，就会反复对 `desiredFilePath` 做 `POST /open/{filename}`，无法在后续重试里发现 legacy / candidate 路径。修复方式：在 launch-before-retry 窗口内每次重试都重新走 resolver，直到拿到真正可打开的 note path 或到达重试上限。
- Medium（已修复）：`DetailHeaderActionBar.tsx` 曾把 `action.onTrigger()` 异常直接吞掉，`Open in Notion` 打不开时会静默失败。修复方式：动作条统一把未处理异常转换为显式提示，同时保留 Obsidian action 内部的 `reportError` 兜底。
- 经本地复核，其余 checklist 项未发现新增问题：Obsidian 文件打开仍然只走 Local REST API，`obsidian://open` 仅用于拉起 App；菜单没有泄漏到 detail header 之外；popup / app 继续共用同一套目标集合；本 phase 未触碰国际化字段。

## Fix Verification

- `npm --prefix Extensions/WebClipper run compile`
- `npm --prefix Extensions/WebClipper run test -- tests/smoke/detail-header-obsidian-target.test.ts tests/smoke/detail-header-actions.test.ts tests/smoke/detail-header-action-menu.test.ts tests/smoke/popup-shell-header-actions.test.ts tests/smoke/app-detail-header-actions.test.ts tests/smoke/app-shell-narrow-header-actions.test.ts`
- `npm --prefix Extensions/WebClipper run build`
- 结果：全部通过，P2 审计闭环完成。
