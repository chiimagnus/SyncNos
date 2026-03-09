# Plan P1 - webclipper-insight-settings

**Goal:** 搭建 Insight 的本地统计数据层，让设置页可以拿到稳定、可测试的聚合结果。

**Non-goals:**
- 本 phase 不接入 Settings UI
- 本 phase 不引入 Recharts
- 本 phase 不改 IndexedDB schema、消息协议或任何网络请求

**Approach:**
围绕现有 IndexedDB 事实源新增一个专用的 `insight-stats.ts` 模块，封装统计类型、空结果构造和本地聚合逻辑。实现时直接复用现有 schema 与只读事务，计算 chat/article 总量、AI 平台分布、文章域名分布、chat 总消息轮数与 Top 3 最长对话。用 fake-indexeddb 补齐聚合测试，确保后续 UI 集成时只消费稳定的结构化结果。

**Acceptance:**
- `getInsightStats()` 可返回约定好的结构化统计结果
- 聚合逻辑只读取本地 IndexedDB，不引入 schema 变更
- 空数据、无效 URL、article/chat 混合数据都能稳定返回结果
- 统计模块对应单测可独立运行

---

## P1-T1

**Task:** 搭建 Insight 聚合接口骨架

**Files:**
- New: `webclipper/src/ui/settings/sections/insight-stats.ts`

**Step 1: 实现功能**

在 `insight-stats.ts` 中定义 `InsightStats`、分布项、Top Conversation 等类型，并导出 `getInsightStats()`、空态构造函数和必要的纯辅助函数。先把约定接口稳定下来，确保后续 UI 与测试都围绕同一份结构工作。

**Step 2: 验证**

Run: `npm --prefix webclipper run compile`

Expected: TypeScript 能识别新的 Insight 类型与导出函数，仓库不出现类型错误。

**Step 3: 原子提交**

Run: `git add webclipper/src/ui/settings/sections/insight-stats.ts`

Run: `git commit -m "feat: task1 - 搭建Insight聚合接口骨架"`

---

## P1-T2

**Task:** 实现本地 IndexedDB 聚合与分组规则

**Files:**
- Modify: `webclipper/src/ui/settings/sections/insight-stats.ts`

**Step 1: 实现功能**

在 stats 模块内用只读事务同时读取 `conversations` 与 `messages`，按 `conversationId` 统计消息数，并在内存中完成聚合。规则要覆盖：`totalClips`、`chatCount`、`articleCount`、`chatSourceDistribution`、`totalMessages`、`topConversations`、`articleDomainDistribution`；网页文章通过 `new URL(url).hostname` 提取域名，无法解析时要降级到安全占位并继续统计；域名分布与平台分布都要做 top N + 其他折叠。

**Step 2: 验证**

Run: `npm --prefix webclipper run compile`

Expected: 聚合模块能通过类型检查，且未引入额外 schema 或运行时依赖。

**Step 3: 原子提交**

Run: `git add webclipper/src/ui/settings/sections/insight-stats.ts`

Run: `git commit -m "feat: task2 - 实现Insight本地聚合规则"`

---

## P1-T3

**Task:** 为 Insight 聚合补单元测试

**Files:**
- New: `webclipper/tests/storage/insight-stats.test.ts`

**Step 1: 实现功能**

使用 `fake-indexeddb` 建 fixture，分别覆盖：纯空库、chat/article 混合数据、无效 article URL、Top 3 对话排序、top N + other 折叠、chat 总消息轮数统计。测试内优先复用现有 `__closeDbForTests()` 与 seed 风格，避免创建新的测试基础设施。

**Step 2: 验证**

Run: `npm --prefix webclipper run test -- insight-stats`

Expected: 新增 Insight 聚合测试全部通过，并能稳定断言关键统计结果。

**Step 3: 原子提交**

Run: `git add webclipper/tests/storage/insight-stats.test.ts webclipper/src/ui/settings/sections/insight-stats.ts`

Run: `git commit -m "test: task3 - 为Insight聚合补充单元测试"`

---

## Phase Audit

- Audit file: `audit-p1.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
