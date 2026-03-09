# Plan P2 - webclipper-insight-settings

**Goal:** 把 Insight 作为 Settings 一级入口接入，并实现“点开 section 后只计算一次”的页面状态流。

**Non-goals:**
- 本 phase 不做实时刷新或后台缓存
- 本 phase 不引入图表库
- 本 phase 不扩展时间维度、趋势文案或推送能力

**Approach:**
先把 `insight` 加进 Settings 的 section 定义、分组和路由，再由 `useSettingsSceneController` 持有 Insight 专属加载状态。用户首次点开 Insight 时触发 `getInsightStats()`，成功后缓存于当前 Settings 生命周期内；同一轮停留期间切换回来不重新读取。UI 先落 overview + 文本排行版本，完整覆盖 loading / error / empty / populated 四种状态，为下一 phase 的图表增强保留稳定容器。

**Acceptance:**
- Settings 导航出现 Insight 一级入口，位于 Features 组
- 打开 Insight 时才发起本地统计读取，且当前 Settings 生命周期内只读一次
- 读取失败显示兜底空态，零数据显示“开始你的第一次 clip”
- Overview、AI Conversations、Web Articles 三个区块都能渲染文本版内容

---

## P2-T1

**Task:** 把 Insight 接入 Settings 导航与 section 路由

**Files:**
- Modify: `webclipper/src/ui/settings/types.ts`
- Modify: `webclipper/src/ui/settings/SettingsSidebarNav.tsx`
- Modify: `webclipper/src/ui/settings/SettingsScene.tsx`
- Modify: `webclipper/tests/unit/settings-sections.test.ts`
- Modify: `webclipper/src/i18n/locales/en.ts`
- Modify: `webclipper/src/i18n/locales/zh.ts`

**Step 1: 实现功能**

新增 `insight` section key，并把它放进 Features 组里，与现有 Chat with AI / Inpage 并列。同步补齐 settings section 的标签/描述文案，以及 `settings-sections.test.ts` 中的稳定顺序断言，保证导航与 active section 路由在 popup/app 两侧都一致。

**Step 2: 验证**

Run: `npm --prefix webclipper run test -- settings-sections`

Expected: 设置分组与扁平顺序测试更新后通过，新的 Insight key 能参与现有 section 逻辑。

**Step 3: 原子提交**

Run: `git add webclipper/src/ui/settings/types.ts webclipper/src/ui/settings/SettingsSidebarNav.tsx webclipper/src/ui/settings/SettingsScene.tsx webclipper/tests/unit/settings-sections.test.ts webclipper/src/i18n/locales/en.ts webclipper/src/i18n/locales/zh.ts`

Run: `git commit -m "feat: task4 - 将Insight接入设置导航"`

---

## P2-T2

**Task:** 实现 Insight section 的懒加载状态管理

**Files:**
- Modify: `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- New: `webclipper/src/ui/settings/sections/InsightSection.tsx`
- Modify: `webclipper/src/ui/settings/sections/insight-stats.ts`

**Step 1: 实现功能**

在 controller 中增加 `insightStats`、`insightLoading`、`insightError`、`hasLoadedInsight` 等状态，并在 `activeSection === 'insight'` 且尚未加载时调用 `getInsightStats()`。保持“只在用户点开 Insight 时计算一次”的策略；同一轮 Settings 停留期间不要自动刷新，也不要因为其它 section 的状态变化重复触发统计。

**Step 2: 验证**

Run: `npm --prefix webclipper run compile`

Expected: Settings controller 与 Insight section 类型联通，新增状态不会破坏现有 settings 流程。

**Step 3: 原子提交**

Run: `git add webclipper/src/ui/settings/hooks/useSettingsSceneController.ts webclipper/src/ui/settings/sections/InsightSection.tsx webclipper/src/ui/settings/sections/insight-stats.ts`

Run: `git commit -m "feat: task5 - 为Insight接入懒加载状态管理"`

---

## P2-T3

**Task:** 渲染 Insight 文本骨架与空态/错误态

**Files:**
- Modify: `webclipper/src/ui/settings/SettingsScene.tsx`
- Modify: `webclipper/src/ui/settings/sections/InsightSection.tsx`
- New: `webclipper/src/ui/settings/sections/InsightPanel.tsx`

**Step 1: 实现功能**

新增 `InsightPanel.tsx`，按已确认布局输出三块内容：顶部 3 个总览数字卡、左侧 AI Conversations、右侧 Web Articles。先用文本/条目排行把平台分布、总消息轮数、Top 3 最长对话、域名分布跑通，同时补齐 loading、暂无数据、开始第一次 clip 三种用户可见状态，确保在未引入 Recharts 前功能已可用。

**Step 2: 验证**

Run: `npm --prefix webclipper run compile`

Expected: Insight section 能在 SettingsScene 中渲染，且不同状态分支都有稳定 JSX 输出。

**Step 3: 原子提交**

Run: `git add webclipper/src/ui/settings/SettingsScene.tsx webclipper/src/ui/settings/sections/InsightSection.tsx webclipper/src/ui/settings/sections/InsightPanel.tsx`

Run: `git commit -m "feat: task6 - 渲染Insight面板基础界面"`

---

## Phase Audit

- Audit file: `audit-p2.md`
- Rule: 完成本 phase 全部 tasks 后，`executing-plans` 必须自动进入该文件的审计闭环
- Flow:
  1. 先记录发现
  2. 再修复问题
  3. 再运行本 phase 验证命令
