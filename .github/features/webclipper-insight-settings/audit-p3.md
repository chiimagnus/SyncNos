# Audit P3 - webclipper-insight-settings

## Scope
- P3-T1 引入 Recharts 并实现来源分布图
- P3-T2 完成布局打磨与全链路验证

## Audit Focus
- Recharts 集成后是否影响 compile / build 产物
- 来源分布图是否只消费本地统计结果，没有把业务聚合搬回 UI
- 宽屏/窄屏布局、空态兜底和图表容器尺寸是否稳定
- 完整验证命令是否都通过，且 SettingsScene 其它 section 无回归

## Findings
- 审计未发现 P3 代码层面的显著问题。图表只消费本地统计结果，空态/错误态与响应式布局都按预期工作。
- `npm --prefix webclipper run test` 仍会命中仓库现有的 `tests/smoke/popup-shell-header-actions.test.ts` 失败；该失败落在未改动的 PopupShell 头部动作逻辑，不是本轮 Insight 改动引入。

## Fixes
- 本轮未追加 P3 代码修复；保留对仓库既有 popup smoke 失败的说明，避免误判为 Insight 回归。

## Re-run Commands
- `npm --prefix webclipper run compile`
- `npm --prefix webclipper run test`
- `npm --prefix webclipper run build`
