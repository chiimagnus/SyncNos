# Audit P2 - webclipper-article-site-filter

> 由 `executing-plans` 在 P2 完成后进入审计闭环：先记录发现，再修复，再跑 `npm --prefix webclipper run compile` 与 `npm --prefix webclipper run test`。

## Findings

- `webclipper/src/ui/settings/sections/insight-stats.ts`：`articleDomainDistribution` 已改为复用 `webclipper/src/ui/shared/domain.ts` 的 `parseRegistrableDomainFromUrl(...)`（解析失败仍归入 `INSIGHT_UNKNOWN_DOMAIN_LABEL`），与列表 site filter 同口径。
- `webclipper/tests/storage/insight-stats.test.ts`：
  - 覆盖 `www.`/`m.` 前缀归并与 `github.io`。
  - long-tail 的 `Other` bucket 用“不同可注册域名”构造，避免因归并导致的用例失真。
- 已知边界：domain 归并为启发式白名单（非 PSL 全量），少数冷门后缀可能仍不准，但符合约束“够用优先”。

## Fixes

- 无。

## Verification

- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`

## Findings

- `webclipper/src/ui/settings/sections/insight-stats.ts`
  - article domain 分布已从 `URL.hostname` 口径切换为复用 `webclipper/src/ui/shared/domain.ts` 的“可注册域名”归并口径（解析失败仍归入 `INSIGHT_UNKNOWN_DOMAIN_LABEL`）。
- `webclipper/tests/storage/insight-stats.test.ts`
  - 新增用例覆盖 `www.`/`m.` 前缀归并与 `github.io` 白名单后缀（`foo.github.io` 归并为自身）。
  - long-tail 的 `Other` bucket 用例仍然有效：通过构造“不同可注册域名”的 URL，确保尾部被折叠到 `INSIGHT_OTHER_LABEL`。

## Notes / Risks

- 归并规则为“够用优先”的启发式实现（非 Public Suffix List 全量）；因此极少数冷门后缀可能会出现口径偏差，但与本 feature 的约束一致。

## Verification

- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
