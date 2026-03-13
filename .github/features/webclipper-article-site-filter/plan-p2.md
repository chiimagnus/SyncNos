# Plan P2 - webclipper-article-site-filter

**Goal:** 让 Settings → Insight 的“文章域名分布”与会话列表的 site filter 使用同一套“可注册域名”归并口径，避免统计与筛选口径漂移。

**Non-goals:**
- 不新增 schema / 不新增数据模型字段。
- 不引入 Public Suffix List 依赖（继续沿用 P1 的“够用优先”启发式规则）。
- 未被明确要求时，不修改 i18n locale 表（优先复用现有文案 key）。

**Approach:** 复用 P1 引入的 `webclipper/src/ui/shared/domain.ts`，把 `insight-stats.ts` 中对 article URL 的 `hostname` 解析改为“可注册域名”解析；保持 Unknown/Other 的聚合与展示不变。更新对应 vitest（`insight-stats.test.ts`）覆盖归并后的统计口径。

**Acceptance:**
- Insight 的 `articleDomainDistribution` 使用与列表一致的归并规则（如 `www.`/`m.` 前缀归并、`github.io` 等白名单后缀按 eTLD+1 处理）。
- `npm --prefix webclipper run compile` 与 `npm --prefix webclipper run test` 通过。

---

## P2-T1 Insight stats：article domain 分布改用 registrable domain util

**Files:**
- Modify: `webclipper/src/ui/settings/sections/insight-stats.ts`
- Modify (if needed): `webclipper/src/ui/shared/domain.ts`

**Step 1: 实现功能**
- 在 `insight-stats.ts` 替换原先的 `parseHostname(...)` 口径：
  - 对每条 article conversation，读取 `conversation.url`。
  - 使用 `parseRegistrableDomainFromUrl(...)`（或同等 API）得到 domain；空值归入 `INSIGHT_UNKNOWN_DOMAIN_LABEL`。
- 保持其它逻辑不变：
  - Unknown/Other 聚合规则不变。
  - limit（如 `INSIGHT_ARTICLE_DOMAIN_LIMIT`）不变。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`
- Expected: TypeScript 无错误。

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/settings/sections/insight-stats.ts`
- Run: `git commit -m "feat: task5 - Insight 域名分布统一为可注册域名口径"`

---

## P2-T2 更新 insight-stats.test：覆盖 www/m 归并与多级后缀白名单

**Files:**
- Modify: `webclipper/tests/storage/insight-stats.test.ts`

**Step 1: 实现功能**
- 增补用例或调整预期，使其覆盖至少以下归并行为：
  - `https://www.sspai.com/...` 与 `https://sspai.com/...` 计入同一 domain
  - `https://m.dedao.cn/...` 归并为 `dedao.cn`
  - `https://foo.github.io/...` 归并为 `foo.github.io`
  - url 为空/不可解析时计入 `Unknown`（复用 `INSIGHT_UNKNOWN_DOMAIN_LABEL` 的现有断言方式）

**Step 2: 验证**
- Run: `npm --prefix webclipper run test`
- Expected: 全部用例通过。

**Step 3: 原子提交**
- Run: `git add webclipper/tests/storage/insight-stats.test.ts`
- Run: `git commit -m "test: task6 - 更新 Insight 域名分布口径相关用例"`

---

## Phase Audit

- Audit file: `audit-p2.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
