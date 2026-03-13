# Audit P1 - webclipper-article-site-filter

> 由 `executing-plans` 在 P1 完成后进入审计闭环：先记录发现，再修复，再跑 `npm --prefix webclipper run compile` 与 `npm --prefix webclipper run test`。

## Findings

### ✅ ConversationListPane：二级 site filter 行为基本满足需求

- 仅在 `Source = web` 时渲染 site 下拉：`webclipper/src/ui/conversations/ConversationListPane.tsx`（`siteFilterSelect` 条件渲染）。
- 切换 source 会强制把 site filter 置回 `all`，且不持久化：`onSetFilterKey()` 内 `setSiteFilterKey('all')`，site 仅为 React state。
- 切换 source/site 都会清空 selection 并关闭 Export/Sync/DeleteConfirm：`onSetFilterKey()` / `onSetSiteFilterKey()`。
- site options：按 count desc 排序；Unknown 仅在存在解析失败时追加：`siteOptions` 的 `unknownCount > 0` 分支。

### ⚠️ domain util：规则“够用优先”合理，但单测覆盖可加强

- `webclipper/src/ui/shared/domain.ts` 的核心策略符合预期：
  - `www/m/mobile/amp` 前缀循环剥离（最多 6 次）
  - 多级后缀白名单（`com.cn`/`co.uk`/`github.io` 等）按 eTLD+1 取最后 3 段
  - `localhost`/IPv4/IPv6 直接返回 hostname（作为站点 key 可筛）
  - 非法 URL 返回空串（上层映射 Unknown）
- 但 `webclipper/tests/unit/domain.test.ts` 目前未覆盖：
  - `co.uk` / `com.cn` 等白名单后缀的 eTLD+1 行为
  - `www.m.example.com` 这类多前缀链式剥离
  - IPv6 更具体的样例（例如 `http://[::1]/`）

### ℹ️ 性能/一致性（非阻塞）

- 列表过滤时对每条 conversation 会多次解析 URL（构建 options + 实际过滤各一次）；通常数据量可控，不是问题，但后续如果列表规模变大可考虑 memoization（例如按 conversationId 缓存 domain key）。

## Recommendations

1. 增补 `domain.test.ts` 用例覆盖 `co.uk` / `com.cn` / 多前缀剥离 / IPv6（建议作为后续 audit fix 或并入 P2 测试增强）。
2. 若后续要把 Insight 统计口径也切到 registrable domain（已纳入 P2），建议顺手复用同一 util，并在 `insight-stats.test.ts` 增补 `www`/`m` 场景，避免口径漂移回归。

