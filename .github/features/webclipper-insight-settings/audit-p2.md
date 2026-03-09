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
- 已发现并修复：Insight 首次加载过程中若用户快速切走，再切回该 section，会因为取消分支没有复位 `insightLoading` 而永久停留在 loading 状态。

## Fixes
- 调整 Insight 懒加载 effect 的收尾逻辑：无论请求是否被取消，都先复位 `insightLoading`；只有未取消时才写入 `hasLoadedInsight` 与结果，避免切换 section 后卡死。

## Re-run Commands
- `npm --prefix webclipper run test -- settings-sections`
- `npm --prefix webclipper run compile`
