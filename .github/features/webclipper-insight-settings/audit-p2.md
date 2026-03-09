# Audit P2 - webclipper-insight-settings

## Scope
- P2-T1 把 Insight 接入 Settings 导航与 section 路由
- P2-T2 实现 Insight section 的懒加载状态管理
- P2-T3 渲染 Insight 文本骨架与空态/错误态

## Audit Focus
- 新 section 是否稳定出现在 Features 组且顺序正确
- 统计读取是否只在点开 Insight 后触发一次
- loading / error / empty / populated 四种状态是否都可达且文案明确
- 新状态是否意外影响 Notion / Obsidian / Backup / Inpage 既有流程

## Findings
- 待审计时填写

## Fixes
- 待审计时填写

## Re-run Commands
- `npm --prefix webclipper run test -- settings-sections`
- `npm --prefix webclipper run compile`
