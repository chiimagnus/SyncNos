# Plan P1 - webclipper-article-site-filter

**Goal:** 在会话列表（`ConversationListPane`）中，当筛选到 Web Articles（`Source = web`）时支持按站点域名（site/registrable domain）做二级过滤，交互形态与现有 source filter 对齐（底部工具条相邻两个下拉）。

**Non-goals:**
- 不新增/不修改 IndexedDB schema 与数据模型字段（仅基于现有 `conversation.url` 解析）。
- 不引入完整 Public Suffix List 依赖（采用“够用优先”的启发式归并）。
- 不把 site filter 扩展到 AI chats。
- 未被明确要求时，不修改 i18n locale 表（优先复用现有 `t(...)` key）。

**Approach:** 新增一个可复用的 domain 解析工具（从 url 得到“可注册域名/Unknown”），并在 `ConversationListPane` 中以 `useMemo` 基于“已按 source 筛过的 items”计算站点分布与 options（按 count 降序）。当 `Source = web` 时在底部工具条渲染第二个 `SelectMenu`，并在列表过滤管线中追加 site filter；切换 source（尤其是切到 `web`）时 site filter 强制回到 `All`（不持久化）。

**Acceptance:**
- `Source = web` 时显示 `Site` 二级下拉；站点项按 count desc，包含 `All` 与 `Unknown/未知`。
- 切换 `Source`（从/到 web）都会把 `Site` 重置为 `All`，且不写入任何新 storage key。
- `npm --prefix webclipper run compile` 与 `npm --prefix webclipper run test` 通过。

---

## P1-T1 新增可复用 domain util（可注册域名归并）+ 单测

**Files:**
- Add: `webclipper/src/ui/shared/domain.ts`
- Add: `webclipper/tests/unit/domain.test.ts`

**Step 1: 实现功能**
- 提供最小且可复用的 API（示例命名，按现有代码风格微调即可）：
  - `parseHostnameFromUrl(url: unknown): string | ""`
  - `toRegistrableDomain(hostname: string): string | ""`（“够用优先”的 eTLD+1）
  - `parseRegistrableDomainFromUrl(url: unknown): string`（返回 domain 或 `""`）
- 规则（够用优先）：
  - `new URL(url).hostname`，lowercase。
  - 去掉常见前缀：`www.`、`m.`、`mobile.`、`amp.`（如多级前缀可循环剥离）。
  - 特殊多级后缀白名单：至少覆盖 `com.cn`、`net.cn`、`org.cn`、`gov.cn`、`edu.cn`、`co.uk`、`org.uk`、`ac.uk`、`gov.uk`、`github.io`（以及其它你认为高价值的 2-3 个常见 suffix）。
  - `localhost`、IPv4、IPv6：不做 eTLD+1 归并，直接返回 hostname（作为一个“站点 key”依然可筛）。
  - 无法解析/空值：返回空串（上层映射为 `Unknown`）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run test`
- Expected: `domain.test.ts` 通过，至少覆盖：
  - `https://www.sspai.com/post/1` -> `sspai.com`
  - `https://m.dedao.cn/xxx` -> `dedao.cn`
  - `https://foo.github.io/bar` -> `foo.github.io`
  - `""` / 非法 URL -> `""`

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/shared/domain.ts webclipper/tests/unit/domain.test.ts`
- Run: `git commit -m "feat: task1 - 引入可注册域名解析工具与单测"`

---

## P1-T2 ConversationListPane：构建 site options（count 降序，含 Unknown）

**Files:**
- Modify: `webclipper/src/ui/conversations/ConversationListPane.tsx`
- Modify (if needed): `webclipper/src/ui/shared/domain.ts`

**Step 1: 实现功能**
- 在 `ConversationListPane` 中增加 `siteFilterKey`（仅内存态，不持久化），并定义 key 方案避免与真实域名冲突：
  - `all`（All）
  - `unknown`（Unknown）
  - `domain:<registrableDomain>`（例如 `domain:sspai.com`）
- 构建站点分布与 options：
  - 基于“已按 source 过滤后的 items”（也就是 `filterKey` 生效后的列表）统计 domain count。
  - 对每条 item：仅当它是 article（`sourceType === "article"`）时才参与统计（防御式；避免未来数据异常）。
  - 解析失败归入 `unknown`。
  - options 排序：count desc；同 count 可用 domain label asc 作为稳定兜底排序。
- 复用现有 i18n key（不改 locale 表）：
  - `All` 使用 `t('allFilter')`
  - `Unknown/未知` 使用 `t('insightUnknownLabel')`
  - `ariaLabel` 可复用 `t('insightArticleDomainsTitle')`（用于表达“域名/站点过滤”）

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`
- Expected: TypeScript 无错误；构建 options 的 `useMemo` 依赖正确（不出现 stale）。

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/conversations/ConversationListPane.tsx`
- Run: `git commit -m "feat: task2 - 为 web articles 构建 site filter options"`

---

## P1-T3 ConversationListPane：仅 web 显示 Site 下拉 + 应用二级过滤

**Files:**
- Modify: `webclipper/src/ui/conversations/ConversationListPane.tsx`

**Step 1: 实现功能**
- UI（方案 A）：
  - 在底部工具条 `Source` 的 `SelectMenu` 右侧增加第二个 `SelectMenu`（Site）。
  - 仅当 `filterKey === "web"` 时渲染该下拉；否则不渲染。
  - 与现有 `Source` 行为对齐：当 `hasSelection` 时隐藏两个下拉（避免筛选改变导致选择范围混乱）。
- 过滤管线：
  - 先应用 source filter（现有逻辑）。
  - 若 `filterKey === "web"`，再应用 site filter（`siteFilterKey !== "all"` 时生效）。
  - `todayCount / visibleIds / selectedInView` 等派生值应基于最终 `filteredItems`（确保统计与批量动作一致）。

**Step 2: 验证**
- Run: `npm --prefix webclipper run compile`
- Expected: TypeScript 无错误；UI 条件渲染无死分支。

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/conversations/ConversationListPane.tsx`
- Run: `git commit -m "feat: task3 - 会话列表支持按站点二级过滤（仅 web）"`

---

## P1-T4 补齐交互细节：切换 web 重置 All，切换筛选清空选择 + 验证

**Files:**
- Modify: `webclipper/src/ui/conversations/ConversationListPane.tsx`

**Step 1: 实现功能**
- 重置策略（不持久化）：
  - 每次调用 `onSetFilterKey(next)` 时：无条件 `setSiteFilterKey('all')`。
  - 当 `filterKey !== 'web'` 时：确保 `siteFilterKey` 保持 `'all'`（防御式，避免隐藏状态残留导致下次进入 web 时错误）。
- 与现有行为对齐：
  - 切换 `Source` 或 `Site` 时：调用 `clearSelected()`，并关闭 Export/Sync 等菜单（与现有 `onSetFilterKey` 一致）。
- 最小手工验收（开发模式）：
  1) 打开扩展 App 或 Popup，会话列表选择 `Source=web`，看到 `Site` 下拉出现。
  2) 选择某站点后列表收敛，再切换 `Source` 到任意 chat 平台，确认 `Site` 消失；再切回 `web`，确认 `Site` 回到 `All`。

**Step 2: 验证**
- Run: `npm --prefix webclipper run test`
- Expected: 单测全部通过。
- Run: `npm --prefix webclipper run compile`
- Expected: TypeScript 无错误。

**Step 3: 原子提交**
- Run: `git add webclipper/src/ui/conversations/ConversationListPane.tsx`
- Run: `git commit -m "feat: task4 - 补齐 site filter 重置与选择清理行为"`

---

## Phase Audit

- Audit file: `audit-p1.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
