# Audit P1 - webclipper-insight-settings

## Scope
- P1-T1 搭建 Insight 聚合接口骨架
- P1-T2 实现本地 IndexedDB 聚合与分组规则
- P1-T3 为 Insight 聚合补单元测试

## Audit Focus
- `getInsightStats()` 是否严格只做本地 IndexedDB 读取
- chat / article 聚合是否与 fixture 数据一致
- invalid URL、空数据、top N + other 折叠是否存在边界错误
- 是否引入了不必要的 schema、消息协议或网络依赖

## Findings
- 已发现并修复：`totalClips` 原先直接取全部 conversation 行数，若未来出现非 `chat` / `article` 的 `sourceType`，会导致总数与分类计数不一致。现已改为仅统计已识别类型，并补充回归测试覆盖该边界。

## Fixes
- `getInsightStats()` 现在以 `chatCount + articleCount` 计算 `totalClips`，避免未知类型污染总览数字。
- 新增测试验证未知 `sourceType` 不会破坏总数与分类卡片的一致性。

## Re-run Commands
- `npm --prefix webclipper run test -- insight-stats`
- `npm --prefix webclipper run compile`
