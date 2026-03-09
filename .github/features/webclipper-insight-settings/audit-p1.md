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
- 待审计时填写

## Fixes
- 待审计时填写

## Re-run Commands
- `npm --prefix webclipper run test -- insight-stats`
- `npm --prefix webclipper run compile`
