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

- 待填写

## Fix Verification

- 待填写
